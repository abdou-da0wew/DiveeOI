package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

/* -------------------------------------------------------- control client */

type ctlClient struct {
	base  string
	token string
	http  *http.Client
}

func newCtl(relayURL, token string) *ctlClient {
	return &ctlClient{
		base:  strings.TrimRight(relayURL, "/"),
		token: token,
		http:  &http.Client{Timeout: 75 * time.Second},
	}
}

func (c *ctlClient) call(method, path string, body any) ([]byte, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Celest-Token", c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	return b, nil
}

func (c *ctlClient) enqueue(j Job) (Job, error) {
	var out Job
	b, err := c.call(http.MethodPost, "/v1/enqueue", j)
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(b, &out)
	return out, err
}

func (c *ctlClient) status() (Status, error) {
	var s Status
	b, err := c.call(http.MethodGet, "/v1/status", nil)
	if err != nil {
		return s, err
	}
	err = json.Unmarshal(b, &s)
	return s, err
}

func (c *ctlClient) wait(id string, secs int) (Result, error) {
	deadline := time.Now().Add(time.Duration(secs) * time.Second)
	for {
		b, err := c.call(http.MethodGet, "/v1/result/get?id="+id, nil)
		if err == nil {
			var r Result
			if err := json.Unmarshal(b, &r); err == nil {
				return r, nil
			}
		}
		if time.Now().After(deadline) {
			return Result{}, fmt.Errorf("timed out after %ds waiting for job %s", secs, id)
		}
		time.Sleep(300 * time.Millisecond)
	}
}

// flags shared by the client commands.
type clientFlags struct {
	relay     string
	token     string
	tokenFile string
}

func (cf *clientFlags) bind(fs *flag.FlagSet) {
	fs.StringVar(&cf.relay, "relay", "http://127.0.0.1:8080", "relay base URL")
	fs.StringVar(&cf.token, "token", "", "shared token (else --token-file)")
	fs.StringVar(&cf.tokenFile, "token-file", defaultTokenPath(), "path to token file")
}

func (cf *clientFlags) client() *ctlClient {
	tok := cf.token
	if tok == "" {
		b, err := os.ReadFile(cf.tokenFile)
		if err != nil {
			die("cannot read token %s: %v (pass --token)", cf.tokenFile, err)
		}
		tok = strings.TrimSpace(string(b))
	}
	return newCtl(cf.relay, tok)
}

/* ------------------------------------------------------------- commands */

func cmdStatus(args []string) {
	fs := flag.NewFlagSet("status", flag.ExitOnError)
	var cf clientFlags
	cf.bind(fs)
	asJSON := fs.Bool("json", false, "raw JSON")
	_ = fs.Parse(args)

	s, err := cf.client().status()
	if err != nil {
		die("status: %v", err)
	}
	if *asJSON {
		b, _ := json.MarshalIndent(s, "", "  ")
		fmt.Println(string(b))
		return
	}
	state := "OFFLINE"
	if s.AgentOnline {
		state = "online"
	}
	fmt.Printf("relay   %s (celest %s)\n", cf.relay, s.Version)
	fmt.Printf("agent   %s  host=%s  last_poll=%s\n", state, s.AgentHost, ago(s.LastPoll))
	fmt.Printf("queue   %d pending, %d total, %d done\n", s.QueueDepth, s.JobsTotal, s.JobsDone)
}

func ago(t time.Time) string {
	if t.IsZero() {
		return "never"
	}
	return time.Since(t).Round(time.Second).String() + " ago"
}

func cmdRun(args []string) {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	var cf clientFlags
	cf.bind(fs)
	cwd := fs.String("cwd", "", "working directory on the target")
	timeout := fs.Int("timeout", 120, "job timeout in seconds")
	wait := fs.Int("wait", 90, "how long to wait for the result")
	_ = fs.Parse(args)

	cmd := strings.Join(fs.Args(), " ")
	if cmd == "" {
		die("run: no command given (use: celest run -- 'ls -la')")
	}
	c := cf.client()
	j, err := c.enqueue(Job{Kind: KindExec, Cmd: cmd, Cwd: *cwd, Timeout: *timeout})
	if err != nil {
		die("enqueue: %v", err)
	}
	r, err := c.wait(j.ID, *wait)
	if err != nil {
		die("%v", err)
	}
	if r.Stdout != "" {
		fmt.Print(r.Stdout)
	}
	if r.Stderr != "" {
		fmt.Fprint(os.Stderr, r.Stderr)
	}
	if r.Err != "" {
		fmt.Fprintf(os.Stderr, "celest: %s\n", r.Err)
	}
	if r.Truncated {
		fmt.Fprintln(os.Stderr, "celest: output truncated at 256 KiB")
	}
	if r.Exit != 0 {
		os.Exit(r.Exit)
	}
}

