package security

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestVaultEncryptsAndScopesSecrets(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "vault")
	value := "super-secret-token-with-special-chars-+/="
	if err := Set(directory, "repo-a", "DEPLOY_TOKEN", value); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(directory, "repo-a", []string{"DEPLOY_TOKEN"})
	if err != nil {
		t.Fatal(err)
	}
	if loaded["DEPLOY_TOKEN"] != value {
		t.Fatal("decrypted value did not match")
	}
	if _, err := Load(directory, "repo-b", []string{"DEPLOY_TOKEN"}); err == nil {
		t.Fatal("secret unexpectedly crossed repository scope")
	}
	stored, err := os.ReadFile(filepath.Join(directory, "secrets.enc.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(stored, []byte(value)) {
		t.Fatal("secret value was stored in plaintext")
	}
	for _, name := range []string{"vault.key", "secrets.enc.json"} {
		info, err := os.Stat(filepath.Join(directory, name))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm()&0o077 != 0 {
			t.Fatalf("%s is accessible by group or other users: %o", name, info.Mode().Perm())
		}
	}
}

func TestDeleteAndList(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "vault")
	for _, name := range []string{"Z_SECRET", "A_SECRET"} {
		if err := Set(directory, "repo", name, "value-"+name); err != nil {
			t.Fatal(err)
		}
	}
	names, err := List(directory, "repo")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(names, ",") != "A_SECRET,Z_SECRET" {
		t.Fatalf("unexpected secret list: %v", names)
	}
	deleted, err := Delete(directory, "repo", "A_SECRET")
	if err != nil || !deleted {
		t.Fatalf("delete failed: deleted=%v err=%v", deleted, err)
	}
}

func TestConcurrentSecretWritesAreSerialized(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "vault")
	var workers sync.WaitGroup
	errors := make(chan error, 12)
	for index := 0; index < cap(errors); index++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			name := fmt.Sprintf("SECRET_%02d", index)
			errors <- Set(directory, "repo", name, "value-"+name)
		}(index)
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	names, err := List(directory, "repo")
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != cap(errors) {
		t.Fatalf("expected all concurrent secret updates, got %d names", len(names))
	}
}

func TestStreamRedactorMasksSecretsAcrossWrites(t *testing.T) {
	text := "hello before TOKEN-XYZ after\nmultiline secret: line one\nline two\n"
	secrets := []string{"TOKEN-XYZ", "line one\nline two"}
	want := "hello before [REDACTED] after\nmultiline secret: [REDACTED]\n"
	for split := 0; split <= len(text); split++ {
		var output bytes.Buffer
		redactor := NewStreamRedactor(&output, secrets)
		if _, err := redactor.Write([]byte(text[:split])); err != nil {
			t.Fatal(err)
		}
		if _, err := redactor.Write([]byte(text[split:])); err != nil {
			t.Fatal(err)
		}
		if err := redactor.Close(); err != nil {
			t.Fatal(err)
		}
		if output.String() != want {
			t.Fatalf("split %d: got %q, want %q", split, output.String(), want)
		}
	}
}
