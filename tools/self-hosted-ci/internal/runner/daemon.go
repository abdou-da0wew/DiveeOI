package runner

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/config"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/gitremote"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/process"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/refs"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/security"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/state"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/workflow"
)

const maxLogBytes = 64 * 1024 * 1024

type Daemon struct {
	Config *config.Config
	Store  *state.Store
	Docker *DockerExecutor
}

func NewDaemon(cfg *config.Config, store *state.Store) *Daemon {
	return &Daemon{
		Config: cfg,
		Store:  store,
		Docker: &DockerExecutor{Config: cfg.Docker, InstanceID: store.InstanceID()},
	}
}

func (daemon *Daemon) Serve(ctx context.Context) error {
	if runtime.GOOS != "linux" {
		return fmt.Errorf("self-hosted CI execution currently supports Linux hosts with Docker")
	}
	if os.Geteuid() == 0 {
		return fmt.Errorf("refusing to run CI as root; configure a dedicated unprivileged service user")
	}
	lock, err := AcquireLock(daemon.Config.StorageDir)
	if err != nil {
		return err
	}
	defer lock()
	if err := daemon.Store.Initialize(); err != nil {
		return fmt.Errorf("initialize runner state: %w", err)
	}
	if err := cleanupFinishedWorkspaces(daemon.Config.StorageDir, daemon.Store.Snapshot()); err != nil {
		return fmt.Errorf("clean interrupted workspaces: %w", err)
	}
	if err := pruneArtifacts(daemon.Config.StorageDir, daemon.Config.ArtifactRetentionDays, daemon.Store.Snapshot()); err != nil {
		fmt.Fprintf(os.Stderr, "[artifacts] cleanup warning: %v\n", err)
	}
	if err := CheckDocker(ctx, daemon.Config.Docker.Binary, daemon.Config.Docker.Rootless); err != nil {
		return err
	}
	if err := daemon.cleanStaleContainers(ctx); err != nil {
		return err
	}

	capacity := daemon.Config.MaxConcurrentRuns + 1024
	queue := make(chan state.Run, capacity)
	var workers sync.WaitGroup
	for index := 0; index < daemon.Config.MaxConcurrentRuns; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case run := <-queue:
					if ctx.Err() == nil {
						daemon.executeRun(ctx, run)
					}
				}
			}
		}()
	}
	for _, run := range daemon.Store.QueuedRuns() {
		select {
		case queue <- run:
		case <-ctx.Done():
			workers.Wait()
			return nil
		}
	}

	fmt.Printf("[runner] watching %d repositories every %ds (max %d concurrent runs)\n",
		len(daemon.Config.Repositories), daemon.Config.PollInterval, daemon.Config.MaxConcurrentRuns)
	for {
		if ctx.Err() != nil {
			break
		}
		daemon.pollOnce(ctx, queue)
		timer := time.NewTimer(time.Duration(daemon.Config.PollInterval) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
		case <-timer.C:
		}
	}
	workers.Wait()
	return nil
}

func (daemon *Daemon) pollOnce(ctx context.Context, queue chan<- state.Run) {
	for _, repo := range daemon.Config.Repositories {
		if ctx.Err() != nil {
			return
		}
		remote := gitremote.New(repo)
		pollCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
		remoteRefs, err := remote.ListRefs(pollCtx)
		cancel()
		if err != nil {
			fmt.Fprintf(os.Stderr, "[poll] %s: %v\n", repo.ID, err)
			continue
		}
		for _, remoteRef := range remoteRefs {
			created, err := daemon.Store.Observe(repo.ID, remoteRef.Name, remoteRef.SHA, remoteRef.Event, repo.RunOnStart)
			if err != nil {
				fmt.Fprintf(os.Stderr, "[poll] save state for %s %s: %v\n", repo.ID, remoteRef.Name, err)
				continue
			}
			if created == nil {
				continue
			}
			fmt.Printf("[queue] %s %s @ %s\n", repo.ID, remoteRef.Name, shortSHA(remoteRef.SHA))
			select {
			case queue <- *created:
			case <-ctx.Done():
				return
			}
		}
	}
	snapshot := daemon.Store.Snapshot()
	if err := cleanupFinishedWorkspaces(daemon.Config.StorageDir, snapshot); err != nil {
		fmt.Fprintf(os.Stderr, "[runs] cleanup warning: %v\n", err)
	}
	if err := pruneArtifacts(daemon.Config.StorageDir, daemon.Config.ArtifactRetentionDays, snapshot); err != nil {
		fmt.Fprintf(os.Stderr, "[artifacts] cleanup warning: %v\n", err)
	}
}

