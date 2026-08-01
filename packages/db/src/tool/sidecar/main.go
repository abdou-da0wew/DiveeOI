//go:build ignore
// +build ignore

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// Tool types
type ToolKind string

const (
	ToolGlob ToolKind = "glob"
	ToolList ToolKind = "list"
	ToolFind ToolKind = "find"
)

// Request structure
type Request struct {
	Kind        ToolKind `json:"type"`
	Root        string   `json:"root"`
	Pattern     string   `json:"pattern,omitempty"`
	Path        string   `json:"path,omitempty"`
	Limit       int      `json:"limit,omitempty"`
	MaxDepth    int      `json:"maxDepth,omitempty"`
	FileType    string   `json:"fileType,omitempty"` // "file" or "directory"
	NoGitIgnore bool     `json:"noGitIgnore,omitempty"`
	NoIgnore    bool     `json:"noIgnore,omitempty"`
	Include     []string `json:"include,omitempty"` // Fields to include: "size", "modified", "mode"
	Exclude     []string `json:"exclude,omitempty"` // Fields to exclude: "size", "modified", "mode"
}

// Response entry - all optional fields use omitempty
type Entry struct {
	Path     string `json:"path"`
	Type     string `json:"type"` // "file" or "directory"
	Size     int64  `json:"size,omitempty"`
	Modified int64  `json:"modified,omitempty"`
	Mode     string `json:"mode,omitempty"`
}

// Response structure
type Response struct {
	Entries []Entry `json:"entries"`
	Count   int     `json:"count"`
	Error   string  `json:"error,omitempty"`
}

func main() {
	var (
		toolKind    = flag.String("type", "", "Tool type: glob, list, find")
		root        = flag.String("root", ".", "Root directory")
		pattern     = flag.String("pattern", "", "Glob pattern (for glob/find tool)")
		path        = flag.String("path", "", "Subdirectory path (relative to root)")
		limit       = flag.Int("limit", 10000, "Maximum results")
		maxDepth    = flag.Int("maxDepth", -1, "Maximum depth (-1 for unlimited)")
		fileType    = flag.String("fileType", "", "File type filter: file or directory")
		noGitIgnore = flag.Bool("noGitIgnore", false, "Don't respect .gitignore")
		noIgnore    = flag.Bool("noIgnore", false, "Don't respect ignore files")
		include     = flag.String("include", "", "Comma-separated fields to include: size,modified,mode")
		exclude     = flag.String("exclude", "", "Comma-separated fields to exclude: size,modified,mode")
	)
	flag.Parse()

	request := Request{
		Kind:        ToolKind(*toolKind),
		Root:        *root,
		Pattern:     *pattern,
		Path:        *path,
		Limit:       *limit,
		MaxDepth:    *maxDepth,
		FileType:    *fileType,
		NoGitIgnore: *noGitIgnore,
		NoIgnore:    *noIgnore,
		Include:     parseCSV(*include),
		Exclude:     parseCSV(*exclude),
	}

	var resp Response
	var err error

	switch request.Kind {
	case ToolGlob:
		resp, err = runGlob(request)
	case ToolList:
		resp, err = runList(request)
	case ToolFind:
		resp, err = runFind(request)
	default:
		err = fmt.Errorf("unknown tool type: %s", toolKind)
	}

	if err != nil {
		resp = Response{Error: err.Error()}
	}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	encoder.Encode(resp)
}

func parseCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	var result []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

func shouldInclude(req Request, field string) bool {
	// If exclude list has it, don't include
	for _, f := range req.Exclude {
		if f == field {
			return false
		}
	}
	// If include list is specified, only include those
	if len(req.Include) > 0 {
		for _, f := range req.Include {
			if f == field {
				return true
			}
		}
		return false
	}
	// Default: include everything
	return true
}

func runGlob(req Request) (Response, error) {
	cwd := req.Root
	if req.Path != "" {
		cwd = filepath.Join(req.Root, req.Path)
	}

	pattern := req.Pattern
	if !filepath.IsAbs(pattern) {
		pattern = filepath.Join(cwd, pattern)
	}

	matches, err := filepath.Glob(pattern)
	if err != nil {
		return Response{}, err
	}

	var entries []Entry
	for _, match := range matches {
		if len(entries) >= req.Limit {
			break
		}
		info, err := os.Lstat(match)
		if err != nil {
			continue
		}
		rel, _ := filepath.Rel(req.Root, match)
		if req.FileType != "" && !matchesType(info, req.FileType) {
			continue
		}
		entries = append(entries, buildEntry(rel, info, req))
	}

	return Response{Entries: entries, Count: len(entries)}, nil
}

