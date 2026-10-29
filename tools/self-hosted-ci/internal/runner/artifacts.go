package runner

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/state"
)

const maxArtifactFilesPerJob = 10000

func copyJobArtifacts(storageDir string, run state.Run, jobID, workspace string, paths []string, limit int64, used *int64) ([]string, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	if !runIDPattern.MatchString(run.ID) || jobID == "" || len(jobID) > 64 || strings.ContainsAny(jobID, "/\\\x00") {
		return nil, fmt.Errorf("run or job id is unsafe for artifact storage")
	}
	root, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		return nil, fmt.Errorf("resolve artifact workspace: %w", err)
	}
	jobDestination, err := ensureArtifactDirectory(storageDir, run.ID, jobID)
	if err != nil {
		return nil, err
	}
	created := make([]string, 0)
	for _, relative := range paths {
		clean := filepath.Clean(filepath.FromSlash(relative))
		if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			_ = os.RemoveAll(jobDestination)
			return nil, fmt.Errorf("artifact path %q is unsafe", relative)
		}
		source, info, err := resolveNoSymlinks(root, clean)
		if err != nil {
			_ = os.RemoveAll(jobDestination)
			return nil, fmt.Errorf("artifact %q: %w", relative, err)
		}
		destination := filepath.Join(jobDestination, clean)
		if err := copyArtifactTree(source, destination, filepath.Join("artifacts", run.ID, jobID, clean), info, used, limit, &created); err != nil {
			_ = os.RemoveAll(jobDestination)
			return nil, fmt.Errorf("artifact %q: %w", relative, err)
		}
	}
	return created, nil
}

func ensureArtifactDirectory(storageDir, runID, jobID string) (string, error) {
	if err := os.MkdirAll(storageDir, 0o700); err != nil {
		return "", fmt.Errorf("create runner storage: %w", err)
	}
	parent := storageDir
	for _, child := range []string{"artifacts", runID, jobID} {
		parentInfo, err := os.Lstat(parent)
		if err != nil || !parentInfo.IsDir() || parentInfo.Mode()&os.ModeSymlink != 0 {
			if err != nil {
				return "", fmt.Errorf("inspect artifact parent: %w", err)
			}
			return "", fmt.Errorf("artifact parent must be a real directory")
		}
		path := filepath.Join(parent, child)
		if err := os.Mkdir(path, 0o700); err != nil && !os.IsExist(err) {
			return "", fmt.Errorf("create artifact directory: %w", err)
		}
		info, err := os.Lstat(path)
		if err != nil {
			return "", fmt.Errorf("inspect artifact directory: %w", err)
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("artifact path must be a real directory")
		}
		if err := os.Chmod(path, 0o700); err != nil {
			return "", fmt.Errorf("secure artifact directory: %w", err)
		}
		parent = path
	}
	return parent, nil
}

func resolveNoSymlinks(root, relative string) (string, os.FileInfo, error) {
	current := root
	parts := strings.Split(filepath.Clean(relative), string(filepath.Separator))
	var info os.FileInfo
	for index, part := range parts {
		current = filepath.Join(current, part)
		var err error
		info, err = os.Lstat(current)
		if err != nil {
			return "", nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", nil, fmt.Errorf("symlinks are not allowed in artifact paths")
		}
		if index < len(parts)-1 && !info.IsDir() {
			return "", nil, fmt.Errorf("path component %q is not a directory", part)
		}
	}
	return current, info, nil
}

func copyArtifactTree(source, destination, storedRelative string, info os.FileInfo, used *int64, limit int64, created *[]string) error {
	if info.IsDir() {
		if err := os.MkdirAll(destination, 0o700); err != nil {
			return err
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.Name() == ".git" {
				return fmt.Errorf("artifact tree contains Git metadata")
			}
			childSource := filepath.Join(source, entry.Name())
			childInfo, err := os.Lstat(childSource)
			if err != nil {
				return err
			}
			if childInfo.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("directory contains symlink %q", entry.Name())
			}
			if err := copyArtifactTree(childSource, filepath.Join(destination, entry.Name()), filepath.Join(storedRelative, entry.Name()), childInfo, used, limit, created); err != nil {
				return err
			}
		}
		return nil
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("only regular files and directories can be retained")
	}
	if len(*created) >= maxArtifactFilesPerJob {
		return fmt.Errorf("job artifacts exceed the %d-file limit", maxArtifactFilesPerJob)
	}
	if info.Size() < 0 || *used+info.Size() > limit {
		return fmt.Errorf("run artifacts exceed the configured %d-byte limit", limit)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	mode := os.FileMode(0o600) | (info.Mode().Perm() & 0o111)
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	copied, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		_ = os.Remove(destination)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(destination)
		return closeErr
	}
	if copied != info.Size() {
		_ = os.Remove(destination)
		return fmt.Errorf("file size changed while collecting artifact")
	}
	*used += copied
	*created = append(*created, filepath.ToSlash(storedRelative))
	return nil
}

func pruneArtifacts(storageDir string, retentionDays int, snapshot state.Snapshot) error {
	root := filepath.Join(storageDir, "artifacts")
	rootInfo, err := os.Lstat(root)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("artifact storage must be a real directory")
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	active := make(map[string]bool)
	for _, run := range snapshot.Runs {
		if run.Status == "queued" || run.Status == "running" {
			active[run.ID] = true
		}
	}
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour)
	for _, entry := range entries {
		if !entry.IsDir() || active[entry.Name()] {
			continue
		}
		path := filepath.Join(root, entry.Name())
		info, err := os.Lstat(path)
		if err != nil {
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			continue
		}
		if info.ModTime().Before(cutoff) {
			if err := os.RemoveAll(path); err != nil {
				return fmt.Errorf("remove expired artifacts %q: %w", entry.Name(), err)
			}
		}
	}
	return nil
}
