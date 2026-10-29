package state

import (
	"os"
	"path/filepath"
	"testing"
)

const testSHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func TestObserveBaselinesThenQueuesChangedRefs(t *testing.T) {
	directory := t.TempDir()
	store, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.Observe("web", "refs/heads/main", testSHA, "branch", false)
	if err != nil {
		t.Fatal(err)
	}
	if first != nil {
		t.Fatal("first poll should establish a baseline by default")
	}
	second, err := store.Observe("web", "refs/heads/main", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "branch", false)
	if err != nil {
		t.Fatal(err)
	}
	if second == nil || second.Status != "queued" || second.RepoID != "web" {
		t.Fatalf("changed ref was not queued: %+v", second)
	}
	if _, err := os.Stat(filepath.Join(directory, "state.json")); err != nil {
		t.Fatal(err)
	}
}

func TestRunOnStartAndRecovery(t *testing.T) {
	directory := t.TempDir()
	store, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.Observe("web", "refs/tags/v1", testSHA, "tag", true)
	if err != nil || run == nil {
		t.Fatalf("runOnStart failed: run=%+v err=%v", run, err)
	}
	if err := store.UpdateRun(run.ID, func(current *Run) { current.Status = "running" }); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.Initialize(); err != nil {
		t.Fatal(err)
	}
	current, ok := reopened.FindRun(run.ID)
	if !ok || current.Status != "failure" || current.Error == "" {
		t.Fatalf("interrupted run was not recovered safely: %+v", current)
	}
}

func TestRunArtifactSnapshotsAreCopied(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateRun("web", "refs/heads/main", testSHA, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateRun(run.ID, func(current *Run) {
		current.Artifacts = []string{"artifacts/" + run.ID + "/build/dist/app.js"}
	}); err != nil {
		t.Fatal(err)
	}
	snapshot := store.Snapshot()
	snapshot.Runs[0].Artifacts[0] = "mutated"
	current, ok := store.FindRun(run.ID)
	if !ok || current.Artifacts[0] != "artifacts/"+run.ID+"/build/dist/app.js" {
		t.Fatalf("artifact state was changed through a snapshot: %+v", current.Artifacts)
	}
}
