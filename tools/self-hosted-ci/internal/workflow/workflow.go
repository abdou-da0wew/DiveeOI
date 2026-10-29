package workflow

import (
	"bytes"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/config"
	"gopkg.in/yaml.v3"
)

const (
	MaxWorkflowBytes = 1 << 20
	MaxJobs          = 50
	MaxSteps         = 100
	MaxTimeoutMin    = 24 * 60
)

var (
	jobIDPattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	secretPattern  = regexp.MustCompile(`^[A-Z_][A-Z0-9_]{0,127}$`)
	envNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)
)

type Workflow struct {
	Version int            `yaml:"version"`
	Name    string         `yaml:"name"`
	Jobs    map[string]Job `yaml:"jobs"`
	Order   []string       `yaml:"-"`
}

type Job struct {
	Name           string         `yaml:"name"`
	Image          string         `yaml:"image"`
	Needs          []string       `yaml:"needs"`
	TimeoutMinutes int            `yaml:"timeoutMinutes"`
	Env            map[string]any `yaml:"env"`
	Secrets        []string       `yaml:"secrets"`
	Artifacts      []string       `yaml:"artifacts"`
	Steps          []Step         `yaml:"steps"`
}

type Step struct {
	Name             string `yaml:"name"`
	Run              string `yaml:"run"`
	WorkingDirectory string `yaml:"workingDirectory"`
}

func Parse(source []byte, defaultImage string) (*Workflow, error) {
	if len(source) == 0 || len(source) > MaxWorkflowBytes {
		return nil, fmt.Errorf("pipeline must be non-empty and at most 1 MiB")
	}
	decoder := yaml.NewDecoder(bytes.NewReader(source))
	decoder.KnownFields(true)
	var parsed Workflow
	if err := decoder.Decode(&parsed); err != nil {
		return nil, fmt.Errorf("parse pipeline YAML: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("pipeline must contain exactly one YAML document")
		}
		return nil, fmt.Errorf("read pipeline YAML: %w", err)
	}
	if parsed.Version != 1 {
		return nil, fmt.Errorf("pipeline.version must be 1")
	}
	if parsed.Name == "" {
		parsed.Name = "pipeline"
	}
	if len(parsed.Name) > 128 || strings.ContainsAny(parsed.Name, "\x00\r\n") {
		return nil, fmt.Errorf("pipeline.name is invalid")
	}
	if len(parsed.Jobs) == 0 || len(parsed.Jobs) > MaxJobs {
		return nil, fmt.Errorf("pipeline.jobs must contain 1 to %d jobs", MaxJobs)
	}

	for id, job := range parsed.Jobs {
		if !jobIDPattern.MatchString(id) {
			return nil, fmt.Errorf("invalid job id %q", id)
		}
		if job.Name == "" {
			job.Name = id
		}
		if len(job.Name) > 128 || strings.ContainsAny(job.Name, "\x00\r\n") {
			return nil, fmt.Errorf("jobs.%s.name is invalid", id)
		}
		if job.Image == "" {
			job.Image = defaultImage
		}
		if err := config.ValidateImage(job.Image); err != nil {
			return nil, fmt.Errorf("jobs.%s.image: %w", id, err)
		}
		if job.TimeoutMinutes == 0 {
			job.TimeoutMinutes = 30
		}
		if job.TimeoutMinutes < 1 || job.TimeoutMinutes > MaxTimeoutMin {
			return nil, fmt.Errorf("jobs.%s.timeoutMinutes must be between 1 and %d", id, MaxTimeoutMin)
		}
		if len(job.Steps) == 0 || len(job.Steps) > MaxSteps {
			return nil, fmt.Errorf("jobs.%s.steps must contain 1 to %d steps", id, MaxSteps)
		}
		if err := validateEnv(job.Env, id); err != nil {
			return nil, err
		}
		seenSecrets := make(map[string]bool)
		for _, name := range job.Secrets {
			if !secretPattern.MatchString(name) {
				return nil, fmt.Errorf("jobs.%s.secrets contains invalid name %q", id, name)
			}
			if config.ReservedRunnerEnv(name) {
				return nil, fmt.Errorf("jobs.%s.secrets contains reserved runner variable %q", id, name)
			}
			if seenSecrets[name] {
				return nil, fmt.Errorf("jobs.%s.secrets contains duplicate %q", id, name)
			}
			seenSecrets[name] = true
		}
		seenArtifacts := make(map[string]bool)
		for _, artifact := range job.Artifacts {
			if err := validateRelativePath(artifact); err != nil {
				return nil, fmt.Errorf("jobs.%s.artifacts path %q: %w", id, artifact, err)
			}
			if strings.ContainsAny(artifact, "*?[]") {
				return nil, fmt.Errorf("jobs.%s.artifacts currently accepts explicit paths, not globs", id)
			}
			cleanArtifact := filepath.ToSlash(filepath.Clean(artifact))
			if cleanArtifact == "." {
				return nil, fmt.Errorf("jobs.%s.artifacts cannot include the entire workspace", id)
			}
			for _, segment := range strings.Split(cleanArtifact, "/") {
				if segment == ".git" {
					return nil, fmt.Errorf("jobs.%s.artifacts cannot include the Git metadata directory", id)
				}
			}
			for existing := range seenArtifacts {
				if cleanArtifact == existing || strings.HasPrefix(cleanArtifact, existing+"/") || strings.HasPrefix(existing, cleanArtifact+"/") {
					return nil, fmt.Errorf("jobs.%s.artifacts paths overlap: %q and %q", id, existing, cleanArtifact)
				}
			}
			seenArtifacts[cleanArtifact] = true
		}
		for index := range job.Steps {
			step := &job.Steps[index]
			if step.Name == "" {
				step.Name = fmt.Sprintf("step-%d", index+1)
			}
			if len(step.Name) > 128 || strings.ContainsAny(step.Name, "\x00\r\n") {
				return nil, fmt.Errorf("jobs.%s.steps[%d].name is invalid", id, index)
			}
			if step.Run == "" || len(step.Run) > 64*1024 || strings.ContainsRune(step.Run, '\x00') {
				return nil, fmt.Errorf("jobs.%s.steps[%d].run must contain 1 to 65536 characters", id, index)
			}
			if step.WorkingDirectory == "" {
				step.WorkingDirectory = "."
			}
			if err := validateRelativePath(step.WorkingDirectory); err != nil {
				return nil, fmt.Errorf("jobs.%s.steps[%d].workingDirectory: %w", id, index, err)
			}
		}
		parsed.Jobs[id] = job
	}

	order, err := topologicalOrder(parsed.Jobs)
	if err != nil {
		return nil, err
	}
	parsed.Order = order
	return &parsed, nil
}

