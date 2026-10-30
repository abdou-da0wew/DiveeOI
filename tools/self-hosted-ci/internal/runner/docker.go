package runner

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/config"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/process"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/security"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/state"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/workflow"
)

type DockerExecutor struct {
	Config     config.DockerConfig
	InstanceID string
}

type StepRequest struct {
	Run       state.Run
	Repo      config.Repository
	JobID     string
	Job       workflow.Job
	Step      workflow.Step
	StepIndex int
	Workspace string
	Directory string
	Env       map[string]string
	Secrets   []string
	Log       io.Writer
}

func CheckDocker(ctx context.Context, binary string, expectRootless bool) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if runtime.GOOS != "linux" {
		return fmt.Errorf("the isolated executor currently requires a Linux host")
	}
	if os.Geteuid() == 0 {
		return fmt.Errorf("refusing to run the self-hosted CI daemon as root; use a dedicated unprivileged service user")
	}
	dockerHost := os.Getenv("DOCKER_HOST")
	if dockerHost != "" && !strings.HasPrefix(dockerHost, "unix://") {
		return fmt.Errorf("remote or non-Unix Docker daemons are not supported; use a local Unix socket")
	}
	contextName := strings.TrimSpace(os.Getenv("DOCKER_CONTEXT"))
	if contextName == "" && dockerHost == "" {
		current, err := process.Capture(ctx, binary, []string{"context", "show"}, "", dockerClientEnv(), 1024*1024)
		if err != nil {
			return fmt.Errorf("cannot determine Docker context: %w", err)
		}
		contextName = strings.TrimSpace(string(current.Stdout))
	}
	if contextName != "" {
		endpoint, err := process.Capture(ctx, binary,
			[]string{"context", "inspect", "--format", "{{.Endpoints.docker.Host}}", contextName}, "", dockerClientEnv(), 1024*1024)
		if err != nil {
			return fmt.Errorf("cannot inspect Docker context %q: %w", contextName, err)
		}
		endpointHost := strings.TrimSpace(string(endpoint.Stdout))
		if endpointHost != "" && !strings.HasPrefix(endpointHost, "unix://") {
			return fmt.Errorf("remote Docker context %q is not supported; use a local Unix socket", endpointHost)
		}
	}
	info, err := process.Capture(ctx, binary, []string{"info", "--format", "{{json .SecurityOptions}}"}, "", dockerClientEnv(), 1024*1024)
	if err != nil {
		return fmt.Errorf("Docker is unavailable or the service user cannot access it: %w", err)
	}
	actualRootless := strings.Contains(strings.ToLower(string(info.Stdout)), "rootless")
	if expectRootless != actualRootless {
		return fmt.Errorf("docker.rootless=%t does not match the connected daemon (rootless=%t)", expectRootless, actualRootless)
	}
	return nil
}

func DockerArgs(cfg config.DockerConfig, instanceID string, request StepRequest, containerName string) []string {
	args := []string{
		"run", "--rm",
		"--name", containerName,
		"--init",
		"--read-only",
		"--network=bridge",
		"--cap-drop=ALL",
		"--security-opt=no-new-privileges:true",
		"--pids-limit", fmt.Sprint(cfg.PidsLimit),
		"--memory", cfg.Memory,
		"--cpus", fmt.Sprintf("%g", cfg.CPUs),
		"--tmpfs", "/tmp:rw,nosuid,nodev,size=512m",
		"--tmpfs", "/var/tmp:rw,nosuid,nodev,size=128m",
		"--workdir", request.Directory,
		"--mount", "type=bind,source=" + request.Workspace + ",target=/workspace",
		"--label", "diveeoi.ci.managed=true",
		"--label", "diveeoi.ci.instance=" + instanceID,
		"--label", "diveeoi.ci.run=" + request.Run.ID,
	}
	if cfg.Rootless {
		// In rootless Docker, container UID 0 maps to the unprivileged runner account on the host.
		args = append(args, "--user", "0:0")
	} else if os.Geteuid() >= 0 && os.Getegid() >= 0 {
		args = append(args, "--user", fmt.Sprintf("%d:%d", os.Geteuid(), os.Getegid()))
	}
	args = append(args, "--env", "HOME=/tmp/diveeoi-ci-home")
	for _, name := range sortedKeys(request.Env) {
		args = append(args, "--env", name)
	}
	image := request.Job.Image
	if image == "" {
		image = cfg.DefaultImage
	}
	script := "mkdir -p \"$HOME\" && " + request.Step.Run
	args = append(args, "--entrypoint", "/bin/sh", image, "-euc", script)
	return args
}

