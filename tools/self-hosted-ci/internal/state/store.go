package state

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const StateVersion = 1
const MaxHistory = 500

type Run struct {
	ID        string    `json:"id"`
	RepoID    string    `json:"repoId"`
	Ref       string    `json:"ref"`
	SHA       string    `json:"sha"`
	Event     string    `json:"event"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	StartedAt time.Time `json:"startedAt,omitempty"`
	EndedAt   time.Time `json:"endedAt,omitempty"`
	LogFile   string    `json:"logFile"`
	Workflow  string    `json:"workflow,omitempty"`
	Artifacts []string  `json:"artifacts,omitempty"`
	Error     string    `json:"error,omitempty"`
}

type Snapshot struct {
	Version  int               `json:"version"`
	Instance string            `json:"instanceId"`
	Refs     map[string]string `json:"refs"`
	Runs     []Run             `json:"runs"`
}

type Store struct {
	mu   sync.Mutex
	path string
	data Snapshot
}

func Open(directory string) (*Store, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create state directory: %w", err)
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return nil, fmt.Errorf("inspect state directory: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("state directory must be a real directory")
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return nil, fmt.Errorf("secure state directory: %w", err)
	}
	store := &Store{
		path: filepath.Join(directory, "state.json"),
		data: Snapshot{Version: StateVersion, Refs: map[string]string{}, Runs: []Run{}},
	}
	bytes, err := os.ReadFile(store.path)
	if err == nil {
		if err := json.Unmarshal(bytes, &store.data); err != nil {
			return nil, fmt.Errorf("state file is invalid JSON: %w", err)
		}
		if store.data.Version != StateVersion {
			return nil, fmt.Errorf("unsupported state version %d", store.data.Version)
		}
		if store.data.Refs == nil {
			store.data.Refs = map[string]string{}
		}
		if store.data.Runs == nil {
			store.data.Runs = []Run{}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read state: %w", err)
	}
	if store.data.Instance == "" {
		id, err := randomID()
		if err != nil {
			return nil, err
		}
		store.data.Instance = id
	}
	return store, nil
}

// Initialize must be called by the single daemon/manual-run owner after acquiring the runner lock.
// Read-only commands use ReadSnapshot instead so they never mutate live state.
func (s *Store) Initialize() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Instance == "" {
		id, err := randomID()
		if err != nil {
			return err
		}
		s.data.Instance = id
	}
	for index := range s.data.Runs {
		run := &s.data.Runs[index]
		if run.Status == "running" {
			run.Status = "failure"
			run.Error = "runner restarted while this run was active"
			run.EndedAt = time.Now().UTC()
		}
	}
	return s.saveLocked()
}

func ReadSnapshot(directory string) (Snapshot, error) {
	directoryInfo, err := os.Lstat(directory)
	if errors.Is(err, os.ErrNotExist) {
		return Snapshot{Version: StateVersion, Refs: map[string]string{}, Runs: []Run{}}, nil
	}
	if err != nil {
		return Snapshot{}, fmt.Errorf("inspect state directory: %w", err)
	}
	if !directoryInfo.IsDir() || directoryInfo.Mode()&os.ModeSymlink != 0 {
		return Snapshot{}, fmt.Errorf("state directory must be a real directory")
	}
	path := filepath.Join(directory, "state.json")
	fileInfo, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return Snapshot{Version: StateVersion, Refs: map[string]string{}, Runs: []Run{}}, nil
	}
	if err != nil {
		return Snapshot{}, fmt.Errorf("inspect state file: %w", err)
	}
	if !fileInfo.Mode().IsRegular() || fileInfo.Mode()&os.ModeSymlink != 0 {
		return Snapshot{}, fmt.Errorf("state file must be a regular file")
	}
	bytes, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Snapshot{Version: StateVersion, Refs: map[string]string{}, Runs: []Run{}}, nil
	}
	if err != nil {
		return Snapshot{}, fmt.Errorf("read state snapshot: %w", err)
	}
	var snapshot Snapshot
	if err := json.Unmarshal(bytes, &snapshot); err != nil {
		return Snapshot{}, fmt.Errorf("state file is invalid JSON: %w", err)
	}
	if snapshot.Version != StateVersion {
		return Snapshot{}, fmt.Errorf("unsupported state version %d", snapshot.Version)
	}
	if snapshot.Refs == nil {
		snapshot.Refs = map[string]string{}
	}
	if snapshot.Runs == nil {
		snapshot.Runs = []Run{}
	}
	return snapshot, nil
}

func randomID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate id: %w", err)
	}
	return hex.EncodeToString(bytes), nil
}

func (s *Store) InstanceID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.data.Instance
}

func (s *Store) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	copy := s.data
	copy.Refs = make(map[string]string, len(s.data.Refs))
	for key, value := range s.data.Refs {
		copy.Refs[key] = value
	}
	copy.Runs = make([]Run, len(s.data.Runs))
	for index, run := range s.data.Runs {
		copy.Runs[index] = cloneRun(run)
	}
	return copy
}

func cloneRun(run Run) Run {
	run.Artifacts = append([]string(nil), run.Artifacts...)
	return run
}

// Observe records a ref update and creates a durable queued run when required.
// First observation is baseline-only unless runOnStart is enabled.
func (s *Store) Observe(repoID, ref, sha, event string, runOnStart bool) (*Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := repoID + "\x00" + ref
	previous, seen := s.data.Refs[key]
	if seen && previous == sha {
		return nil, nil
	}
	s.data.Refs[key] = sha
	shouldRun := (seen && previous != sha) || (!seen && runOnStart)
	var created *Run
	if shouldRun {
		id, err := randomID()
		if err != nil {
			return nil, err
		}
		run := Run{
			ID:        id,
			RepoID:    repoID,
			Ref:       ref,
			SHA:       sha,
			Event:     event,
			Status:    "queued",
			CreatedAt: time.Now().UTC(),
			LogFile:   filepath.Join("runs", id, "run.log"),
		}
		s.data.Runs = append(s.data.Runs, run)
		created = &run
	}
	s.trimLocked()
	if err := s.saveLocked(); err != nil {
		return nil, err
	}
	return created, nil
}

func (s *Store) CreateRun(repoID, ref, sha, event string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, err := randomID()
	if err != nil {
		return Run{}, err
	}
	run := Run{
		ID:        id,
		RepoID:    repoID,
		Ref:       ref,
		SHA:       sha,
		Event:     event,
		Status:    "queued",
		CreatedAt: time.Now().UTC(),
		LogFile:   filepath.Join("runs", id, "run.log"),
	}
	s.data.Runs = append(s.data.Runs, run)
	s.trimLocked()
	if err := s.saveLocked(); err != nil {
		return Run{}, err
	}
	return run, nil
}

func (s *Store) QueuedRuns() []Run {
	s.mu.Lock()
	defer s.mu.Unlock()
	var queued []Run
	for _, run := range s.data.Runs {
		if run.Status == "queued" {
			queued = append(queued, cloneRun(run))
		}
	}
	return queued
}

func (s *Store) UpdateRun(id string, update func(*Run)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.data.Runs {
		if s.data.Runs[index].ID == id {
			update(&s.data.Runs[index])
			s.trimLocked()
			return s.saveLocked()
		}
	}
	return fmt.Errorf("run %q not found", id)
}

func (s *Store) FindRun(id string) (Run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, run := range s.data.Runs {
		if run.ID == id {
			return cloneRun(run), true
		}
	}
	return Run{}, false
}

func (s *Store) trimLocked() {
	if len(s.data.Runs) <= MaxHistory {
		return
	}
	active := make([]Run, 0)
	completed := make([]Run, 0)
	for _, run := range s.data.Runs {
		if run.Status == "queued" || run.Status == "running" {
			active = append(active, run)
		} else {
			completed = append(completed, run)
		}
	}
	keepCompleted := MaxHistory - len(active)
	if keepCompleted < 0 {
		keepCompleted = 0
	}
	if len(completed) > keepCompleted {
		completed = completed[len(completed)-keepCompleted:]
	}
	kept := append(active, completed...)
	sort.SliceStable(kept, func(i, j int) bool { return kept[i].CreatedAt.Before(kept[j].CreatedAt) })
	s.data.Runs = kept
}

func (s *Store) saveLocked() error {
	data, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return fmt.Errorf("encode state: %w", err)
	}
	temporary := s.path + ".tmp"
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create temporary state: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		os.Remove(temporary)
		return fmt.Errorf("secure temporary state: %w", err)
	}
	if _, err := file.Write(append(data, '\n')); err != nil {
		file.Close()
		os.Remove(temporary)
		return fmt.Errorf("write state: %w", err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		os.Remove(temporary)
		return fmt.Errorf("sync state: %w", err)
	}
	if err := file.Close(); err != nil {
		os.Remove(temporary)
		return fmt.Errorf("close state: %w", err)
	}
	if err := os.Rename(temporary, s.path); err != nil {
		os.Remove(temporary)
		return fmt.Errorf("replace state: %w", err)
	}
	return nil
}
