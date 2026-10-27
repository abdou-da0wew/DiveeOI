// Package main implements celest: a two-part, outbound-only remote shell link.
//
// The relay runs on a host that is reachable over HTTPS (here: the sandbox,
// exposed through the preview proxy). The agent runs on the target machine and
// dials *out* to the relay, long-polling for jobs and posting results back.
// No inbound port, no SSH, no public IP needed on the target.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const Version = "0.1.0"

// Defaults.
const (
	defaultAddr    = "0.0.0.0:8080"
	defaultState   = "state.json"
	defaultPollSec = 20
	maxStreamBytes = 256 << 10 // cap per stream so a runaway command can't flood us
)

// Job kinds.
const (
	KindExec  = "exec"
	KindRead  = "read"
	KindWrite = "write"
	KindInfo  = "info"
)

// Job is one unit of work handed to the agent.
type Job struct {
	ID      string    `json:"id"`
	Kind    string    `json:"kind"`
	Cmd     string    `json:"cmd,omitempty"`
	Path    string    `json:"path,omitempty"`
	Cwd     string    `json:"cwd,omitempty"`
	Data    string    `json:"data,omitempty"` // base64, KindWrite
	Timeout int       `json:"timeout,omitempty"`
	Created time.Time `json:"created"`
	Env     []string  `json:"env,omitempty"`
}

// Result is what the agent reports back for a Job.
type Result struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Exit      int       `json:"exit"`
	Stdout    string    `json:"stdout,omitempty"`
	Stderr    string    `json:"stderr,omitempty"`
	Data      string    `json:"data,omitempty"` // base64, KindRead/KindInfo
	Truncated bool      `json:"truncated,omitempty"`
	Err       string    `json:"err,omitempty"`
	Started   time.Time `json:"started"`
	Ended     time.Time `json:"ended"`
	Host      string    `json:"host,omitempty"`
	AgentVer  string    `json:"agent_version,omitempty"`
}

// Status is the relay's view of the world, used by `celest status`.
type Status struct {
	Version     string    `json:"version"`
	AgentOnline bool      `json:"agent_online"`
	AgentHost   string    `json:"agent_host,omitempty"`
	LastPoll    time.Time `json:"last_poll,omitempty"`
	QueueDepth  int       `json:"queue_depth"`
	JobsTotal   int       `json:"jobs_total"`
	JobsDone    int       `json:"jobs_done"`
}

// InfoPayload is returned by KindInfo, giving the agent's self-description.
type InfoPayload struct {
	Hostname string   `json:"hostname"`
	GOOS     string   `json:"goos"`
	GOARCH   string   `json:"goarch"`
	User     string   `json:"user"`
	Pid      int      `json:"pid"`
	Cwd      string   `json:"cwd"`
	Version  string   `json:"version"`
	Env      []string `json:"env"`
}

/* ---------------------------------------------------------------- helpers */

func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func newToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// defaultTokenPath is deliberately outside the repo so a token is never
// committed by accident.
func defaultTokenPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".celest", "token")
}

func defaultStatePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".celest", defaultState)
}

// loadOrCreateToken reads the token file, generating one on first use.
func loadOrCreateToken(path string) (string, error) {
	if b, err := os.ReadFile(path); err == nil {
		if t := strings.TrimSpace(string(b)); t != "" {
			return t, nil
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	tok := newToken()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(tok+"\n"), 0o600); err != nil {
		return "", err
	}
	return tok, nil
}

func die(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "celest: "+format+"\n", a...)
	os.Exit(1)
}

/* ------------------------------------------------------------------- main */

const usage = `celest %s - outbound-only remote shell relay

USAGE
  celest serve   [--addr 0.0.0.0:8080] [--token-file PATH] [--state PATH]
  celest agent   --relay URL [--token T | --token-file PATH] [--name LABEL]
  celest status  [--relay URL] [--token T]
  celest run     [--cwd DIR] [--timeout SECS] [--wait SECS] -- CMD...
  celest read    PATH [--out LOCALFILE]
  celest write   LOCALFILE REMOTEPATH
  celest history [--limit N]
  celest show    JOBID

The relay listens for HTTPS callbacks; the agent dials out and executes.
Neither side ever needs an inbound port on the target machine.

Run 'celest <cmd> --help' for per-command flags.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Printf(usage, Version)
		os.Exit(2)
	}
	cmd := os.Args[1]
	args := os.Args[2:]

	switch cmd {
	case "serve":
		cmdServe(args)
	case "agent":
		cmdAgent(args)
	case "status":
		cmdStatus(args)
	case "run":
		cmdRun(args)
	case "read":
		cmdRead(args)
	case "write":
		cmdWrite(args)
	case "history":
		cmdHistory(args)
	case "show":
		cmdShow(args)
	case "version", "-v", "--version":
		fmt.Println(Version)
	case "help", "-h", "--help":
		fmt.Printf(usage, Version)
	default:
		fmt.Fprintf(os.Stderr, "celest: unknown command %q\n\n", cmd)
		fmt.Printf(usage, Version)
		os.Exit(2)
	}
}