func validateEnv(env map[string]any, jobID string) error {
	for name, value := range env {
		if !envNamePattern.MatchString(name) {
			return fmt.Errorf("jobs.%s.env has invalid name %q", jobID, name)
		}
		if config.ReservedRunnerEnv(name) || strings.HasPrefix(strings.ToUpper(name), "GITHUB_") {
			return fmt.Errorf("jobs.%s.env.%s is reserved", jobID, name)
		}
		switch value.(type) {
		case string, bool, int, int64, uint64, float64:
		default:
			return fmt.Errorf("jobs.%s.env.%s must be a scalar", jobID, name)
		}
		text := fmt.Sprint(value)
		if strings.ContainsRune(text, '\x00') {
			return fmt.Errorf("jobs.%s.env.%s contains NUL", jobID, name)
		}
	}
	return nil
}

func topologicalOrder(jobs map[string]Job) ([]string, error) {
	state := make(map[string]uint8, len(jobs))
	order := make([]string, 0, len(jobs))
	var visit func(string, []string) error
	visit = func(id string, chain []string) error {
		if state[id] == 1 {
			return fmt.Errorf("pipeline job dependency cycle: %s", strings.Join(append(chain, id), " -> "))
		}
		if state[id] == 2 {
			return nil
		}
		job, exists := jobs[id]
		if !exists {
			return fmt.Errorf("pipeline needs unknown job %q", id)
		}
		state[id] = 1
		seen := make(map[string]bool)
		for _, dependency := range job.Needs {
			if dependency == id {
				return fmt.Errorf("job %q cannot depend on itself", id)
			}
			if seen[dependency] {
				return fmt.Errorf("job %q has duplicate dependency %q", id, dependency)
			}
			seen[dependency] = true
			if err := visit(dependency, append(chain, id)); err != nil {
				return err
			}
		}
		state[id] = 2
		order = append(order, id)
		return nil
	}
	ids := make([]string, 0, len(jobs))
	for id := range jobs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if err := visit(id, nil); err != nil {
			return nil, err
		}
	}
	return order, nil
}

func validateRelativePath(value string) error {
	if value == "" || len(value) > 512 || strings.ContainsAny(value, "\\\x00\r\n") || filepath.IsAbs(value) {
		return fmt.Errorf("must be a safe relative path")
	}
	clean := filepath.Clean(value)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return fmt.Errorf("cannot escape the workspace")
	}
	return nil
}
