package gitremote

import (
	"strings"
	"testing"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/config"
)

func TestGitEnvironmentIsAllowlistedAndDoesNotForwardToken(t *testing.T) {
	t.Setenv("PATH", "/usr/bin")
	t.Setenv("HOME", "/tmp/runner-home")
	t.Setenv("DIVE_CI_GITHUB_TOKEN", "do-not-forward")
	t.Setenv("GIT_CONFIG_COUNT", "1")
	t.Setenv("HTTP_PROXY", "http://proxy.invalid")
	environment := gitEnvironment(&config.GitCredentials{TokenEnv: "DIVE_CI_GITHUB_TOKEN"}, map[string]string{
		"GIT_TERMINAL_PROMPT": "0",
	})
	joined := strings.Join(environment, "\n")
	for _, allowed := range []string{"PATH=/usr/bin", "HOME=/tmp/runner-home", "HTTP_PROXY=http://proxy.invalid", "GIT_TERMINAL_PROMPT=0"} {
		if !strings.Contains(joined, allowed) {
			t.Errorf("expected allowed environment entry %q in %q", allowed, joined)
		}
	}
	for _, forbidden := range []string{"do-not-forward", "GIT_CONFIG_COUNT"} {
		if strings.Contains(joined, forbidden) {
			t.Errorf("unexpected environment entry %q in %q", forbidden, joined)
		}
	}
}
