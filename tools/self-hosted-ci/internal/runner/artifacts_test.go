package runner

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/state"
)

func TestCopyJobArtifactsRetainsDeclaredFilesOnly(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	storage := filepath.Join(root, "storage")
	if err := os.MkdirAll(filepath.Join(workspace, "dist"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "dist", "app.js"), []byte("built output"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "unlisted.txt"), []byte("not retained"), 0o600); err != nil {
		t.Fatal(err)
	}

	used := int64(0)
	runID := "0123456789abcdef0123456789abcdef"
	paths, err := copyJobArtifacts(storage, state.Run{ID: runID}, "build", workspace, []string{"dist"}, 1024, &used)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || paths[0] != "artifacts/"+runID+"/build/dist/app.js" {
		t.Fatalf("unexpected artifact paths: %#v", paths)
	}
	retained := filepath.Join(storage, filepath.FromSlash(paths[0]))
	contents, err := os.ReadFile(retained)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "built output" || used != int64(len(contents)) {
		t.Fatalf("unexpected artifact contents/size: %q, %d", contents, used)
	}
	mode, err := os.Stat(retained)
	if err != nil {
		t.Fatal(err)
	}
	if mode.Mode().Perm() != 0o700 {
		t.Fatalf("expected private executable permissions, got %o", mode.Mode().Perm())
	}
	if _, err := os.Stat(filepath.Join(storage, "artifacts", runID, "build", "unlisted.txt")); !os.IsNotExist(err) {
		t.Fatalf("unexpected unlisted file retained: %v", err)
	}
}

func TestCopyJobArtifactsRejectsSymlinksAndSizeOverflow(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	storage := filepath.Join(root, "storage")
	if err := os.MkdirAll(filepath.Join(workspace, "dist"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "dist", "app.js"), []byte("long output"), 0o600); err != nil {
		t.Fatal(err)
	}
	used := int64(0)
	if _, err := copyJobArtifacts(storage, state.Run{ID: "0123456789abcdef0123456789abcdef"}, "build", workspace, []string{"dist"}, 2, &used); err == nil {
		t.Fatal("expected artifact size limit to be enforced")
	}

	if err := os.Symlink(filepath.Join(workspace, "dist", "app.js"), filepath.Join(workspace, "linked.js")); err != nil {
		t.Skipf("symlink test not supported: %v", err)
	}
	if _, err := copyJobArtifacts(storage, state.Run{ID: "abcdef0123456789abcdef0123456789"}, "build", workspace, []string{"linked.js"}, 1024, &used); err == nil {
		t.Fatal("expected artifact symlink to be rejected")
	}
}