func (daemon *Daemon) executeRun(ctx context.Context, run state.Run) {
	if ctx.Err() != nil {
		return
	}
	repo, exists := daemon.repository(run.RepoID)
	if !exists {
		_ = daemon.Store.UpdateRun(run.ID, func(current *state.Run) {
			current.Status = "failure"
			current.Error = "repository was removed from the runner configuration"
			current.EndedAt = time.Now().UTC()
		})
		return
	}
	started := time.Now().UTC()
	_ = daemon.Store.UpdateRun(run.ID, func(current *state.Run) {
		current.Status = "running"
		current.StartedAt = started
	})

	runDir := filepath.Join(daemon.Config.StorageDir, "runs", run.ID)
	if err := os.MkdirAll(runDir, 0o700); err != nil {
		daemon.finishRun(run.ID, "failure", fmt.Errorf("create run directory: %w", err), nil)
		return
	}
	_ = os.Chmod(runDir, 0o700)
	logPath := filepath.Join(runDir, "run.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		daemon.finishRun(run.ID, "failure", fmt.Errorf("create run log: %w", err), nil)
		return
	}
	defer logFile.Close()
	outputLog := &boundedLogWriter{writer: logFile, maxBytes: maxLogBytes}
	_, _ = fmt.Fprintf(logFile, "[%s] %s %s @ %s\n", time.Now().UTC().Format(time.RFC3339), run.RepoID, run.Ref, run.SHA)
	_ = logFile.Sync()

	workspace := filepath.Join(runDir, "workspace")
	defer os.RemoveAll(workspace)
	remote := gitremote.New(repo)
	checkoutCtx, cancelCheckout := context.WithTimeout(ctx, 10*time.Minute)
	checkoutErr := remote.Checkout(checkoutCtx, run.Ref, run.SHA, workspace)
	cancelCheckout()
	if checkoutErr != nil {
		fmt.Fprintf(logFile, "[checkout] %v\n", checkoutErr)
		_ = logFile.Sync()
		daemon.finishRun(run.ID, runStatus(ctx), checkoutErr, nil)
		return
	}

	pipeline, err := readPipeline(workspace, repo.Workflow, daemon.Config.Docker.DefaultImage)
	if err != nil {
		fmt.Fprintf(logFile, "[pipeline] %v\n", err)
		_ = logFile.Sync()
		daemon.finishRun(run.ID, "failure", err, nil)
		return
	}
	_ = daemon.Store.UpdateRun(run.ID, func(current *state.Run) { current.Workflow = pipeline.Name })
	fmt.Fprintf(logFile, "[pipeline] %s (%d jobs)\n", pipeline.Name, len(pipeline.Order))

	trusted := isTrusted(repo, run.Ref)
	allSecrets, err := collectSecrets(pipeline)
	if err != nil {
		fmt.Fprintf(logFile, "[security] %v\n", err)
		_ = logFile.Sync()
		daemon.finishRun(run.ID, "failure", err, nil)
		return
	}
	if len(allSecrets) > 0 && !trusted {
		err := fmt.Errorf("this ref is not trusted; secrets are never exposed to untrusted branches/tags")
		fmt.Fprintf(logFile, "[security] %v\n", err)
		_ = logFile.Sync()
		daemon.finishRun(run.ID, "failure", err, nil)
		return
	}
	allowed := make(map[string]bool, len(repo.AllowedSecrets))
	for _, name := range repo.AllowedSecrets {
		allowed[name] = true
	}
	for _, name := range allSecrets {
		if !allowed[name] {
			err := fmt.Errorf("pipeline requests secret %q which is not allowed by the runner config", name)
			fmt.Fprintf(logFile, "[security] %v\n", err)
			_ = logFile.Sync()
			daemon.finishRun(run.ID, "failure", err, nil)
			return
		}
	}
	secrets, err := security.Load(daemon.Config.StorageDir, repo.ID, allSecrets)
	if err != nil {
		fmt.Fprintf(logFile, "[security] %v\n", err)
		_ = logFile.Sync()
		daemon.finishRun(run.ID, "failure", err, nil)
		return
	}
	secretValues := make([]string, 0, len(secrets))
	for _, secret := range secrets {
		secretValues = append(secretValues, secret)
	}

	var artifactBytes int64
	for _, jobID := range pipeline.Order {
		if ctx.Err() != nil {
			daemon.finishRun(run.ID, runStatus(ctx), ctx.Err(), secretValues)
			return
		}
		job := pipeline.Jobs[jobID]
		fmt.Fprintf(logFile, "\n[%s] job: %s (%s)\n", time.Now().UTC().Format(time.RFC3339), jobID, job.Name)
		if err := daemon.executeJob(ctx, run, repo, jobID, job, workspace, logFile, outputLog, secrets, secretValues); err != nil {
			fmt.Fprintf(logFile, "[job failed] %s: %s\n", jobID, security.RedactText(err.Error(), secretValues))
			_ = logFile.Sync()
			daemon.finishRun(run.ID, runStatus(ctx), err, secretValues)
			return
		}
		artifacts, err := copyJobArtifacts(daemon.Config.StorageDir, run, jobID, workspace, job.Artifacts, daemon.Config.MaxArtifactBytesPerRun, &artifactBytes)
		if err != nil {
			message := security.RedactText(err.Error(), secretValues)
			fmt.Fprintf(logFile, "[artifacts] %s\n", message)
			_ = logFile.Sync()
			daemon.finishRun(run.ID, "failure", fmt.Errorf("collect artifacts for job %s: %s", jobID, message), secretValues)
			return
		}
		if len(artifacts) > 0 {
			if err := daemon.Store.UpdateRun(run.ID, func(current *state.Run) {
				current.Artifacts = append(current.Artifacts, artifacts...)
			}); err != nil {
				fmt.Fprintf(logFile, "[artifacts] could not record artifact paths: %v\n", err)
				daemon.finishRun(run.ID, "failure", err, secretValues)
				return
			}
			fmt.Fprintf(logFile, "[artifacts] retained %d file(s)\n", len(artifacts))
		}
		fmt.Fprintf(logFile, "[job passed] %s\n", jobID)
		_ = logFile.Sync()
	}
	fmt.Fprintf(logFile, "\n[complete] success\n")
	_ = logFile.Sync()
	daemon.finishRun(run.ID, "success", nil, secretValues)
}

