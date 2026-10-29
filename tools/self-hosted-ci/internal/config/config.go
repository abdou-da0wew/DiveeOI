package config

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/refs"
)

type Config struct {
	Version                int          `json:"version"`
	StorageDir             string       `json:"storageDir"`
	PollInterval           int          `json:"pollIntervalSeconds"`
	MaxConcurrentRuns      int          `json:"maxConcurrentRuns"`
	MaxArtifactBytesPerRun int64        `json:"maxArtifactBytesPerRun"`
	ArtifactRetentionDays  int          `json:"artifactRetentionDays"`
	Docker                 DockerConfig `json:"docker"`
	Repositories           []Repository `json:"repositories"`
	Path                   string       `json:"-"`
}

type DockerConfig struct {
	Binary       string  `json:"binary"`
	DefaultImage string  `json:"defaultImage"`
	CPUs         float64 `json:"cpus"`
	Memory       string  `json:"memory"`
	PidsLimit    int     `json:"pidsLimit"`
	Rootless     bool    `json:"rootless"`
}

type Repository struct {
	ID              string          `json:"id"`
	URL             string          `json:"url"`
	Branches        []string        `json:"branches"`
	Tags            []string        `json:"tags"`
	Workflow        string          `json:"workflow"`
	RunOnStart      bool            `json:"runOnStart"`
	TrustedBranches []string        `json:"trustedBranches"`
	TrustedTags     []string        `json:"trustedTags"`
	AllowedSecrets  []string        `json:"allowedSecrets"`
	GitCredentials  *GitCredentials `json:"gitCredentials,omitempty"`
}

type GitCredentials struct {
	Username string `json:"username"`
	TokenEnv string `json:"tokenEnv"`
}

var (
	repoIDPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	envNamePattern    = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)
	secretNamePattern = regexp.MustCompile(`^[A-Z_][A-Z0-9_]{0,127}$`)
	memoryPattern     = regexp.MustCompile(`^[0-9]+([kKmMgGtT]([iI]?[bB])?)?$`)
	scpURLPattern     = regexp.MustCompile(`^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:[A-Za-z0-9_./-]+$`)
)

func Load(path string) (*Config, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve config path: %w", err)
	}
	file, err := os.Open(absolute)
	if err != nil {
		return nil, fmt.Errorf("open config %q: %w", absolute, err)
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	var cfg Config
	if err := decoder.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("decode config %q: %w", absolute, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("config %q contains multiple JSON values", absolute)
		}
		return nil, fmt.Errorf("read config %q: %w", absolute, err)
	}
	cfg.Path = absolute
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}
	return &cfg, nil
}

