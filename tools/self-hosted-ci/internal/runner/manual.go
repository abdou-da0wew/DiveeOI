package runner

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/refs"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/state"
)

var commitID = regexp.MustCompile(`^[0-9a-fA-F]{40,64}$`)

func (daemon *Daemon) RunManual(ctx context.Context, repoID, fullRef, sha string) (state.Run, error) {
	if err := daemon.cleanStaleContainers(ctx); err != nil {
		return state.Run{}, err
	}
	snapshot := daemon.Store.Snapshot()
	if err := cleanupFinishedWorkspaces(daemon.Config.StorageDir, snapshot); err != nil {
		return state.Run{}, err
	}
	if err := pruneArtifacts(daemon.Config.StorageDir, daemon.Config.ArtifactRetentionDays, snapshot); err != nil {
		return state.Run{}, err
	}
	repo, ok := daemon.repository(repoID)
	if !ok {
		return state.Run{}, fmt.Errorf("repository %q is not configured", repoID)
	}
	if !commitID.MatchString(sha) {
		return state.Run{}, fmt.Errorf("sha must be a 40- or 64-character hexadecimal commit id")
	}
	var watched bool
	switch {
	case strings.HasPrefix(fullRef, "refs/heads/"):
		watched = refs.MatchesAny(repo.Branches, strings.TrimPrefix(fullRef, "refs/heads/"))
	case strings.HasPrefix(fullRef, "refs/tags/"):
		watched = refs.MatchesAny(repo.Tags, strings.TrimPrefix(fullRef, "refs/tags/"))
	default:
		return state.Run{}, fmt.Errorf("ref must start with refs/heads/ or refs/tags/")
	}
	if !watched {
		return state.Run{}, fmt.Errorf("ref %q does not match a watched branch or tag", fullRef)
	}
	run, err := daemon.Store.CreateRun(repoID, fullRef, strings.ToLower(sha), "manual")
	if err != nil {
		return state.Run{}, err
	}
	daemon.executeRun(ctx, run)
	completed, ok := daemon.Store.FindRun(run.ID)
	if !ok {
		return run, fmt.Errorf("run %s could not be read after execution", run.ID)
	}
	if completed.Status != "success" {
		return completed, fmt.Errorf("manual run %s finished with status %s: %s", completed.ID, completed.Status, completed.Error)
	}
	return completed, nil
}
