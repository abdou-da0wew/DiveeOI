package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
)

const vaultVersion = 1

var secretName = regexp.MustCompile(`^[A-Z_][A-Z0-9_]{0,127}$`)

type encryptedValue struct {
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

type vaultFile struct {
	Version int                                  `json:"version"`
	Entries map[string]map[string]encryptedValue `json:"entries"`
}

func ensureStorage(directory string) error {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create secret storage: %w", err)
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("secret storage path must be a real directory")
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return fmt.Errorf("secure secret storage: %w", err)
	}
	return nil
}

func readPrivateFile(filePath string) ([]byte, error) {
	info, err := os.Lstat(filePath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("%s must be a regular file", filepath.Base(filePath))
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("%s permissions are too broad; run chmod 600", filepath.Base(filePath))
	}
	return os.ReadFile(filePath)
}

func loadKey(directory string, create bool) ([]byte, error) {
	if err := ensureStorage(directory); err != nil {
		return nil, err
	}
	keyPath := filepath.Join(directory, "vault.key")
	key, err := readPrivateFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("read vault key: %w", err)
	}
	if key != nil {
		if len(key) != 32 {
			return nil, fmt.Errorf("vault key must be exactly 32 bytes")
		}
		return key, nil
	}
	if !create {
		return nil, fmt.Errorf("secret vault is not initialized; set a secret first")
	}

	key = make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate vault key: %w", err)
	}
	file, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return loadKey(directory, false)
		}
		return nil, fmt.Errorf("create vault key: %w", err)
	}
	if _, err := file.Write(key); err != nil {
		file.Close()
		os.Remove(keyPath)
		return nil, fmt.Errorf("write vault key: %w", err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		os.Remove(keyPath)
		return nil, fmt.Errorf("sync vault key: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("close vault key: %w", err)
	}
	return key, nil
}

func loadVault(directory string) (*vaultFile, error) {
	filePath := filepath.Join(directory, "secrets.enc.json")
	contents, err := readPrivateFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read encrypted vault: %w", err)
	}
	if contents == nil {
		return &vaultFile{Version: vaultVersion, Entries: map[string]map[string]encryptedValue{}}, nil
	}
	var vault vaultFile
	if err := json.Unmarshal(contents, &vault); err != nil {
		return nil, fmt.Errorf("encrypted vault is invalid JSON: %w", err)
	}
	if vault.Version != vaultVersion || vault.Entries == nil {
		return nil, fmt.Errorf("unsupported or malformed encrypted vault")
	}
	return &vault, nil
}