func (cfg *Config) Validate() error {
	if cfg.Version != 1 {
		return fmt.Errorf("version must be 1")
	}
	if strings.TrimSpace(cfg.StorageDir) == "" {
		return fmt.Errorf("storageDir is required")
	}
	if strings.ContainsAny(cfg.StorageDir, ",\x00\r\n") {
		return fmt.Errorf("storageDir cannot contain commas, NUL, or newlines")
	}
	storage, err := filepath.Abs(cfg.StorageDir)
	if err != nil {
		return fmt.Errorf("storageDir: %w", err)
	}
	cfg.StorageDir = storage

	if cfg.PollInterval == 0 {
		cfg.PollInterval = 60
	}
	if cfg.PollInterval < 10 || cfg.PollInterval > 3600 {
		return fmt.Errorf("pollIntervalSeconds must be between 10 and 3600")
	}
	if cfg.MaxConcurrentRuns == 0 {
		cfg.MaxConcurrentRuns = 1
	}
	if cfg.MaxConcurrentRuns < 1 || cfg.MaxConcurrentRuns > 16 {
		return fmt.Errorf("maxConcurrentRuns must be between 1 and 16")
	}
	if cfg.MaxArtifactBytesPerRun == 0 {
		cfg.MaxArtifactBytesPerRun = 1 << 30
	}
	if cfg.MaxArtifactBytesPerRun < 1 || cfg.MaxArtifactBytesPerRun > 20*(1<<30) {
		return fmt.Errorf("maxArtifactBytesPerRun must be between 1 byte and 20 GiB")
	}
	if cfg.ArtifactRetentionDays == 0 {
		cfg.ArtifactRetentionDays = 14
	}
	if cfg.ArtifactRetentionDays < 1 || cfg.ArtifactRetentionDays > 365 {
		return fmt.Errorf("artifactRetentionDays must be between 1 and 365")
	}

	if cfg.Docker.Binary == "" {
		cfg.Docker.Binary = "docker"
	}
	if strings.ContainsAny(cfg.Docker.Binary, "\x00\r\n") {
		return fmt.Errorf("docker.binary contains invalid characters")
	}
	if cfg.Docker.DefaultImage == "" {
		cfg.Docker.DefaultImage = "debian:bookworm-slim"
	}
	if err := validateImage(cfg.Docker.DefaultImage); err != nil {
		return fmt.Errorf("docker.defaultImage: %w", err)
	}
	if cfg.Docker.CPUs == 0 {
		cfg.Docker.CPUs = 2
	}
	if cfg.Docker.CPUs < 0.25 || cfg.Docker.CPUs > 64 {
		return fmt.Errorf("docker.cpus must be between 0.25 and 64")
	}
	if cfg.Docker.Memory == "" {
		cfg.Docker.Memory = "2g"
	}
	if !memoryPattern.MatchString(cfg.Docker.Memory) {
		return fmt.Errorf("docker.memory must look like 512m or 2g")
	}
	if cfg.Docker.PidsLimit == 0 {
		cfg.Docker.PidsLimit = 256
	}
	if cfg.Docker.PidsLimit < 32 || cfg.Docker.PidsLimit > 8192 {
		return fmt.Errorf("docker.pidsLimit must be between 32 and 8192")
	}
	if len(cfg.Repositories) == 0 || len(cfg.Repositories) > 128 {
		return fmt.Errorf("repositories must contain between 1 and 128 entries")
	}

	seen := make(map[string]bool, len(cfg.Repositories))
	for i := range cfg.Repositories {
		repo := &cfg.Repositories[i]
		if !repoIDPattern.MatchString(repo.ID) {
			return fmt.Errorf("repositories[%d].id is invalid", i)
		}
		if seen[repo.ID] {
			return fmt.Errorf("duplicate repository id %q", repo.ID)
		}
		seen[repo.ID] = true
		if err := validateGitURL(repo.URL); err != nil {
			return fmt.Errorf("repository %q url: %w", repo.ID, err)
		}
		if len(repo.Branches) == 0 && len(repo.Tags) == 0 {
			return fmt.Errorf("repository %q must watch at least one branch or tag pattern", repo.ID)
		}
		if err := validatePatterns(repo.Branches); err != nil {
			return fmt.Errorf("repository %q branches: %w", repo.ID, err)
		}
		if err := validatePatterns(repo.Tags); err != nil {
			return fmt.Errorf("repository %q tags: %w", repo.ID, err)
		}
		if err := validatePatterns(repo.TrustedBranches); err != nil {
			return fmt.Errorf("repository %q trustedBranches: %w", repo.ID, err)
		}
		if err := validatePatterns(repo.TrustedTags); err != nil {
			return fmt.Errorf("repository %q trustedTags: %w", repo.ID, err)
		}
		if repo.Workflow == "" {
			repo.Workflow = ".diveeoi/pipeline.yml"
		}
		if err := validateRelativePath(repo.Workflow); err != nil {
			return fmt.Errorf("repository %q workflow: %w", repo.ID, err)
		}
		if err := validateNames(repo.AllowedSecrets, secretNamePattern); err != nil {
			return fmt.Errorf("repository %q allowedSecrets: %w", repo.ID, err)
		}
		for _, name := range repo.AllowedSecrets {
			if ReservedRunnerEnv(name) {
				return fmt.Errorf("repository %q allowedSecrets contains reserved runner variable %q", repo.ID, name)
			}
		}
		if repo.GitCredentials != nil {
			parsedURL, _ := url.Parse(repo.URL)
			if parsedURL.Scheme != "https" {
				return fmt.Errorf("repository %q gitCredentials are only supported for HTTPS remotes", repo.ID)
			}
			if !envNamePattern.MatchString(repo.GitCredentials.TokenEnv) || !strings.HasPrefix(repo.GitCredentials.TokenEnv, "DIVE_CI_") {
				return fmt.Errorf("repository %q gitCredentials.tokenEnv must be a valid name with the DIVE_CI_ prefix", repo.ID)
			}
			if reservedGitTokenEnvironment(repo.GitCredentials.TokenEnv) {
				return fmt.Errorf("repository %q gitCredentials.tokenEnv collides with a runner environment variable", repo.ID)
			}
			if repo.GitCredentials.Username == "" {
				repo.GitCredentials.Username = "x-access-token"
			}
			if strings.ContainsAny(repo.GitCredentials.Username, "\x00\r\n") {
				return fmt.Errorf("repository %q gitCredentials.username contains invalid characters", repo.ID)
			}
		}
	}
	return nil
}

