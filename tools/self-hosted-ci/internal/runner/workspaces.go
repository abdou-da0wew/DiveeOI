package runner

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/state"
)

var runIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

func cleanupFinishedWorkspaces(storageDir string, snapshot state.Snapshot) error {
	runsRoot := filepath.Join(storageDir, "runs")
	rootInfo, err := os.Lstat(runsRoot)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("runs path is not a real directory")
	}
	runs := make(map[string]state.Run, len(snapshot.Runs))
	for _, run := range snapshot.Runs {
		if runIDPattern.MatchString(run.ID) {
			runs[run.ID] = run
		}
	}
	entries, err := os.ReadDir(runsRoot)
	if err != nil {
		return err
	}
	finishedBefore := time.Now().Add(-time.Minute)
	for _, entry := range entries {
		id := entry.Name()
		if !runIDPattern.MatchString(id) {
			continue
		}
		runDir := filepath.Join(runsRoot, id)
		run, retained := runs[id]
		if !retained {
			if err := os.RemoveAll(runDir); err != nil {
				return fmt.Errorf("remove expired run data %s: %w", id, err)
			}
			continue
		}
		if run.Status == "queued" || run.Status == "running" || run.EndedAt.IsZero() || run.EndedAt.After(finishedBefore) {
			continue
		}
		runInfo, err := os.Lstat(runDir)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if runInfo.Mode()&os.ModeSymlink != 0 {
			if err := os.Remove(runDir); err != nil {
				return err
			}
			continue
		}
		if !runInfo.IsDir() {
			continue
		}
		workspace := filepath.Join(runDir, "workspace")
		workspaceInfo, err := os.Lstat(workspace)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if workspaceInfo.Mode()&os.ModeSymlink != 0 {
			if err := os.Remove(workspace); err != nil {
				return err
			}
			continue
		}
		if err := os.RemoveAll(workspace); err != nil {
			return fmt.Errorf("remove workspace for run %s: %w", id, err)
		}
	}
	return nil
}
