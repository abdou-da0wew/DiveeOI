package runner

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func AcquireLock(storageDir string) (func(), error) {
	if err := os.MkdirAll(storageDir, 0o700); err != nil {
		return nil, fmt.Errorf("create runner storage: %w", err)
	}
	info, err := os.Lstat(storageDir)
	if err != nil {
		return nil, fmt.Errorf("inspect runner storage: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("runner storage must be a real directory")
	}
	if err := os.Chmod(storageDir, 0o700); err != nil {
		return nil, fmt.Errorf("secure runner storage: %w", err)
	}
	filePath := filepath.Join(storageDir, "runner.lock")
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open runner lock: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return nil, fmt.Errorf("secure runner lock: %w", err)
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		if err == syscall.EWOULDBLOCK || err == syscall.EAGAIN {
			return nil, fmt.Errorf("another runner process is already active")
		}
		return nil, fmt.Errorf("lock runner storage: %w", err)
	}
	if err := file.Truncate(0); err != nil {
		syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		file.Close()
		return nil, err
	}
	if _, err := file.WriteString(fmt.Sprintf("%d\n", os.Getpid())); err != nil {
		syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		file.Close()
		return nil, err
	}
	if err := file.Sync(); err != nil {
		syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		file.Close()
		return nil, err
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		_ = file.Close()
	}, nil
}