func validateImage(image string) error {
	if strings.TrimSpace(image) == "" || strings.ContainsAny(image, "\x00\r\n") || strings.ContainsAny(image, " \t") || strings.HasPrefix(image, "-") {
		return fmt.Errorf("must be a Docker image reference")
	}
	return nil
}

func ValidateImage(image string) error { return validateImage(image) }

// ReservedRunnerEnv returns true for names that could alter the host-side Docker client,
// Git process, dynamic loader, or runner-managed context.
func ReservedRunnerEnv(name string) bool {
	upper := strings.ToUpper(name)
	for _, exact := range []string{
		"CI", "HOME", "PATH", "SHELL", "IFS", "ENV", "BASH_ENV", "TMPDIR",
		"DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH",
		"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSH_AUTH_SOCK", "XDG_RUNTIME_DIR",
		"GITHUB_REF", "GITHUB_REF_NAME", "GITHUB_SHA", "GITHUB_REPOSITORY", "GITHUB_EVENT_NAME", "GITHUB_RUN_ID",
		"GITHUB_ACTIONS", "GITHUB_WORKSPACE", "GITHUB_JOB", "RUNNER_OS", "RUNNER_ARCH",
	} {
		if upper == exact {
			return true
		}
	}
	for _, prefix := range []string{"DIVE_CI_", "DOCKER_", "GIT_", "LD_", "DYLD_", "BASH_FUNC_", "SSL_CERT_"} {
		if strings.HasPrefix(upper, prefix) {
			return true
		}
	}
	return false
}

func validatePatterns(patterns []string) error {
	seen := make(map[string]bool, len(patterns))
	for _, pattern := range patterns {
		if _, err := refs.Match(pattern, "test"); err != nil {
			return err
		}
		if seen[pattern] {
			return fmt.Errorf("duplicate pattern %q", pattern)
		}
		seen[pattern] = true
	}
	return nil
}

func validateNames(names []string, pattern *regexp.Regexp) error {
	seen := make(map[string]bool, len(names))
	for _, name := range names {
		if !pattern.MatchString(name) {
			return fmt.Errorf("invalid name %q", name)
		}
		if seen[name] {
			return fmt.Errorf("duplicate name %q", name)
		}
		seen[name] = true
	}
	return nil
}

func reservedGitTokenEnvironment(name string) bool {
	for _, reserved := range []string{
		"PATH", "HOME", "TMPDIR", "SSH_AUTH_SOCK", "GIT_SSH_COMMAND",
		"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
		"SSL_CERT_FILE", "SSL_CERT_DIR", "GIT_SSL_CAINFO", "GIT_SSL_CAPATH",
	} {
		if strings.EqualFold(name, reserved) {
			return true
		}
	}
	return false
}

func validateGitURL(raw string) error {
	if raw == "" || len(raw) > 2048 || strings.ContainsAny(raw, "\x00\r\n") {
		return fmt.Errorf("must be a non-empty Git URL")
	}
	if scpURLPattern.MatchString(raw) {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse URL: %w", err)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "ssh" && parsed.Scheme != "git" {
		return fmt.Errorf("only HTTPS, SSH, git://, or user@host:path remotes are supported")
	}
	if parsed.User != nil {
		_, hasPassword := parsed.User.Password()
		if parsed.Scheme != "ssh" || hasPassword {
			return fmt.Errorf("URL must not embed username or password credentials (SSH usernames are allowed)")
		}
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Host == "" {
		return fmt.Errorf("URL must have a host and no query or fragment")
	}
	return nil
}

func validateRelativePath(value string) error {
	if value == "" || len(value) > 512 || strings.ContainsAny(value, "\\\x00\r\n") || filepath.IsAbs(value) {
		return fmt.Errorf("must be a safe relative path")
	}
	clean := filepath.Clean(value)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return fmt.Errorf("cannot escape the repository root")
	}
	return nil
}
