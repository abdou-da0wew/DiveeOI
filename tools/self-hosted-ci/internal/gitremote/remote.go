package gitremote

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/config"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/process"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/refs"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/security"
)

var objectIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{40,64}$`)

const askPassScript = `#!/bin/sh
case "$1" in
  *Username*|*username*) printf '%s\n' "$DIVE_CI_GIT_USERNAME" ;;
  *Password*|*password*) cat "$DIVE_CI_GIT_TOKEN_FILE" ;;
  *) exit 1 ;;
esac
`

type Ref struct {
	Name  string
	SHA   string
	Event string
}

type Remote struct {
	Repo config.Repository
}

func New(repo config.Repository) *Remote { return &Remote{Repo: repo} }

func (r *Remote) ListRefs(ctx context.Context) ([]Ref, error) {
	args := []string{"ls-remote"}
	if len(r.Repo.Branches) > 0 {
		args = append(args, "--heads")
	}
	if len(r.Repo.Tags) > 0 {
		args = append(args, "--tags")
	}
	args = append(args, "--", r.Repo.URL)
	result, err := r.runChecked(ctx, args, "", "poll remote")
	if err != nil {
		return nil, err
	}
	return r.parseRefs(string(result.Stdout)), nil
}

func (r *Remote) parseRefs(output string) []Ref {
	found := make(map[string]Ref)
	peeled := make(map[string]string)
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 || !objectIDPattern.MatchString(parts[0]) {
			continue
		}
		objectID, fullName := strings.ToLower(parts[0]), parts[1]
		switch {
		case strings.HasPrefix(fullName, "refs/heads/"):
			name := strings.TrimPrefix(fullName, "refs/heads/")
			if refs.MatchesAny(r.Repo.Branches, name) {
				found[fullName] = Ref{Name: fullName, SHA: objectID, Event: "branch"}
			}
		case strings.HasPrefix(fullName, "refs/tags/"):
			isPeeled := strings.HasSuffix(fullName, "^{}")
			name := strings.TrimPrefix(fullName, "refs/tags/")
			if isPeeled {
				name = strings.TrimSuffix(name, "^{}")
			}
			if !refs.MatchesAny(r.Repo.Tags, name) {
				continue
			}
			refName := "refs/tags/" + name
			if isPeeled {
				peeled[refName] = objectID
			} else {
				found[refName] = Ref{Name: refName, SHA: objectID, Event: "tag"}
			}
		}
	}
	for name, objectID := range peeled {
		found[name] = Ref{Name: name, SHA: objectID, Event: "tag"}
	}
	result := make([]Ref, 0, len(found))
	for _, ref := range found {
		result = append(result, ref)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result
}

func (r *Remote) Checkout(ctx context.Context, ref, sha, workspace string) error {
	if !objectIDPattern.MatchString(sha) {
		return fmt.Errorf("remote returned an invalid object id")
	}
	if err := os.MkdirAll(filepath.Dir(workspace), 0o700); err != nil {
		return fmt.Errorf("create run workspace: %w", err)
	}
	if err := os.Mkdir(workspace, 0o700); err != nil {
		return fmt.Errorf("create checkout directory: %w", err)
	}

	commands := [][]string{
		{"init", "--quiet", workspace},
		{"-C", workspace, "remote", "add", "origin", r.Repo.URL},
		{"-C", workspace, "fetch", "--quiet", "--depth=1", "--no-tags", "origin", ref},
	}
	for _, args := range commands {
		if _, err := r.runChecked(ctx, args, filepath.Dir(workspace), "checkout repository"); err != nil {
			return err
		}
	}

	result, err := r.runChecked(ctx, []string{"-C", workspace, "rev-parse", "FETCH_HEAD^{commit}"}, "", "resolve fetched commit")
	if err != nil {
		return err
	}
	fetched := strings.TrimSpace(string(result.Stdout))
	if !strings.EqualFold(fetched, sha) {
		// The ref may move between polling and checkout. Fetch the exact advertised commit,
		// then fail closed if the remote cannot serve that object.
		result, err = r.runChecked(ctx, []string{"-C", workspace, "fetch", "--quiet", "--depth=1", "--no-tags", "origin", sha}, "", "fetch advertised commit")
		if err != nil {
			return err
		}
		result, err = r.runChecked(ctx, []string{"-C", workspace, "rev-parse", "FETCH_HEAD^{commit}"}, "", "resolve advertised commit")
		if err != nil {
			return err
		}
		fetched = strings.TrimSpace(string(result.Stdout))
	}
	if !strings.EqualFold(fetched, sha) {
		return fmt.Errorf("ref advanced while checkout was starting; refusing to build a different commit")
	}
	if _, err := r.runChecked(ctx, []string{"-C", workspace, "checkout", "--quiet", "--detach", sha}, "", "checkout advertised commit"); err != nil {
		return err
	}
	return nil
}

func (r *Remote) token() string {
	if r.Repo.GitCredentials == nil {
		return ""
	}
	return os.Getenv(r.Repo.GitCredentials.TokenEnv)
}

func (r *Remote) runChecked(ctx context.Context, args []string, cwd, action string) (process.Result, error) {
	result, token, cleanup, err := r.run(ctx, args, cwd)
	if cleanup != nil {
		cleanup()
	}
	if err != nil {
		return process.Result{}, redactProcessError(action, err, token)
	}
	return result, nil
}

func (r *Remote) run(ctx context.Context, args []string, cwd string) (process.Result, string, func(), error) {
	env := gitEnvironment(r.Repo.GitCredentials, map[string]string{
		"GIT_TERMINAL_PROMPT": "0",
		"GCM_INTERACTIVE":     "never",
		"GIT_OPTIONAL_LOCKS":  "0",
		"GIT_CONFIG_NOSYSTEM": "1",
		"GIT_CONFIG_GLOBAL":   "/dev/null",
	})
	if os.Getenv("GIT_SSH_COMMAND") == "" {
		env = replaceEnvironment(env, "GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
	}
	token := r.token()
	cleanup := func() {}
	if r.Repo.GitCredentials != nil {
		if token == "" {
			return process.Result{}, token, cleanup, fmt.Errorf("git credential env %q is empty or unset", r.Repo.GitCredentials.TokenEnv)
		}
		if strings.ContainsAny(token, "\x00\r\n") {
			return process.Result{}, token, cleanup, fmt.Errorf("git credential must be a single-line token")
		}
		credentialDir, err := os.MkdirTemp("/dev/shm", "diveeoi-ci-git-*")
		if err != nil {
			return process.Result{}, token, cleanup, fmt.Errorf("create temporary git credential area: %w", err)
		}
		cleanup = func() { _ = os.RemoveAll(credentialDir) }
		if err := os.Chmod(credentialDir, 0o700); err != nil {
			cleanup()
			return process.Result{}, token, func() {}, err
		}
		tokenFile := filepath.Join(credentialDir, "token")
		if err := os.WriteFile(tokenFile, append([]byte(token), '\n'), 0o600); err != nil {
			cleanup()
			return process.Result{}, token, func() {}, err
		}
		askPassFile := filepath.Join(credentialDir, "askpass.sh")
		if err := os.WriteFile(askPassFile, []byte(askPassScript), 0o700); err != nil {
			cleanup()
			return process.Result{}, token, func() {}, err
		}
		env = gitEnvironment(r.Repo.GitCredentials, map[string]string{
			"GIT_TERMINAL_PROMPT":    "0",
			"GCM_INTERACTIVE":        "never",
			"GIT_OPTIONAL_LOCKS":     "0",
			"GIT_CONFIG_NOSYSTEM":    "1",
			"GIT_CONFIG_GLOBAL":      "/dev/null",
			"GIT_ASKPASS":            askPassFile,
			"DIVE_CI_GIT_USERNAME":   r.Repo.GitCredentials.Username,
			"DIVE_CI_GIT_TOKEN_FILE": tokenFile,
		})
		if os.Getenv("GIT_SSH_COMMAND") == "" {
			env = replaceEnvironment(env, "GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
		}
	}
	result, err := process.Capture(ctx, "git", args, cwd, env, 128*1024*1024)
	return result, token, cleanup, err
}

func redactProcessError(action string, err error, token string) error {
	message := security.RedactText(err.Error(), []string{token})
	return fmt.Errorf("%s: %s", action, message)
}
