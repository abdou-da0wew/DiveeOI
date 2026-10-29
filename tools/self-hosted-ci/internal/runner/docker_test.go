package runner

import (
	"strings"
	"testing"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/config"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/state"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/workflow"
)

func TestDockerArgsUseConstrainedContainerAndDoNotPutSecretInArguments(t *testing.T) {
	cfg := config.DockerConfig{Binary: "docker", DefaultImage: "node:22", CPUs: 1, Memory: "1g", PidsLimit: 128}
	request := StepRequest{
		Run:       state.Run{ID: "1234567890abcdef"},
		JobID:     "build",
		Job:       workflow.Job{Image: "node:22"},
		Step:      workflow.Step{Run: "npm test"},
		Workspace: "/var/lib/diveeoi-ci/runs/abc/workspace",
		Directory: "/workspace",
		Env:       map[string]string{"NPM_TOKEN": "secret-value", "DIVE_CI_SHA": "abcdef"},
	}
	args := DockerArgs(cfg, "instance123", request, "ci-container")
	joined := strings.Join(args, " ")
	for _, required := range []string{"--read-only", "--network=bridge", "--cap-drop=ALL", "--pids-limit 128", "--memory 1g", "--cpus 1", "--security-opt=no-new-privileges:true", "--env NPM_TOKEN"} {
		if !strings.Contains(joined, required) {
			t.Errorf("missing Docker hardening/setting %q in %s", required, joined)
		}
	}
	for _, forbidden := range []string{"--privileged", "docker.sock", "secret-value"} {
		if strings.Contains(joined, forbidden) {
			t.Errorf("unsafe value %q found in Docker arguments: %s", forbidden, joined)
		}
	}
}

func TestWorkflowCannotOverrideDockerClientEnvironment(t *testing.T) {
	if err := validateExecutionEnv(map[string]string{"DOCKER_HOST": "tcp://attacker"}); err == nil {
		t.Fatal("expected Docker host override to be rejected")
	}
	if err := validateExecutionEnv(map[string]string{"GITHUB_TOKEN": "scoped-token", "DIVE_CI_SHA": "abc"}); err != nil {
		t.Fatalf("runner context and a scoped GitHub token should be accepted: %v", err)
	}
}
