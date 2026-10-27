package main

import (
	"context"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"
)

//go:embed survey.sh
var surveyScript []byte

// cmdWeb runs a synchronous GET-only endpoint. It exists for the case where the
// operator can only issue plain HTTP GETs at the target (no websockets, no
// long-poll, no ability to receive callbacks) — every call is one round trip:
//
//	/survey          full read-only system report
//	/sh?cmd=...      run a shell command, return its output
//	/get?path=...    read a file
//	/put?path=&data= write a file (only with --write)
type webServer struct {
	token    string
	allowWr  bool
	maxOut   int
	defSecs  int
	readOnly bool
}

func (ws *webServer) authed(r *http.Request) bool {
	got := r.Header.Get("X-Celest-Token")
	if got == "" {
		got = r.URL.Query().Get("token")
	}
	if got == "" {
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			got = strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		}
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(ws.token)) == 1
}

func textOut(w http.ResponseWriter, code int, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(code)
	_, _ = w.Write([]byte(body))
}

// clip keeps a response small enough to survive a text-only fetch pipeline.
func clip(s string, max int) (string, bool) {
	if len(s) <= max {
		return s, false
	}
	return s[:max], true
}

func (ws *webServer) runShell(cmd, cwd string, secs int) (string, int) {
	if secs <= 0 {
		secs = ws.defSecs
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(secs)*time.Second)
	defer cancel()

	var c *exec.Cmd
	if runtime.GOOS == "windows" {
		c = exec.CommandContext(ctx, "cmd", "/C", cmd)
	} else {
		c = exec.CommandContext(ctx, "/bin/sh", "-c", cmd)
	}
	if cwd != "" {
		c.Dir = cwd
	}
	var sb limitedBuffer
	sb.limit = ws.maxOut
	c.Stdout = &sb
	c.Stderr = &sb

	start := time.Now()
	err := c.Run()
	code := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else if ctx.Err() == context.DeadlineExceeded {
			code = 124
			fmt.Fprintf(&sb, "\n[timed out after %ds]", secs)
		} else {
			code = 1
			fmt.Fprintf(&sb, "\n[error: %v]", err)
		}
	}
	hdr := fmt.Sprintf("exit=%d ms=%d", code, time.Since(start).Milliseconds())
	if sb.truncated {
		hdr += " TRUNCATED"
	}
	return hdr + "\n" + sb.buf.String(), code
}

// runSurvey writes the embedded survey script to a private temp file and runs
// it, so it does not depend on stdin plumbing.
func (ws *webServer) runSurvey() (string, int) {
	f, err := os.CreateTemp("", "celest-survey-*.sh")
	if err != nil {
		return "error: " + err.Error() + "\n", 1
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err := f.Write(surveyScript); err != nil {
		f.Close()
		return "error: " + err.Error() + "\n", 1
	}
	if err := f.Close(); err != nil {
		return "error: " + err.Error() + "\n", 1
	}
	out, code := ws.runShell("bash "+name, "", 120)
	if ws.maxOut > 0 && len(out) > ws.maxOut {
		out = out[:ws.maxOut] + "\n[truncated]"
	}
	return out, code
}

func (ws *webServer) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		textOut(w, http.StatusOK, "ok celest "+Version+" "+runtime.GOOS+"/"+runtime.GOARCH+"\n")
	})

	mux.HandleFunc("/survey", func(w http.ResponseWriter, r *http.Request) {
		if !ws.authed(r) {
			textOut(w, http.StatusUnauthorized, "bad or missing token\n")
			return
		}
		out, _ := ws.runSurvey()
		textOut(w, http.StatusOK, out)
	})

	mux.HandleFunc("/sh", func(w http.ResponseWriter, r *http.Request) {
		if !ws.authed(r) {
			textOut(w, http.StatusUnauthorized, "bad or missing token\n")
			return
		}
		cmd := r.URL.Query().Get("cmd")
		if cmd == "" {
			textOut(w, http.StatusBadRequest, "usage: /sh?cmd=<shell command>&cwd=&timeout=\n")
			return
		}
		secs := 0
		if t := r.URL.Query().Get("timeout"); t != "" {
			fmt.Sscanf(t, "%d", &secs)
		}
		out, _ := ws.runShell(cmd, r.URL.Query().Get("cwd"), secs)
		textOut(w, http.StatusOK, out)
	})

	mux.HandleFunc("/get", func(w http.ResponseWriter, r *http.Request) {
		if !ws.authed(r) {
			textOut(w, http.StatusUnauthorized, "bad or missing token\n")
			return
		}
		path := r.URL.Query().Get("path")
		if path == "" {
			textOut(w, http.StatusBadRequest, "usage: /get?path=<file>\n")
			return
		}
		b, err := os.ReadFile(path)
		if err != nil {
			textOut(w, http.StatusNotFound, "error: "+err.Error()+"\n")
			return
		}
		if len(b) > ws.maxOut {
			b = b[:ws.maxOut]
		}
		if utf8.Valid(b) && !strings.ContainsRune(string(b), 0) {
			textOut(w, http.StatusOK, fmt.Sprintf("file=%s bytes=%d encoding=text\n%s", path, len(b), string(b)))
			return
		}
		textOut(w, http.StatusOK, fmt.Sprintf("file=%s bytes=%d encoding=base64\n%s", path, len(b), base64.StdEncoding.EncodeToString(b)))
	})

	mux.HandleFunc("/put", func(w http.ResponseWriter, r *http.Request) {
		if !ws.authed(r) {
			textOut(w, http.StatusUnauthorized, "bad or missing token\n")
			return
		}
		if !ws.allowWr {
			textOut(w, http.StatusForbidden, "write disabled (restart with --write to enable)\n")
			return
		}
		path := r.URL.Query().Get("path")
		data := r.URL.Query().Get("data")
		if path == "" || data == "" {
			textOut(w, http.StatusBadRequest, "usage: /put?path=<file>&data=<base64>\n")
			return
		}
		raw, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			textOut(w, http.StatusBadRequest, "bad base64: "+err.Error()+"\n")
			return
		}
		if dir := dirOf(path); dir != "" {
			_ = os.MkdirAll(dir, 0o755)
		}
		if err := os.WriteFile(path, raw, 0o644); err != nil {
			textOut(w, http.StatusInternalServerError, "error: "+err.Error()+"\n")
			return
		}
		textOut(w, http.StatusOK, fmt.Sprintf("wrote %d bytes to %s\n", len(raw), path))
	})

	return mux
}

/* ---------------------------------------------------------------- command */

func cmdWeb(args []string) {
	fs := flag.NewFlagSet("web", flag.ExitOnError)
	addr := fs.String("addr", "0.0.0.0:80", "listen address")
	token := fs.String("token", "", "shared token (else --token-file)")
	tokenFile := fs.String("token-file", defaultTokenPath(), "path to token file")
	allowWrite := fs.Bool("write", false, "enable the /put endpoint")
	maxOut := fs.Int("max-output", 120<<10, "cap response body in bytes")
	secs := fs.Int("timeout", 60, "default command timeout in seconds")
	_ = fs.Parse(args)

	tok := *token
	if tok == "" {
		var err error
		tok, err = loadOrCreateToken(*tokenFile)
		if err != nil {
			die("token: %v", err)
		}
	}
	ws := &webServer{token: tok, allowWr: *allowWrite, maxOut: *maxOut, defSecs: *secs}

	mux := http.NewServeMux()
	mux.Handle("/", ws.routes())
	log.Printf("celest web %s on %s (write=%v, max-output=%d)", Version, *addr, *allowWrite, *maxOut)
	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      120 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		die("listen: %v", err)
	}
}