func readPipeline(workspace, relative, defaultImage string) (*workflow.Workflow, error) {
	root, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace: %w", err)
	}
	candidate := filepath.Join(root, filepath.FromSlash(relative))
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return nil, fmt.Errorf("pipeline file %q is not readable: %w", relative, err)
	}
	relativePath, err := filepath.Rel(root, resolved)
	if err != nil || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) || filepath.IsAbs(relativePath) {
		return nil, fmt.Errorf("pipeline file resolves outside the checkout")
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > workflow.MaxWorkflowBytes {
		return nil, fmt.Errorf("pipeline must be a regular file no larger than 1 MiB")
	}
	contents, err := os.ReadFile(resolved)
	if err != nil {
		return nil, fmt.Errorf("read pipeline: %w", err)
	}
	return workflow.Parse(contents, defaultImage)
}

func collectSecrets(pipeline *workflow.Workflow) ([]string, error) {
	seen := make(map[string]bool)
	var names []string
	for _, jobID := range pipeline.Order {
		for _, name := range pipeline.Jobs[jobID].Secrets {
			if !seen[name] {
				seen[name] = true
				names = append(names, name)
			}
		}
	}
	return names, nil
}

func isTrusted(repo config.Repository, ref string) bool {
	if strings.HasPrefix(ref, "refs/heads/") {
		return refs.MatchesAny(repo.TrustedBranches, strings.TrimPrefix(ref, "refs/heads/"))
	}
	if strings.HasPrefix(ref, "refs/tags/") {
		return refs.MatchesAny(repo.TrustedTags, strings.TrimPrefix(ref, "refs/tags/"))
	}
	return false
}

