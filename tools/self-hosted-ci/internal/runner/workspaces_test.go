package runner

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/state"
)

func TestCleanupFinishedWorkspacesAndPreserveActiveRuns(t *testing.T) {
	storage := t.TempDir()
	finishedID := "0123456789abcdef0123456789abcdef"
	activeID := "abcdef0123456789abcdef0123456789"
	finishedWorkspace := filepath.Join(storage, "runs", finishedID, "workspace")
	activeWorkspace := filepath.Join(storage, "runs", activeID, "workspace")
	if err := os.MkdirAll(finishedWorkspace, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(activeWorkspace, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := cleanupFinishedWorkspaces(storage, state.Snapshot{Runs: []state.Run{
		{ID: finishedID, Status: "failure", EndedAt: time.Now().Add(-2 * time.Minute)},
		{ID: activeID, Status: "running"},
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(finishedWorkspace); !os.IsNotExist(err) {
		t.Fatalf("finished workspace was not removed: %v", err)
	}
	if _, err := os.Stat(activeWorkspace); err != nil {
		t.Fatalf("active workspace was removed: %v", err)
	}
}

func TestCleanupFinishedWorkspacesDoesNotFollowSymlinkedRunDirectory(t *testing.T) {
	storage := t.TempDir()
	runsRoot := filepath.Join(storage, "runs")
	if err := os.MkdirAll(runsRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "workspace")
	if err := os.MkdirAll(outside, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "keep.txt"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	runID := "0123456789abcdef0123456789abcdef"
	if err := os.Symlink(filepath.Dir(outside), filepath.Join(runsRoot, runID)); err != nil {
		t.Skipf("symlink test not supported: %v", err)
	}
	if err := cleanupFinishedWorkspaces(storage, state.Snapshot{Runs: []state.Run{{ID: runID, Status: "failure", EndedAt: time.Now().Add(-2 * time.Minute)}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(outside, "keep.txt")); err != nil {
		t.Fatalf("outside workspace was modified: %v", err)
	}
}
