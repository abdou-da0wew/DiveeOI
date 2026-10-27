package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

/* -------------------------------------------------------------- the store */

// store is the relay's in-memory state, persisted to disk so results survive a
// restart of the relay process.
type store struct {
	mu      sync.Mutex
	path    string
	queue   []Job
	results map[string]Result
	order   []string // job ids in creation order
	total   int
	lastPol time.Time
	agentH  string
	agentV  string
}

type persisted struct {
	Queue   []Job             `json:"queue"`
	Results map[string]Result `json:"results"`
	Order   []string          `json:"order"`
	Total   int               `json:"total"`
}

func newStore(path string) *store {
	s := &store{path: path, results: map[string]Result{}}
	if path == "" {
		return s
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return s
	}
	var p persisted
	if err := json.Unmarshal(b, &p); err != nil {
		log.Printf("celest: ignoring unreadable state %s: %v", path, err)
		return s
	}
	s.queue = p.Queue
	s.order = p.Order
	s.total = p.Total
	if p.Results != nil {
		s.results = p.Results
	}
	return s
}

// save persists state. Caller must hold the lock.
func (s *store) saveLocked() {
	if s.path == "" {
		return
	}
	// Keep only the newest 200 results on disk to bound growth.
	if len(s.order) > 200 {
		drop := s.order[:len(s.order)-200]
		for _, id := range drop {
			delete(s.results, id)
		}
		s.order = s.order[len(s.order)-200:]
	}
	p := persisted{Queue: s.queue, Results: s.results, Order: s.order, Total: s.total}
	b, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, s.path)
}

func (s *store) enqueue(j Job) Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	if j.ID == "" {
		j.ID = newID()
	}
	if j.Created.IsZero() {
		j.Created = time.Now()
	}
	s.queue = append(s.queue, j)
	s.total++
	s.saveLocked()
	return j
}

func (s *store) take() (Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.queue) == 0 {
		return Job{}, false
	}
	j := s.queue[0]
	s.queue = s.queue[1:]
	s.saveLocked()
	return j, true
}

func (s *store) putResult(r Result) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.results[r.ID] = r
	s.order = append(s.order, r.ID)
	s.agentH = r.Host
	s.agentV = r.AgentVer
	s.saveLocked()
}

func (s *store) result(id string) (Result, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.results[id]
	return r, ok
}

func (s *store) notePoll(host, ver string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastPol = time.Now()
	if host != "" {
		s.agentH = host
	}
	if ver != "" {
		s.agentV = ver
	}
}

func (s *store) status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Status{
		Version:     Version,
		AgentOnline: time.Since(s.lastPol) < 60*time.Second,
		AgentHost:   s.agentH,
		LastPoll:    s.lastPol,
		QueueDepth:  len(s.queue),
		JobsTotal:   s.total,
		JobsDone:    len(s.order),
	}
}

func (s *store) recent(n int) []Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	if n <= 0 || n > len(s.order) {
		n = len(s.order)
	}
	out := make([]Result, 0, n)
	for _, id := range s.order[len(s.order)-n:] {
		if r, ok := s.results[id]; ok {
			out = append(out, r)
		}
	}
	return out
}

/* ------------------------------------------------------------ the server */

type relay struct {
	st     *store
	token  string
	binDir string
}

func (rv *relay) authed(r *http.Request) bool {
	got := r.Header.Get("X-Celest-Token")
	if got == "" {
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			got = strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		}
	}
	if got == "" {
		got = r.URL.Query().Get("token")
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(rv.token)) == 1
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// requireAuth wraps a handler with token enforcement.
func (rv *relay) requireAuth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !rv.authed(r) {
			writeErr(w, http.StatusUnauthorized, "bad or missing token")
			return
		}
		h(w, r)
	}
}

