package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"strings"
	"time"
)

/* -------------------------------------------------------------- the agent */

type agent struct {
	relay  string
	token  string
	name   string
	client *http.Client
}

func (a *agent) hostLabel() string {
	if a.name != "" {
		return a.name
	}
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}

// do performs an authenticated request with a body, retrying nothing.
func (a *agent) do(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, a.relay+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Celest-Token", a.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("User-Agent", "celest-agent/"+Version)
	return a.client.Do(req)
}

// poll asks for one job, blocking up to wait seconds.
func (a *agent) poll(ctx context.Context, wait int) (*Job, error) {
	q := url.Values{}
	q.Set("wait", fmt.Sprint(wait))
	q.Set("host", a.hostLabel())
	q.Set("ver", Version)

	resp, err := a.do(ctx, http.MethodGet, "/v1/job?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusNoContent:
		return nil, nil
	case http.StatusOK:
		var j Job
		if err := json.NewDecoder(resp.Body).Decode(&j); err != nil {
			return nil, fmt.Errorf("decode job: %w", err)
		}
		return &j, nil
	case http.StatusUnauthorized:
		return nil, errors.New("relay rejected the token (401)")
	default:
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("relay returned %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
}

// postResult reports a finished job.
func (a *agent) postResult(ctx context.Context, r Result) error {
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	resp, err := a.do(ctx, http.MethodPost, "/v1/result", bytes.NewReader(b))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("post result: %d %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

/* ------------------------------------------------------------- execution */

// limitedBuffer keeps at most n bytes and records whether it clipped.
type limitedBuffer struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (l *limitedBuffer) Write(p []byte) (int, error) {
	if l.buf.Len() >= l.limit {
		l.truncated = true
		return len(p), nil
	}
	room := l.limit - l.buf.Len()
	if len(p) > room {
		l.buf.Write(p[:room])
		l.truncated = true
		return len(p), nil
	}
	return l.buf.Write(p)
}

func (a *agent) run(ctx context.Context, j Job) Result {
	res := Result{
		ID:       j.ID,
		Kind:     j.Kind,
		Started:  time.Now(),
		Host:     a.hostLabel(),
		AgentVer: Version,
	}
	defer func() { res.Ended = time.Now() }()

	switch j.Kind {
	case KindExec:
		a.runExec(ctx, j, &res)
	case KindRead:
		a.runRead(j, &res)
	case KindWrite:
		a.runWrite(j, &res)
	case KindInfo:
		a.runInfo(&res)
	default:
		res.Exit = 2
		res.Err = "unknown job kind " + j.Kind
	}
	return res
}

func (a *agent) runExec(ctx context.Context, j Job, res *Result) {
	secs := j.Timeout
	if secs <= 0 {
		secs = 120
	}
	cctx, cancel := context.WithTimeout(ctx, time.Duration(secs)*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(cctx, "cmd", "/C", j.Cmd)
	} else {
		cmd = exec.CommandContext(cctx, "/bin/sh", "-c", j.Cmd)
	}
	if j.Cwd != "" {
		cmd.Dir = j.Cwd
	}
	if len(j.Env) > 0 {
		cmd.Env = append(os.Environ(), j.Env...)
	}

	out := &limitedBuffer{limit: maxStreamBytes}
	errb := &limitedBuffer{limit: maxStreamBytes}
	cmd.Stdout = out
	cmd.Stderr = errb

	err := cmd.Run()
	res.Stdout = out.buf.String()
	res.Stderr = errb.buf.String()
	res.Truncated = out.truncated || errb.truncated

	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			res.Exit = ee.ExitCode()
		} else if errors.Is(cctx.Err(), context.DeadlineExceeded) {
			res.Exit = 124
			res.Err = fmt.Sprintf("timed out after %ds", secs)
		} else {
			res.Exit = 1
			res.Err = err.Error()
		}
	}
}

func (a *agent) runRead(j Job, res *Result) {
	b, err := os.ReadFile(j.Path)
	if err != nil {
		res.Exit = 1
		res.Err = err.Error()
		return
	}
	if len(b) > 4<<20 {
		b = b[:4<<20]
		res.Truncated = true
	}
	res.Data = base64.StdEncoding.EncodeToString(b)
}

func (a *agent) runWrite(j Job, res *Result) {
	raw, err := base64.StdEncoding.DecodeString(j.Data)
	if err != nil {
		res.Exit = 1
		res.Err = "bad base64: " + err.Error()
		return
	}
	if j.Path == "" {
		res.Exit = 1
		res.Err = "missing path"
		return
	}
	if dir := dirOf(j.Path); dir != "" {
		_ = os.MkdirAll(dir, 0o755)
	}
	if err := os.WriteFile(j.Path, raw, 0o644); err != nil {
		res.Exit = 1
		res.Err = err.Error()
		return
	}
	res.Stdout = fmt.Sprintf("wrote %d bytes to %s\n", len(raw), j.Path)
}

func dirOf(p string) string {
	i := strings.LastIndexAny(p, `/\`)
	if i <= 0 {
		return ""
	}
	return p[:i]
}

func (a *agent) runInfo(res *Result) {
	current, _ := user.Current()
	cwd, _ := os.Getwd()
	info := InfoPayload{
		Hostname: a.hostLabel(),
		GOOS:     runtime.GOOS,
		GOARCH:   runtime.GOARCH,
		Pid:      os.Getpid(),
		Cwd:      cwd,
		Version:  Version,
	}
	if current != nil {
		info.User = current.Username
	}
	b, _ := json.MarshalIndent(info, "", "  ")
	res.Data = base64.StdEncoding.EncodeToString(b)
	res.Stdout = string(b) + "\n"
}

/* --------------------------------------------------------------- agent cmd */

func cmdAgent(args []string) {
	fs := flag.NewFlagSet("agent", flag.ExitOnError)
	relayURL := fs.String("relay", "", "relay base URL, e.g. https://8080-abc.e2b.app")
	token := fs.String("token", "", "shared token")
	tokenFile := fs.String("token-file", defaultTokenPath(), "path to token file")
	name := fs.String("name", "", "label shown on the relay (default: hostname)")
	insecure := fs.Bool("insecure", false, "skip TLS verification (do not use on the public internet)")
	once := fs.Bool("once", false, "poll once, run at most one job, then exit")
	_ = fs.Parse(args)

	if *relayURL == "" {
		die("agent: --relay is required")
	}
	tok := *token
	if tok == "" {
		b, err := os.ReadFile(*tokenFile)
		if err != nil {
			die("agent: no --token given and cannot read %s: %v", *tokenFile, err)
		}
		tok = strings.TrimSpace(string(b))
	}
	if tok == "" {
		die("agent: empty token")
	}

	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = nil
	if *insecure {
		tr.TLSClientConfig = insecureTLS()
	}
	a := &agent{
		relay:  strings.TrimRight(*relayURL, "/"),
		token:  tok,
		name:   *name,
		client: &http.Client{Transport: tr},
	}

	log.Printf("celest agent %s -> %s as %q", Version, a.relay, a.hostLabel())

	ctx := context.Background()
	backoff := time.Second
	for {
		j, err := a.poll(ctx, defaultPollSec)
		if err != nil {
			log.Printf("poll: %v (retry in %s)", err, backoff)
			time.Sleep(backoff)
			if backoff < 30*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = time.Second
		if j == nil {
			if *once {
				return
			}
			continue
		}
		log.Printf("job %s %s", j.ID, j.Kind)
		res := a.run(ctx, *j)
		if err := a.postResult(ctx, res); err != nil {
			log.Printf("post result %s: %v", j.ID, err)
		}
		if *once {
			return
		}
	}
}