func cmdRead(args []string) {
	fs := flag.NewFlagSet("read", flag.ExitOnError)
	var cf clientFlags
	cf.bind(fs)
	out := fs.String("out", "", "write to this local file instead of stdout")
	wait := fs.Int("wait", 60, "how long to wait for the result")
	_ = fs.Parse(args)
	if fs.NArg() < 1 {
		die("read: need a remote path")
	}
	remote := fs.Arg(0)

	c := cf.client()
	j, err := c.enqueue(Job{Kind: KindRead, Path: remote})
	if err != nil {
		die("enqueue: %v", err)
	}
	r, err := c.wait(j.ID, *wait)
	if err != nil {
		die("%v", err)
	}
	if r.Err != "" {
		die("%s", r.Err)
	}
	data, err := base64.StdEncoding.DecodeString(r.Data)
	if err != nil {
		die("decode: %v", err)
	}
	if *out != "" {
		if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
			die("mkdir: %v", err)
		}
		if err := os.WriteFile(*out, data, 0o644); err != nil {
			die("write: %v", err)
		}
		fmt.Fprintf(os.Stderr, "wrote %d bytes to %s\n", len(data), *out)
		return
	}
	os.Stdout.Write(data)
}

func cmdWrite(args []string) {
	fs := flag.NewFlagSet("write", flag.ExitOnError)
	var cf clientFlags
	cf.bind(fs)
	wait := fs.Int("wait", 60, "how long to wait for the result")
	_ = fs.Parse(args)
	if fs.NArg() < 2 {
		die("write: need LOCALFILE REMOTEPATH")
	}
	local, remote := fs.Arg(0), fs.Arg(1)

	data, err := os.ReadFile(local)
	if err != nil {
		die("read %s: %v", local, err)
	}
	c := cf.client()
	j, err := c.enqueue(Job{
		Kind: KindWrite,
		Path: remote,
		Data: base64.StdEncoding.EncodeToString(data),
	})
	if err != nil {
		die("enqueue: %v", err)
	}
	r, err := c.wait(j.ID, *wait)
	if err != nil {
		die("%v", err)
	}
	if r.Err != "" {
		die("%s", r.Err)
	}
	fmt.Print(r.Stdout)
}

func cmdHistory(args []string) {
	fs := flag.NewFlagSet("history", flag.ExitOnError)
	var cf clientFlags
	cf.bind(fs)
	limit := fs.Int("limit", 20, "how many results to list")
	_ = fs.Parse(args)

	b, err := cf.client().call(http.MethodGet, fmt.Sprintf("/v1/history?limit=%d", *limit), nil)
	if err != nil {
		die("history: %v", err)
	}
	var rs []Result
	if err := json.Unmarshal(b, &rs); err != nil {
		die("history: %v", err)
	}
	for _, r := range rs {
		summary := strings.TrimSpace(r.Stdout)
		if i := strings.IndexByte(summary, '\n'); i >= 0 {
			summary = summary[:i]
		}
		if len(summary) > 68 {
			summary = summary[:68] + "..."
		}
		fmt.Printf("%s  %-6s exit=%-3d %-19s  %s\n", r.ID, r.Kind, r.Exit, r.Host, summary)
	}
}

func cmdShow(args []string) {
	fs := flag.NewFlagSet("show", flag.ExitOnError)
	var cf clientFlags
	cf.bind(fs)
	_ = fs.Parse(args)
	if fs.NArg() < 1 {
		die("show: need a job id")
	}
	b, err := cf.client().call(http.MethodGet, "/v1/result/get?id="+fs.Arg(0), nil)
	if err != nil {
		die("show: %v", err)
	}
	var r Result
	if err := json.Unmarshal(b, &r); err != nil {
		die("show: %v", err)
	}
	fmt.Printf("id      %s\nkind    %s\nhost    %s\nexit    %d\nstarted %s\nended   %s\n",
		r.ID, r.Kind, r.Host, r.Exit, r.Started.Format(time.RFC3339), r.Ended.Format(time.RFC3339))
	if r.Err != "" {
		fmt.Printf("error   %s\n", r.Err)
	}
	fmt.Printf("--- stdout ---\n%s", r.Stdout)
	if r.Stderr != "" {
		fmt.Printf("--- stderr ---\n%s", r.Stderr)
	}
}