func saveVault(directory string, vault *vaultFile) error {
	if err := ensureStorage(directory); err != nil {
		return err
	}
	contents, err := json.MarshalIndent(vault, "", "  ")
	if err != nil {
		return fmt.Errorf("encode secret vault: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".vault-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary vault: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(append(contents, '\n')); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, filepath.Join(directory, "secrets.enc.json")); err != nil {
		return fmt.Errorf("replace secret vault: %w", err)
	}
	return nil
}

func validateSecret(repoID, name string) error {
	if repoID == "" || len(repoID) > 64 || strings.ContainsAny(repoID, "\x00/\\") {
		return fmt.Errorf("invalid repository id")
	}
	if !secretName.MatchString(name) {
		return fmt.Errorf("secret name must be uppercase letters, digits, or underscores")
	}
	return nil
}

func seal(key []byte, repoID, name, value string) (encryptedValue, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedValue{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return encryptedValue{}, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return encryptedValue{}, err
	}
	aad := []byte(repoID + "\x00" + name)
	ciphertext := gcm.Seal(nil, nonce, []byte(value), aad)
	return encryptedValue{
		Nonce:      base64.RawStdEncoding.EncodeToString(nonce),
		Ciphertext: base64.RawStdEncoding.EncodeToString(ciphertext),
	}, nil
}

func openValue(key []byte, repoID, name string, encrypted encryptedValue) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce, err := base64.RawStdEncoding.DecodeString(encrypted.Nonce)
	if err != nil {
		return "", fmt.Errorf("secret %q has invalid nonce data", name)
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(encrypted.Ciphertext)
	if err != nil {
		return "", fmt.Errorf("secret %q has invalid ciphertext data", name)
	}
	value, err := gcm.Open(nil, nonce, ciphertext, []byte(repoID+"\x00"+name))
	if err != nil {
		return "", fmt.Errorf("cannot decrypt secret %q for repo %q; vault key or data may be damaged", name, repoID)
	}
	return string(value), nil
}

func lockVault(directory string) (func(), error) {
	if err := ensureStorage(directory); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(directory, "vault.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open secret vault lock: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return nil, err
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		file.Close()
		return nil, fmt.Errorf("lock secret vault: %w", err)
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		_ = file.Close()
	}, nil
}

func Set(directory, repoID, name, value string) error {
	if err := validateSecret(repoID, name); err != nil {
		return err
	}
	if value == "" || len(value) > 64*1024 || strings.ContainsRune(value, '\x00') {
		return fmt.Errorf("secret value must contain 1 to 65536 bytes and cannot contain NUL")
	}
	release, err := lockVault(directory)
	if err != nil {
		return err
	}
	defer release()
	key, err := loadKey(directory, true)
	if err != nil {
		return err
	}
	vault, err := loadVault(directory)
	if err != nil {
		return err
	}
	vault.Entries[repoID] = ensureMap(vault.Entries[repoID])
	vault.Entries[repoID][name], err = seal(key, repoID, name, value)
	if err != nil {
		return err
	}
	return saveVault(directory, vault)
}

func Delete(directory, repoID, name string) (bool, error) {
	if err := validateSecret(repoID, name); err != nil {
		return false, err
	}
	release, err := lockVault(directory)
	if err != nil {
		return false, err
	}
	defer release()
	key, err := loadKey(directory, false)
	if err != nil {
		return false, err
	}
	vault, err := loadVault(directory)
	if err != nil {
		return false, err
	}
	secrets := vault.Entries[repoID]
	encrypted, exists := secrets[name]
	if !exists {
		return false, nil
	}
	if _, err := openValue(key, repoID, name, encrypted); err != nil {
		return false, err
	}
	delete(secrets, name)
	if len(secrets) == 0 {
		delete(vault.Entries, repoID)
	}
	return true, saveVault(directory, vault)
}

func List(directory, repoID string) ([]string, error) {
	vault, err := loadVault(directory)
	if err != nil {
		return nil, err
	}
	var names []string
	for name := range vault.Entries[repoID] {
		names = append(names, name)
	}
	sort.Strings(names)
	return names, nil
}

func Load(directory, repoID string, names []string) (map[string]string, error) {
	result := make(map[string]string, len(names))
	if len(names) == 0 {
		return result, nil
	}
	release, err := lockVault(directory)
	if err != nil {
		return nil, err
	}
	defer release()
	key, err := loadKey(directory, false)
	if err != nil {
		return nil, err
	}
	vault, err := loadVault(directory)
	if err != nil {
		return nil, err
	}
	secrets := vault.Entries[repoID]
	for _, name := range names {
		if err := validateSecret(repoID, name); err != nil {
			return nil, err
		}
		encrypted, exists := secrets[name]
		if !exists {
			return nil, fmt.Errorf("required secret %q is not configured for repo %q", name, repoID)
		}
		value, err := openValue(key, repoID, name, encrypted)
		if err != nil {
			return nil, err
		}
		result[name] = value
	}
	return result, nil
}

func ensureMap(input map[string]encryptedValue) map[string]encryptedValue {
	if input == nil {
		return make(map[string]encryptedValue)
	}
	return input
}

// ReadSecret reads exactly one secret from stdin, without trimming a trailing newline.
func ReadSecret(input io.Reader) (string, error) {
	bytes, err := io.ReadAll(io.LimitReader(input, 64*1024+1))
	if err != nil {
		return "", err
	}
	if len(bytes) > 64*1024 {
		return "", fmt.Errorf("secret value exceeds 64 KiB")
	}
	return string(bytes), nil
}