func (daemon *Daemon) executeJob(ctx context.Context, run state.Run, repo config.Repository, jobID string, job workflow.Job,
	workspace string, logFile *os.File, outputLog io.Writer, secrets map[string]string, allSecretValues []string) error {
	jobCtx, cancel := context.WithTimeout(ctx, time.Duration(job.TimeoutMinutes)*time.Minute)
	defer cancel()
	jobEnv := make(map[string]string, len(job.Env)+len(job.Secrets)+12)
	for name, value := range job.Env {
		jobEnv[name] = fmt.Sprint(value)
	}
	for _, name := range job.Secrets {
		secret, ok := secrets[name]
		if !ok {
			return fmt.Errorf("secret %q is unavailable", name)
		}
		jobEnv[name] = secret
	}
	for name, value := range runnerContextEnv(run, repo) {
		jobEnv[name] = value
	}
	jobEnv["GITHUB_JOB"] = jobID

	jobSecrets := make([]string, 0, len(job.Secrets))
	for _, name := range job.Secrets {
		jobSecrets = append(jobSecrets, secrets[name])
	}
	for index, step := range job.Steps {
		if err := jobCtx.Err(); err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				return fmt.Errorf("job timed out after %d minutes", job.TimeoutMinutes)
			}
			return fmt.Errorf("run cancelled")
		}
		directory, err := workspaceDirectory(workspace, step.WorkingDirectory)
		if err != nil {
			return fmt.Errorf("step %q: %w", step.Name, err)
		}
		fmt.Fprintf(logFile, "[%s] step %d/%d: %s\n", time.Now().UTC().Format(time.RFC3339), index+1, len(job.Steps), step.Name)
		_ = logFile.Sync()
		request := StepRequest{
			Run:       run,
			Repo:      repo,
			JobID:     jobID,
			Job:       job,
			Step:      step,
			StepIndex: index,
			Workspace: workspace,
			Directory: directory,
			Env:       jobEnv,
			Secrets:   jobSecrets,
			Log:       outputLog,
		}
		if err := daemon.Docker.RunStep(jobCtx, request); err != nil {
			return security.RedactText(err.Error(), allSecretValues)
		}
	}
	return nil
}

func workspaceDirectory(workspace, relative string) (string, error) {
	root, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		return "", err
	}
	candidate := filepath.Join(root, filepath.FromSlash(relative))
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", fmt.Errorf("working directory does not exist: %s", relative)
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("working directory escapes the repository workspace")
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("working directory is not a directory: %s", relative)
	}
	return filepath.ToSlash(filepath.Join("/workspace", rel)), nil
}

func runnerContextEnv(run state.Run, repo config.Repository) map[string]string {
	eventName := "push"
	if run.Event == "manual" {
		eventName = "workflow_dispatch"
	}
	refName := strings.TrimPrefix(strings.TrimPrefix(run.Ref, "refs/heads/"), "refs/tags/")
	values := map[string]string{
		"CI":                 "true",
		"DIVE_CI_RUN_ID":     run.ID,
		"DIVE_CI_REPOSITORY": repo.ID,
		"DIVE_CI_REMOTE_URL": repo.URL,
		"DIVE_CI_REF":        run.Ref,
		"DIVE_CI_SHA":        run.SHA,
		"DIVE_CI_EVENT":      run.Event,
		"GITHUB_REF":         run.Ref,
		"GITHUB_REF_NAME":    refName,
		"GITHUB_SHA":         run.SHA,
		"GITHUB_EVENT_NAME":  eventName,
		"GITHUB_RUN_ID":      run.ID,
		"GITHUB_ACTIONS":     "true",
		"GITHUB_WORKSPACE":   "/workspace",
		"RUNNER_OS":          runtime.GOOS,
		"RUNNER_ARCH":        runtime.GOARCH,
	}
	if repoName := githubRepository(repo.URL); repoName != "" {
		values["GITHUB_REPOSITORY"] = repoName
	}
	return values
}