func runList(req Request) (Response, error) {
	cwd := req.Root
	if req.Path != "" {
		cwd = filepath.Join(req.Root, req.Path)
	}

	info, err := os.Stat(cwd)
	if err != nil {
		return Response{}, err
	}
	if !info.IsDir() {
		return Response{}, fmt.Errorf("path is not a directory: %s", cwd)
	}

	entries, err := os.ReadDir(cwd)
	if err != nil {
		return Response{}, err
	}

	var results []Entry
	for _, entry := range entries {
		if len(results) >= req.Limit {
			break
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if req.FileType != "" && !matchesType(info, req.FileType) {
			continue
		}
		rel := entry.Name()
		if req.Path != "" {
			rel = filepath.Join(req.Path, entry.Name())
		}
		results = append(results, buildEntry(rel, info, req))
	}

	sortEntries(results)

	return Response{Entries: results, Count: len(results)}, nil
}

func runFind(req Request) (Response, error) {
	cwd := req.Root
	if req.Path != "" {
		cwd = filepath.Join(req.Root, req.Path)
	}

	var entries []Entry
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, runtime.NumCPU()*2)

	err := walkDirParallel(cwd, req, &entries, &mu, &wg, sem, 0)
	wg.Wait()
	close(sem)

	if err != nil {
		return Response{}, err
	}

	if req.Pattern != "" {
		var filtered []Entry
		for _, e := range entries {
			if matchPattern(e.Path, req.Pattern) {
				filtered = append(filtered, e)
				if len(filtered) >= req.Limit {
					break
				}
			}
		}
		entries = filtered
	}

	if len(entries) > req.Limit {
		entries = entries[:req.Limit]
	}

	sortEntries(entries)

	return Response{Entries: entries, Count: len(entries)}, nil
}

func walkDirParallel(root string, req Request, entries *[]Entry, mu *sync.Mutex, wg *sync.WaitGroup, sem chan struct{}, depth int) error {
	if req.MaxDepth >= 0 && depth > req.MaxDepth {
		return nil
	}

	dirEntries, err := os.ReadDir(root)
	if err != nil {
		return err
	}

	for _, dirEntry := range dirEntries {
		if len(*entries) >= req.Limit*2 {
			return nil
		}

		if !req.NoIgnore && shouldIgnore(dirEntry.Name(), root) {
			continue
		}

		fullPath := filepath.Join(root, dirEntry.Name())
		info, err := dirEntry.Info()
		if err != nil {
			continue
		}

		if req.FileType == "" || matchesType(info, req.FileType) {
			rel, _ := filepath.Rel(req.Root, fullPath)
			mu.Lock()
			*entries = append(*entries, buildEntry(rel, info, req))
			mu.Unlock()
		}

		if info.IsDir() {
			wg.Add(1)
			sem <- struct{}{}
			go func(dir string, d int) {
				defer wg.Done()
				defer func() { <-sem }()
				walkDirParallel(dir, req, entries, mu, wg, sem, d+1)
			}(fullPath, depth)
		}
	}

	return nil
}

func buildEntry(path string, info os.FileInfo, req Request) Entry {
	e := Entry{
		Path: path,
		Type: fileType(info),
	}
	if shouldInclude(req, "size") {
		e.Size = info.Size()
	}
	if shouldInclude(req, "modified") {
		e.Modified = info.ModTime().UnixMilli()
	}
	if shouldInclude(req, "mode") {
		e.Mode = info.Mode().String()
	}
	return e
}

func matchPattern(path, pattern string) bool {
	matched, _ := filepath.Match(pattern, path)
	if matched {
		return true
	}
	base := filepath.Base(path)
	matched, _ = filepath.Match(pattern, base)
	return matched
}

func shouldIgnore(name, dir string) bool {
	if name == ".git" {
		return true
	}
	if strings.HasPrefix(name, ".git") ||
		name == "node_modules" ||
		name == "dist" ||
		name == "build" ||
		name == ".next" ||
		name == ".turbo" ||
		name == "vendor" {
		return true
	}
	return false
}

func matchesType(info os.FileInfo, fileType string) bool {
	switch fileType {
	case "file":
		return !info.IsDir()
	case "directory":
		return info.IsDir()
	default:
		return true
	}
}

func fileType(info os.FileInfo) string {
	if info.IsDir() {
		return "directory"
	}
	return "file"
}

func sortEntries(entries []Entry) {
	for i := 0; i < len(entries)-1; i++ {
		for j := i + 1; j < len(entries); j++ {
			if entries[i].Type == "file" && entries[j].Type == "directory" {
				entries[i], entries[j] = entries[j], entries[i]
			} else if entries[i].Type == entries[j].Type && entries[i].Path > entries[j].Path {
				entries[i], entries[j] = entries[j], entries[i]
			}
		}
	}
}