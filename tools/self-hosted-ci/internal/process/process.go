package process

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type Result struct {
	Stdout []byte
	Stderr []byte
}

type Error struct {
	Command string
	Code    int
	Stderr  string
	Err     error
}

func (e *Error) Error() string {
	if e.Stderr != "" {
		return fmt.Sprintf("%s failed (exit %d): %s", e.Command, e.Code, strings.TrimSpace(e.Stderr))
	}
	if e.Err != nil {
		return fmt.Sprintf("%s failed: %v", e.Command, e.Err)
	}
	return fmt.Sprintf("%s failed (exit %d)", e.Command, e.Code)
}

func (e *Error) Unwrap() error { return e.Err }

func Capture(ctx context.Context, command string, args []string, directory string, env []string, maxBytes int64) (Result, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = directory
	if env != nil {
		cmd.Env = env
	}
	var stdout, stderr limitedBuffer
	stdout.limit = maxBytes
	stderr.limit = maxBytes
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	result := Result{Stdout: stdout.Bytes(), Stderr: stderr.Bytes()}
	if stdout.exceeded || stderr.exceeded {
		return result, fmt.Errorf("%s produced more than %d output bytes", command, maxBytes)
	}
	if err != nil {
		var exitError *exec.ExitError
		code := -1
		if errors.As(err, &exitError) {
			code = exitError.ExitCode()
		}
		return result, &Error{Command: command, Code: code, Stderr: string(result.Stderr), Err: err}
	}
	return result, nil
}

type limitedBuffer struct {
	buffer   bytes.Buffer
	limit    int64
	exceeded bool
}

func (b *limitedBuffer) Write(input []byte) (int, error) {
	if int64(b.buffer.Len()+len(input)) > b.limit {
		b.exceeded = true
		remaining := b.limit - int64(b.buffer.Len())
		if remaining > 0 {
			_, _ = b.buffer.Write(input[:remaining])
		}
		return len(input), nil
	}
	return b.buffer.Write(input)
}

func (b *limitedBuffer) Bytes() []byte { return b.buffer.Bytes() }

func EnvWith(values map[string]string) []string {
	env := os.Environ()
	for key, value := range values {
		env = setEnv(env, key, value)
	}
	return env
}

func setEnv(environment []string, name, value string) []string {
	prefix := name + "="
	for index, entry := range environment {
		if strings.HasPrefix(entry, prefix) {
			environment[index] = prefix + value
			return environment
		}
	}
	return append(environment, prefix+value)
}