func githubRepository(remote string) string {
	parsed, err := url.Parse(remote)
	if err == nil && strings.EqualFold(parsed.Hostname(), "github.com") {
		name := strings.TrimSuffix(strings.TrimPrefix(parsed.Path, "/"), ".git")
		if strings.Count(name, "/") == 1 {
			return name
		}
	}
	if strings.Contains(remote, "@github.com:") {
		name := strings.TrimPrefix(strings.SplitN(remote, "@github.com:", 2)[1], "/")
		name = strings.TrimSuffix(name, ".git")
		if strings.Count(name, "/") == 1 {
			return name
		}
	}
	return ""
}

func (daemon *Daemon) finishRun(id, status string, runErr error, secretValues []string) {
	ended := time.Now().UTC()
	message := ""
	if runErr != nil {
		message = security.RedactText(runErr.Error(), secretValues)
	}
	if err := daemon.Store.UpdateRun(id, func(run *state.Run) {
		run.Status = status
		run.Error = message
		run.EndedAt = ended
	}); err != nil {
		fmt.Fprintf(os.Stderr, "[state] could not finish run %s: %v\n", id, err)
	}
	fmt.Printf("[run] %s %s (%s)\n", id, status, message)
}

func runStatus(ctx context.Context) string {
	if errors.Is(ctx.Err(), context.Canceled) {
		return "cancelled"
	}
	return "failure"
}

func (daemon *Daemon) repository(id string) (config.Repository, bool) {
	for _, repo := range daemon.Config.Repositories {
		if repo.ID == id {
			return repo, true
		}
	}
	return config.Repository{}, false
}

func (daemon *Daemon) cleanStaleContainers(ctx context.Context) error {
	result, err := process.Capture(ctx, daemon.Config.Docker.Binary,
		[]string{"ps", "--all", "--quiet", "--filter", "label=diveeoi.ci.instance=" + daemon.Store.InstanceID()},
		"", dockerClientEnv(), 8*1024*1024)
	if err != nil {
		return fmt.Errorf("find stale runner containers: %w", err)
	}
	var ids []string
	scanner := bufio.NewScanner(strings.NewReader(string(result.Stdout)))
	for scanner.Scan() {
		id := strings.TrimSpace(scanner.Text())
		if id != "" && isHexID(id) {
			ids = append(ids, id)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read stale container list: %w", err)
	}
	if len(ids) == 0 {
		return nil
	}
	args := append([]string{"rm", "--force"}, ids...)
	_, err = process.Capture(ctx, daemon.Config.Docker.Binary, args, "", dockerClientEnv(), 2*1024*1024)
	if err != nil {
		return fmt.Errorf("remove stale runner containers: %w", err)
	}
	fmt.Printf("[runner] removed %d orphaned container(s)\n", len(ids))
	return nil
}

func isHexID(value string) bool {
	if len(value) < 12 || len(value) > 64 {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func RunLogPath(storageDir string, run state.Run) (string, error) {
	if !runIDPattern.MatchString(run.ID) {
		return "", fmt.Errorf("run id is invalid")
	}
	root, err := filepath.Abs(storageDir)
	if err != nil {
		return "", err
	}
	expected := filepath.Join("runs", run.ID, "run.log")
	if filepath.Clean(run.LogFile) != expected {
		return "", fmt.Errorf("run log path is invalid")
	}
	runsRoot := filepath.Join(root, "runs")
	runsInfo, err := os.Lstat(runsRoot)
	if err != nil {
		return "", err
	}
	if !runsInfo.IsDir() || runsInfo.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("run directory root is not a real directory")
	}
	runDir := filepath.Join(runsRoot, run.ID)
	runInfo, err := os.Lstat(runDir)
	if err != nil {
		return "", err
	}
	if !runInfo.IsDir() || runInfo.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("run directory is not a real directory")
	}
	return filepath.Join(runDir, "run.log"), nil
}