func (executor *DockerExecutor) RunStep(ctx context.Context, request StepRequest) error {
	if request.Log == nil {
		return fmt.Errorf("run log is not available")
	}
	if err := validateExecutionEnv(request.Env); err != nil {
		return err
	}
	if !filepath.IsAbs(request.Workspace) || !filepath.IsAbs(request.Directory) {
		return fmt.Errorf("workspace and step directory must be absolute paths")
	}
	name := containerName(request.Run.ID, request.JobID, request.StepIndex)
	args := DockerArgs(executor.Config, executor.InstanceID, request, name)
	cmd := exec.Command(executor.Config.Binary, args...)
	cmd.Dir = request.Workspace
	cmd.Env = dockerClientEnvWith(request.Env)

	logMu := &sync.Mutex{}
	redactSecrets := append([]string(nil), request.Secrets...)
	out := security.NewStreamRedactor(&lockedWriter{mu: logMu, writer: request.Log}, redactSecrets)
	errOut := security.NewStreamRedactor(&lockedWriter{mu: logMu, writer: request.Log}, redactSecrets)
	cmd.Stdout = out
	cmd.Stderr = errOut
	if err := cmd.Start(); err != nil {
		_ = out.Close()
		_ = errOut.Close()
		return fmt.Errorf("start Docker step: %w", err)
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	var runErr error
	select {
	case runErr = <-done:
	case <-ctx.Done():
		stopCtx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		_ = executor.stopContainer(stopCtx, name)
		cancel()
		_ = cmd.Process.Signal(syscall.SIGTERM)
		select {
		case runErr = <-done:
		case <-time.After(3 * time.Second):
			_ = cmd.Process.Kill()
			runErr = <-done
		}
	}
	_ = out.Close()
	_ = errOut.Close()
	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 8*time.Second)
	_ = executor.removeContainer(cleanupCtx, name)
	cleanupCancel()

	if ctx.Err() != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("step timed out")
		}
		return fmt.Errorf("step cancelled")
	}
	if runErr != nil {
		var exitError *exec.ExitError
		if errors.As(runErr, &exitError) {
			return fmt.Errorf("Docker step exited with status %d", exitError.ExitCode())
		}
		return fmt.Errorf("Docker step failed: %w", runErr)
	}
	return nil
}

func validateExecutionEnv(env map[string]string) error {
	for name, value := range env {
		if !envNamePattern.MatchString(name) {
			return fmt.Errorf("invalid environment variable name %q", name)
		}
		if isHostSensitiveEnv(name) {
			return fmt.Errorf("environment variable %q is reserved to protect the runner process", name)
		}
		if strings.ContainsRune(value, '\x00') {
			return fmt.Errorf("environment variable %q contains NUL", name)
		}
	}
	return nil
}

var envNamePattern = regexpMustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)

func isHostSensitiveEnv(name string) bool {
	upper := strings.ToUpper(name)
	if upper == "CI" || strings.HasPrefix(upper, "DIVE_CI_") || strings.HasPrefix(upper, "GITHUB_") {
		// These values are injected by the runner, not accepted from workflow config/secrets.
		return false
	}
	return config.ReservedRunnerEnv(name)
}

func regexpMustCompile(expression string) *regexp.Regexp {
	return regexp.MustCompile(expression)
}

func dockerClientEnv() []string {
	return dockerClientEnvWith(nil)
}

func dockerClientEnvWith(containerEnv map[string]string) []string {
	allowed := []string{
		"PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH",
		"XDG_RUNTIME_DIR", "SSH_AUTH_SOCK", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR",
	}
	values := make(map[string]string, len(allowed)+len(containerEnv))
	for _, name := range allowed {
		if value, ok := os.LookupEnv(name); ok {
			values[name] = value
		}
	}
	for name, value := range containerEnv {
		values[name] = value
	}
	keys := sortedKeys(values)
	result := make([]string, 0, len(keys))
	for _, key := range keys {
		result = append(result, key+"="+values[key])
	}
	return result
}

func sortedKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func containerName(runID, jobID string, step int) string {
	shortID := runID
	if len(shortID) > 12 {
		shortID = shortID[:12]
	}
	jobID = strings.ToLower(jobID)
	jobID = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return '-'
	}, jobID)
	return fmt.Sprintf("diveeoi-ci-%s-%s-s%d", shortID, jobID, step+1)
}

func (executor *DockerExecutor) stopContainer(ctx context.Context, name string) error {
	_, err := process.Capture(ctx, executor.Config.Binary, []string{"stop", "--time=5", name}, "", dockerClientEnv(), 1024*1024)
	return err
}

func (executor *DockerExecutor) removeContainer(ctx context.Context, name string) error {
	_, err := process.Capture(ctx, executor.Config.Binary, []string{"rm", "--force", name}, "", dockerClientEnv(), 1024*1024)
	return err
}

type lockedWriter struct {
	mu     *sync.Mutex
	writer io.Writer
}

func (writer *lockedWriter) Write(value []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	return writer.writer.Write(value)
}
