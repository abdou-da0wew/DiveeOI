package config

import (
	"encoding/json"
	"strings"
	"testing"
)

func validConfig() Config {
	return Config{
		Version:    1,
		StorageDir: "/var/lib/diveeoi-ci",
		Repositories: []Repository{{
			ID:       "web",
			URL:      "https://github.com/example/web.git",
			Branches: []string{"main", "release/*"},
			Tags:     []string{"v*"},
		}},
	}
}

func TestValidateDefaultsAndGitHubAppNeutralConfig(t *testing.T) {
	cfg := validConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	if cfg.PollInterval != 60 || cfg.MaxConcurrentRuns != 1 || cfg.Docker.DefaultImage != "debian:bookworm-slim" || cfg.MaxArtifactBytesPerRun != 1<<30 || cfg.ArtifactRetentionDays != 14 {
		t.Fatalf("defaults not applied: %+v", cfg)
	}
}

func TestValidateRejectsEmbeddedGitCredentials(t *testing.T) {
	cfg := validConfig()
	cfg.Repositories[0].URL = "https://user:password@example.com/org/repo.git"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected embedded credentials to be rejected")
	}
}

func TestGitTokenEnvironmentIsHTTPSOnlyAndDoesNotShadowRuntimeVars(t *testing.T) {
	cfg := validConfig()
	cfg.Repositories[0].GitCredentials = &GitCredentials{Username: "x-access-token", TokenEnv: "DIVE_CI_GITHUB_TOKEN"}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("HTTPS token configuration should be accepted: %v", err)
	}

	cfg = validConfig()
	cfg.Repositories[0].GitCredentials = &GitCredentials{TokenEnv: "PATH"}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected runtime environment collision to be rejected")
	}

	cfg = validConfig()
	cfg.Repositories[0].URL = "ssh://git@example.com/org/repo.git"
	cfg.Repositories[0].GitCredentials = &GitCredentials{TokenEnv: "DIVE_CI_GITHUB_TOKEN"}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected HTTPS token credentials on SSH to be rejected")
	}
}

func TestValidateRejectsReservedSecretNames(t *testing.T) {
	cfg := validConfig()
	cfg.Repositories[0].AllowedSecrets = []string{"DOCKER_HOST"}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected reserved environment variable to be rejected")
	}
}

func TestConfigHasNoSecretValueFields(t *testing.T) {
	bytes, err := json.Marshal(validConfig())
	if err != nil {
		t.Fatal(err)
	}
	serialized := string(bytes)
	if serialized == "" || strings.Contains(serialized, "password") || strings.Contains(serialized, "tokenValue") || strings.Contains(serialized, "privateKey") {
		t.Fatalf("unexpected credentials in config serialization: %s", bytes)
	}
}