func (rv *relay) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "true", "version": Version})
	})

	// Agent long-polls here. Deliberately cheap: it returns 204 as soon as the
	// wait expires so the proxy in front of us never sees an idle connection.
	mux.HandleFunc("/v1/job", rv.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		wait := defaultPollSec
		if q := r.URL.Query().Get("wait"); q != "" {
			fmt.Sscanf(q, "%d", &wait)
		}
		if wait > 55 {
			wait = 55
		}
		host := r.URL.Query().Get("host")
		ver := r.URL.Query().Get("ver")
		rv.st.notePoll(host, ver)

		deadline := time.Now().Add(time.Duration(wait) * time.Second)
		for {
			if j, ok := rv.st.take(); ok {
				writeJSON(w, http.StatusOK, j)
				return
			}
			if time.Now().After(deadline) {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			select {
			case <-r.Context().Done():
				return
			case <-time.After(400 * time.Millisecond):
			}
		}
	}))

	// Agent posts finished work here.
	mux.HandleFunc("/v1/result", rv.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, "POST only")
			return
		}
		var res Result
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&res); err != nil {
			writeErr(w, http.StatusBadRequest, "bad json: "+err.Error())
			return
		}
		if res.ID == "" {
			writeErr(w, http.StatusBadRequest, "missing id")
			return
		}
		rv.st.putResult(res)
		writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
	}))

	// Control-plane: enqueue work.
	mux.HandleFunc("/v1/enqueue", rv.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, "POST only")
			return
		}
		var j Job
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&j); err != nil {
			writeErr(w, http.StatusBadRequest, "bad json: "+err.Error())
			return
		}
		if j.Kind == "" {
			j.Kind = KindExec
		}
		switch j.Kind {
		case KindExec, KindRead, KindWrite, KindInfo:
		default:
			writeErr(w, http.StatusBadRequest, "unknown kind "+j.Kind)
			return
		}
		j = rv.st.enqueue(j)
		writeJSON(w, http.StatusOK, j)
	}))

	mux.HandleFunc("/v1/status", rv.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, rv.st.status())
	}))

	mux.HandleFunc("/v1/result/get", rv.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		res, ok := rv.st.result(id)
		if !ok {
			writeErr(w, http.StatusNotFound, "no result for "+id)
			return
		}
		writeJSON(w, http.StatusOK, res)
	}))

	// Binary distribution: lets the target machine bootstrap itself with a
	// single curl, since it cannot receive files any other way. Token-gated.
	mux.HandleFunc("/dl/", rv.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		if rv.binDir == "" {
			writeErr(w, http.StatusNotFound, "binary distribution disabled (start serve with --bin-dir)")
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/dl/")
		if name == "" || strings.Contains(name, "..") || strings.ContainsAny(name, `/\`) {
			writeErr(w, http.StatusBadRequest, "bad name")
			return
		}
		path := filepath.Join(rv.binDir, name)
		if _, err := os.Stat(path); err != nil {
			writeErr(w, http.StatusNotFound, "no such binary")
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		http.ServeFile(w, r, path)
	}))

	mux.HandleFunc("/v1/history", rv.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		n := 20
		if q := r.URL.Query().Get("limit"); q != "" {
			fmt.Sscanf(q, "%d", &n)
		}
		writeJSON(w, http.StatusOK, rv.st.recent(n))
	}))

	return mux
}

/* -------------------------------------------------------------- serve cmd */

func cmdServe(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", defaultAddr, "listen address (must be 0.0.0.0 behind the preview proxy)")
	tokenFile := fs.String("token-file", defaultTokenPath(), "path to shared token file")
	statePath := fs.String("state", defaultStatePath(), "path to persisted state")
	token := fs.String("token", "", "shared token (overrides --token-file)")
	quiet := fs.Bool("quiet", false, "suppress per-request logging")
	binDir := fs.String("bin-dir", "", "directory served at /dl/<name> for agent bootstrap")
	_ = fs.Parse(args)

	tok := *token
	if tok == "" {
		var err error
		tok, err = loadOrCreateToken(*tokenFile)
		if err != nil {
			die("token: %v", err)
		}
	}

	rv := &relay{st: newStore(*statePath), token: tok, binDir: *binDir}

	if !*quiet {
		log.Printf("celest relay %s on %s (token from %s)", Version, *addr, *tokenFile)
	}
	srv := &http.Server{
		Addr:              *addr,
		Handler:           logRequests(rv.routes(), *quiet),
		ReadHeaderTimeout: 10 * time.Second,
		// Long-poll needs a generous write deadline; nothing here streams for
		// longer than ~60s.
		WriteTimeout: 70 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		die("listen: %v", err)
	}
}

// logRequests logs method, path, status and duration. Bodies are never logged
// so command output and file contents stay out of the relay's log.
func logRequests(h http.Handler, quiet bool) http.Handler {
	if quiet {
		return h
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: 200}
		h.ServeHTTP(sw, r)
		log.Printf("%s %s -> %d (%s)", r.Method, r.URL.Path, sw.code, time.Since(start).Round(time.Millisecond))
	})
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (s *statusWriter) WriteHeader(c int) {
	s.code = c
	s.ResponseWriter.WriteHeader(c)
}
