package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// ─── Schema types ──────────────────────────────────────────────────────────

type Session struct {
	ID                string  `json:"id"`
	ProjectID         string  `json:"project_id"`
	Slug              string  `json:"slug"`
	Title             string  `json:"title"`
	Version           string  `json:"version"`
	Model             string  `json:"model"`
	Agent             string  `json:"agent"`
	TimeCreated       int64   `json:"time_created"`
	TimeUpdated       int64   `json:"time_updated"`
	TimeCompacting    *int64  `json:"time_compacting,omitempty"`
	TimeArchived      *int64  `json:"time_archived,omitempty"`
	Cost              float64 `json:"cost"`
	TokensInput       int64   `json:"tokens_input"`
	TokensOutput      int64   `json:"tokens_output"`
	TokensReasoning   int64   `json:"tokens_reasoning"`
	TokensCacheRead   int64   `json:"tokens_cache_read"`
	TokensCacheWrite  int64   `json:"tokens_cache_write"`
	MessageCount      int     `json:"message_count,omitempty"`
}

type Message struct {
	ID          string          `json:"id"`
	SessionID   string          `json:"session_id"`
	TimeCreated int64           `json:"time_created"`
	TimeUpdated int64           `json:"time_updated"`
	Data        json.RawMessage `json:"data"`
	Parts       []Part          `json:"parts,omitempty"`
}

type Part struct {
	Data json.RawMessage `json:"data"`
}

type SessionEvent struct {
	Type string          `json:"type"`
	Seq  int             `json:"seq"`
	Data json.RawMessage `json:"data"`
}

type MessageData struct {
	Role      string `json:"role"`
	Agent     string `json:"agent,omitempty"`
	ModelID   string `json:"modelID,omitempty"`
	ParentID  string `json:"parentID,omitempty"`
	Mode      string `json:"mode,omitempty"`
	Finish    string `json:"finish,omitempty"`
	Tokens    *Tokens `json:"tokens,omitempty"`
}

type Tokens struct {
	Total      int   `json:"total"`
	Input      int   `json:"input"`
	Output     int   `json:"output"`
	Reasoning  int   `json:"reasoning"`
}

type PartData struct {
	Type string          `json:"type"`
	Text string          `json:"text,omitempty"`
	Tool string          `json:"tool,omitempty"`
}

type SessionOutput struct {
	Session  Session         `json:"session"`
	Events   []SessionEvent  `json:"events"`
	Messages []Message       `json:"messages"`
}

type PaginationMeta struct {
	CurrentCursor int `json:"current_cursor"`
	TotalCursors  int `json:"total_cursors"`
}

type SearchResult struct {
	Type          string `json:"type"`
	MessageID     string `json:"message_id"`
	SessionID     string `json:"session_id"`
	SessionTitle  string `json:"session_title"`
	Role          string `json:"role,omitempty"`
	PartType      string `json:"part_type,omitempty"`
	Snippet       string `json:"snippet,omitempty"`
	Created       string `json:"created"`
}

// ─── Filter types ──────────────────────────────────────────────────────────

type SessionFilters struct {
	After       string
	Before      string
	Agent       string
	Model       string
	Project     string
	Title       string
	MinMessages int
	MaxMessages int
	Limit       int
	Cursor      int
}

type MessageFilters struct {
	Role    string
	HasTool bool
	NoParts bool
	NoEvents bool
}

// ─── DB helpers ────────────────────────────────────────────────────────────

func defaultDB() string {
	dir := filepath.Join(os.Getenv("HOME"), ".local/share/opencode")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	var best string
	var bestSize int64
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".db") {
			info, err := e.Info()
			if err != nil {
				continue
			}
			if info.Size() > bestSize {
				bestSize = info.Size()
				best = filepath.Join(dir, e.Name())
			}
		}
	}
	return best
}

func listDBFiles() []string {
	dir := filepath.Join(os.Getenv("HOME"), ".local/share/opencode")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".db") {
			files = append(files, filepath.Join(dir, e.Name()))
		}
	}
	// Sort by size descending
	sort.Slice(files, func(i, j int) bool {
		si, _ := os.Stat(files[i])
		sj, _ := os.Stat(files[j])
		return si.Size() > sj.Size()
	})
	return files
}

func openDB(path string) (*sql.DB, error) {
	conn, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	// WAL + busy timeout for zero-lock reads
	_, _ = conn.Exec("PRAGMA journal_mode=WAL")
	_, _ = conn.Exec("PRAGMA busy_timeout=5000")
	_, _ = conn.Exec("PRAGMA synchronous=NORMAL")
	conn.SetMaxOpenConns(1)
	return conn, nil
}

func tsISO(ms int64) string {
	if ms == 0 {
		return ""
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

func parseModel(val string) string {
	if val == "" {
		return "unknown"
	}
	if strings.HasPrefix(val, "{") {
		var m struct {
			ID string `json:"id"`
		}
		if json.Unmarshal([]byte(val), &m) == nil && m.ID != "" {
			return m.ID
		}
	}
	return val
}

// ─── Commands ──────────────────────────────────────────────────────────────

func cmdListDBs() {
	files := listDBFiles()
	if len(files) == 0 {
		fmt.Println("No .db files found.")
		return
	}
	fmt.Printf("%10s  %-60s  %s\n", "Size", "Name", "#Sessions")
	fmt.Println(strings.Repeat("-", 90))
	for _, f := range files {
		fi, _ := os.Stat(f)
		pretty := fmt.Sprintf("%.0fM", float64(fi.Size())/1024/1024)
		name := filepath.Base(f)
		var cnt string
		if db, err := openDB(f); err == nil {
			var n int
			if db.QueryRow("SELECT COUNT(*) FROM session").Scan(&n) == nil {
				cnt = strconv.Itoa(n)
			}
			db.Close()
		}
		fmt.Printf("%10s  %-60s  %s\n", pretty, name, cnt)
	}
}

func cmdSessions(dbPath string, filters SessionFilters, jsonOut, verbose bool) {
	db, err := openDB(dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	where := []string{"1=1"}
	args := []any{}

	if filters.After != "" {
		ts, ok := parseTime(filters.After)
		if !ok {
			fmt.Fprintf(os.Stderr, "error: invalid --after time: %s\n", filters.After)
			os.Exit(1)
		}
		where = append(where, "time_created >= ?")
		args = append(args, ts)
	}
	if filters.Before != "" {
		ts, ok := parseTime(filters.Before)
		if !ok {
			fmt.Fprintf(os.Stderr, "error: invalid --before time: %s\n", filters.Before)
			os.Exit(1)
		}
		where = append(where, "time_created <= ?")
		args = append(args, ts)
	}
	if filters.Agent != "" {
		where = append(where, "agent = ?")
		args = append(args, filters.Agent)
	}
	if filters.Model != "" {
		where = append(where, "model LIKE ?")
		args = append(args, "%"+filters.Model+"%")
	}
	if filters.Project != "" {
		where = append(where, "project_id = ?")
		args = append(args, filters.Project)
	}
	if filters.Title != "" {
		where = append(where, "title LIKE ?")
		args = append(args, "%"+filters.Title+"%")
	}

	limit := 50
	if filters.Limit > 0 {
		limit = filters.Limit
	}
	if limit > 500 {
		limit = 500
	}

	cursor := 1
	if filters.Cursor > 0 {
		cursor = filters.Cursor
	}

	// Count total matching sessions (before min/max message filter)
	whereJoined := strings.Join(where, " AND ")
	var totalCount int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM session s WHERE %s`, whereJoined)
	err = db.QueryRow(countQuery, args...).Scan(&totalCount)
	if err != nil {
		totalCount = 0
	}

	totalCursors := (totalCount + limit - 1) / limit
	if totalCursors < 1 {
		totalCursors = 1
	}
	if cursor > totalCursors {
		cursor = totalCursors
	}

	offset := (cursor - 1) * limit

	q := fmt.Sprintf(`
		SELECT s.id, s.project_id, s.slug, s.title, s.version, s.model, s.agent,
		       s.time_created, s.time_updated, s.cost,
		       s.tokens_input, s.tokens_output, s.tokens_reasoning,
		       s.tokens_cache_read, s.tokens_cache_write,
		       COALESCE(m.cnt, 0) as message_count
		FROM session s
		LEFT JOIN (SELECT session_id, COUNT(*) as cnt FROM message GROUP BY session_id) m ON m.session_id = s.id
		WHERE %s
		ORDER BY s.time_created DESC
		LIMIT ? OFFSET ?
	`, whereJoined)
	allArgs := append(append([]any{}, args...), limit, offset)

	rows, err := db.Query(q, allArgs...)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var s Session
		err := rows.Scan(
			&s.ID, &s.ProjectID, &s.Slug, &s.Title, &s.Version,
			&s.Model, &s.Agent, &s.TimeCreated, &s.TimeUpdated,
			&s.Cost, &s.TokensInput, &s.TokensOutput, &s.TokensReasoning,
			&s.TokensCacheRead, &s.TokensCacheWrite,
			&s.MessageCount,
		)
		if err != nil {
			continue
		}
		sessions = append(sessions, s)
	}

	// Apply min/max message count filters (post-query since it's an aggregate)
	var filtered []Session
	for _, s := range sessions {
		if filters.MinMessages > 0 && s.MessageCount < filters.MinMessages {
			continue
		}
		if filters.MaxMessages > 0 && s.MessageCount > filters.MaxMessages {
			continue
		}
		filtered = append(filtered, s)
	}

	if jsonOut {
		pagination := PaginationMeta{
			CurrentCursor: cursor,
			TotalCursors:  totalCursors,
		}
		items := make([]map[string]any, 0, len(filtered))
		for _, s := range filtered {
			m := map[string]any{
				"id":            s.ID,
				"project":       s.ProjectID,
				"title":         s.Title,
				"agent":         s.Agent,
				"message_count": s.MessageCount,
				"created":       tsISO(s.TimeCreated),
				"updated":       tsISO(s.TimeUpdated),
			}
			if verbose {
				m["slug"] = s.Slug
				m["version"] = s.Version
				m["model"] = parseModel(s.Model)
				m["cost"] = s.Cost
				m["tokens_input"] = s.TokensInput
				m["tokens_output"] = s.TokensOutput
				m["tokens_reasoning"] = s.TokensReasoning
			}
			items = append(items, m)
		}
		out := map[string]any{
			"pagination": pagination,
			"sessions":   items,
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		enc.Encode(out)
	} else {
		fmt.Printf("%-44s  %-45s  %-12s  %-9s  %s\n",
			"Session ID", "Title", "Agent", "Messages", "Created")
		fmt.Println(strings.Repeat("-", 130))
		for _, s := range filtered {
			title := s.Title
			if len(title) > 42 {
				title = title[:42] + ".."
			}
			agent := s.Agent
			if agent == "" {
				agent = "?"
			}
			fmt.Printf("%-44s  %-45s  %-12s  %-9d  %s\n",
				s.ID, title, agent, s.MessageCount, tsISO(s.TimeCreated)[:19])
		}
		if totalCursors > 1 {
			fmt.Fprintf(os.Stderr, "\n[pagination] cursor=%d/%d\n", cursor, totalCursors)
		}
	}
}

func cmdShow(dbPath, sessionID string, mfilters MessageFilters, jsonOut, verbose bool) {
	db, err := openDB(dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	// Find session (exact or prefix)
	var s Session
	err = db.QueryRow(`
		SELECT id, project_id, slug, title, version, model, agent,
		       time_created, time_updated, time_compacting, time_archived,
		       cost, tokens_input, tokens_output, tokens_reasoning,
		       tokens_cache_read, tokens_cache_write
		FROM session WHERE id = ?
	`, sessionID).Scan(
		&s.ID, &s.ProjectID, &s.Slug, &s.Title, &s.Version,
		&s.Model, &s.Agent, &s.TimeCreated, &s.TimeUpdated,
		&s.TimeCompacting, &s.TimeArchived,
		&s.Cost, &s.TokensInput, &s.TokensOutput, &s.TokensReasoning,
		&s.TokensCacheRead, &s.TokensCacheWrite,
	)
	if err != nil {
		// Try prefix match
		err = db.QueryRow(`
			SELECT id, project_id, slug, title, version, model, agent,
			       time_created, time_updated, time_compacting, time_archived,
			       cost, tokens_input, tokens_output, tokens_reasoning,
			       tokens_cache_read, tokens_cache_write
			FROM session WHERE id LIKE ?
		`, sessionID+"%").Scan(
			&s.ID, &s.ProjectID, &s.Slug, &s.Title, &s.Version,
			&s.Model, &s.Agent, &s.TimeCreated, &s.TimeUpdated,
			&s.TimeCompacting, &s.TimeArchived,
			&s.Cost, &s.TokensInput, &s.TokensOutput, &s.TokensReasoning,
			&s.TokensCacheRead, &s.TokensCacheWrite,
		)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: session '%s' not found\n", sessionID)
			os.Exit(1)
		}
	}

	// Get message events (session_message)
	events := []SessionEvent{}
	if !mfilters.NoEvents {
		erows, err := db.Query(`
			SELECT type, seq, data FROM session_message
			WHERE session_id = ? ORDER BY seq ASC
		`, s.ID)
		if err == nil {
			defer erows.Close()
			for erows.Next() {
				var ev SessionEvent
				if erows.Scan(&ev.Type, &ev.Seq, &ev.Data) == nil {
					events = append(events, ev)
				}
			}
		}
	}

	// Build message query with filters
	msgWhere := []string{"session_id = ?"}
	msgArgs := []any{s.ID}

	if mfilters.Role != "" {
		msgWhere = append(msgWhere, "json_extract(data, '$.role') = ?")
		msgArgs = append(msgArgs, mfilters.Role)
	}

	msgQuery := fmt.Sprintf(`
		SELECT id, session_id, time_created, time_updated, data
		FROM message WHERE %s
		ORDER BY time_created ASC
	`, strings.Join(msgWhere, " AND "))

	mrows, err := db.Query(msgQuery, msgArgs...)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	defer mrows.Close()

	messages := []Message{}
	msgIDs := []string{}

	for mrows.Next() {
		var m Message
		if mrows.Scan(&m.ID, &m.SessionID, &m.TimeCreated, &m.TimeUpdated, &m.Data) == nil {
			messages = append(messages, m)
			msgIDs = append(msgIDs, m.ID)
		}
	}

	// Fetch parts for these messages
	if !mfilters.NoParts && len(msgIDs) > 0 {
		// Build part query
		ph := make([]string, len(msgIDs))
		pargs := make([]any, len(msgIDs))
		for i, id := range msgIDs {
			ph[i] = "?"
			pargs[i] = id
		}
		pquery := fmt.Sprintf(`
			SELECT message_id, data FROM part
			WHERE message_id IN (%s)
			ORDER BY rowid ASC
		`, strings.Join(ph, ","))

		prows, err := db.Query(pquery, pargs...)
		if err == nil {
			defer prows.Close()
			typeMap := make(map[string][]Part)
			for prows.Next() {
				var mid string
				var pdata json.RawMessage
				if prows.Scan(&mid, &pdata) == nil {
					typeMap[mid] = append(typeMap[mid], Part{Data: pdata})
				}
			}
			// Apply has-tool filter if needed
			for i := range messages {
				if mfilters.HasTool {
					// Check if any part has type=tool
					hasTool := false
					for _, p := range typeMap[messages[i].ID] {
						var pd PartData
						if json.Unmarshal(p.Data, &pd) == nil && pd.Type == "tool" {
							hasTool = true
							break
						}
					}
					if !hasTool {
						// Remove this message
						continue
					}
				}
				messages[i].Parts = typeMap[messages[i].ID]
			}
		}
	}

	if jsonOut {
		sessionMap := map[string]any{
			"id":           s.ID,
			"project_id":   s.ProjectID,
			"title":        s.Title,
			"agent":        s.Agent,
			"time_created": tsISO(s.TimeCreated),
			"time_updated": tsISO(s.TimeUpdated),
		}
		if verbose {
			sessionMap["slug"] = s.Slug
			sessionMap["version"] = s.Version
			sessionMap["model"] = parseModel(s.Model)
			sessionMap["cost"] = s.Cost
			sessionMap["tokens_input"] = s.TokensInput
			sessionMap["tokens_output"] = s.TokensOutput
			sessionMap["tokens_reasoning"] = s.TokensReasoning
		}
		out := map[string]any{
			"session":  sessionMap,
			"events":   events,
			"messages": messages,
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		enc.Encode(out)
		return
	}

	// Text output
	fmt.Printf("Session: %s\n", s.Title)
	fmt.Printf("  ID:      %s\n", s.ID)
	fmt.Printf("  Project: %s\n", s.ProjectID)
	fmt.Printf("  Agent:   %s\n", s.Agent)
	fmt.Printf("  Created: %s\n", tsISO(s.TimeCreated))
	if verbose {
		fmt.Printf("  Model:   %s\n", parseModel(s.Model))
		fmt.Printf("  Cost:    %.6f\n", s.Cost)
		fmt.Printf("  Tokens:  %di / %do / %dr\n", s.TokensInput, s.TokensOutput, s.TokensReasoning)
	}
	fmt.Println()

	for _, m := range messages {
		var md MessageData
		json.Unmarshal(m.Data, &md)
		label := fmt.Sprintf("[%s]", md.Role)
		if md.Agent != "" {
			label += fmt.Sprintf(" (%s)", md.Agent)
		}
		modelStr := md.ModelID
		if modelStr != "" {
			modelStr = " " + modelStr
		}
		fmt.Printf("\n%s\n", strings.Repeat("=", 70))
		fmt.Printf("  %s  %s%s\n", label, tsISO(m.TimeCreated), modelStr)
		fmt.Println(strings.Repeat("=", 70))

		for _, p := range m.Parts {
			var pd PartData
			if err := json.Unmarshal(p.Data, &pd); err != nil {
				continue
			}
			switch pd.Type {
			case "text":
				fmt.Println(pd.Text)
			case "reasoning":
				fmt.Printf("  ┌─ [reasoning] %s\n", strings.Repeat("─", 20))
				for _, line := range strings.Split(pd.Text, "\n") {
					fmt.Printf("  │ %s\n", line)
				}
				fmt.Printf("  └%s\n", strings.Repeat("─", 33))
			case "tool":
				var full struct {
					Tool  string `json:"tool"`
					State struct {
						Status string `json:"status"`
						Input  any    `json:"input"`
					} `json:"state"`
				}
				inpStr := ""
				if json.Unmarshal(p.Data, &full) == nil {
					inpB, _ := json.Marshal(full.State.Input)
					inpStr = string(inpB)
					if len(inpStr) > 200 {
						inpStr = inpStr[:200] + "..."
					}
				}
				fmt.Printf("  ⚙ %s[%s]: %s\n", full.Tool, full.State.Status, inpStr)
			case "step-start":
				fmt.Printf("  ▶ step\n")
			case "step-finish":
				var sf struct {
					Reason string `json:"reason"`
					Tokens any    `json:"tokens"`
				}
				tokStr := ""
				if json.Unmarshal(p.Data, &sf) == nil {
					if t, ok := sf.Tokens.(map[string]any); ok {
						tokStr = fmt.Sprintf(", tokens=%v", t["total"])
					}
				}
				fmt.Printf("  ■ finish (%s)%s\n", sf.Reason, tokStr)
			case "compaction":
				fmt.Printf("  ↺ compaction\n")
			default:
				b, _ := json.Marshal(pd)
				bs := string(b)
				if len(bs) > 200 {
					bs = bs[:200] + "..."
				}
				fmt.Printf("  [%s] %s\n", pd.Type, bs)
			}
		}
	}
	fmt.Println()
}

func cmdSearch(dbPath, query string, jsonOut bool) {
	db, err := openDB(dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	like := "%" + query + "%"

	// Search in message data
	msgRows, err := db.Query(`
		SELECT m.id, m.session_id, m.data, s.title, m.time_created
		FROM message m JOIN session s ON s.id = m.session_id
		WHERE m.data LIKE ?
		ORDER BY m.time_created DESC LIMIT 50
	`, like)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	defer msgRows.Close()

	var results []SearchResult
	seen := map[string]bool{}

	for msgRows.Next() {
		var mid, sid string
		var data json.RawMessage
		var title string
		var tc int64
		msgRows.Scan(&mid, &sid, &data, &title, &tc)

		var md MessageData
		json.Unmarshal(data, &md)

		results = append(results, SearchResult{
			Type:         "message",
			MessageID:    mid,
			SessionID:    sid,
			SessionTitle: title,
			Role:         md.Role,
			Created:      tsISO(tc),
		})
		seen[mid] = true
	}

	// Search in part text
	partRows, err := db.Query(`
		SELECT p.message_id, p.session_id, p.data, s.title, m.time_created, m.data
		FROM part p
		JOIN session s ON s.id = p.session_id
		JOIN message m ON m.id = p.message_id
		WHERE p.data LIKE ?
		ORDER BY m.time_created DESC LIMIT 50
	`, like)
	if err == nil {
		defer partRows.Close()
		for partRows.Next() {
			var mid, sid string
			var pdata, mdata json.RawMessage
			var title string
			var tc int64
			partRows.Scan(&mid, &sid, &pdata, &title, &tc, &mdata)

			if seen[mid] {
				continue
			}
			seen[mid] = true

			var md MessageData
			json.Unmarshal(mdata, &md)

			var pd PartData
			snippet := ""
			if json.Unmarshal(pdata, &pd) == nil {
				if pd.Type == "text" || pd.Type == "reasoning" {
					snippet = pd.Text
					if len(snippet) > 300 {
						snippet = snippet[:300]
					}
				} else {
					b, _ := json.Marshal(pd)
					snippet = string(b)
					if len(snippet) > 200 {
						snippet = snippet[:200]
					}
				}
			}

			results = append(results, SearchResult{
				Type:         "part",
				MessageID:    mid,
				SessionID:    sid,
				SessionTitle: title,
				Role:         md.Role,
				PartType:     pd.Type,
				Snippet:      snippet,
				Created:      tsISO(tc),
			})
		}
	}

	// Sort by time desc
	sort.Slice(results, func(i, j int) bool {
		return results[i].Created > results[j].Created
	})
	if len(results) > 50 {
		results = results[:50]
	}

	if jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		enc.Encode(results)
		return
	}

	fmt.Printf("Search results for: %s\n\n", query)
	msgResults := 0
	partResults := 0
	for _, r := range results {
		if r.Type == "message" {
			if msgResults == 0 {
				fmt.Println("--- Matches in message metadata ---")
			}
			fmt.Printf("  %s [%s] — %s (%s)\n", r.MessageID[:20], r.Role, r.SessionTitle, r.Created[:19])
			msgResults++
		}
	}
	for _, r := range results {
		if r.Type == "part" {
			if partResults == 0 {
				fmt.Println("\n--- Matches in message parts ---")
			}
			fmt.Printf("  %s [%s] — %s\n", r.MessageID[:20], r.PartType, r.SessionTitle)
			if r.Snippet != "" {
				fmt.Printf("    %s\n", r.Snippet)
			}
			partResults++
		}
	}
	if len(results) == 0 {
		fmt.Println("  No matches found.")
	}
}

func cmdRaw(dbPath, sqlStr string) {
	db, err := openDB(dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	trimmed := strings.TrimSpace(sqlStr)
	if !strings.HasPrefix(strings.ToUpper(trimmed), "SELECT") {
		fmt.Fprintln(os.Stderr, "error: only SELECT queries allowed")
		os.Exit(1)
	}

	rows, err := db.Query(trimmed)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	var all []map[string]any
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if rows.Scan(ptrs...) != nil {
			continue
		}
		row := make(map[string]any)
		for i, col := range cols {
			switch v := vals[i].(type) {
			case []byte:
				row[col] = string(v)
			default:
				row[col] = v
			}
		}
		all = append(all, row)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(all)
}

// ─── Time parsing ──────────────────────────────────────────────────────────

func parseTime(s string) (int64, bool) {
	// Try epoch ms
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return n, true
	}
	// Try ISO 8601
	for _, fmt := range []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02",
	} {
		if t, err := time.Parse(fmt, s); err == nil {
			return t.UnixMilli(), true
		}
	}
	return 0, false
}

// ─── Main ──────────────────────────────────────────────────────────────────

type rawFlags struct {
	dbPath      string
	after       string
	before      string
	agent       string
	model       string
	project     string
	title       string
	minMessages int
	maxMessages int
	limit       int
	cursor      int
	role        string
	hasTool     bool
	noEvents    bool
	noParts     bool
	textOut     bool
	verbose     bool
	showHelp    bool
}

func parseFlags() (rawFlags, []string) {
	f := rawFlags{
		limit:  50,
		cursor: 1,
	}
	args := os.Args[1:]
	out := []string{}

	for i := 0; i < len(args); i++ {
		a := args[i]

		if a == "--help" || a == "-h" {
			f.showHelp = true
			continue
		}

		// --key=value form
		if strings.HasPrefix(a, "--") && strings.Contains(a, "=") {
			kv := strings.SplitN(a, "=", 2)
			key, val := kv[0], kv[1]
			switch key {
			case "--db":           f.dbPath = val
			case "--after":        f.after = val
			case "--before":       f.before = val
			case "--agent":        f.agent = val
			case "--model":        f.model = val
			case "--project":      f.project = val
			case "--title":        f.title = val
			case "--role":         f.role = val
			case "--min-messages": f.minMessages = parseInt(val, 0)
			case "--max-messages": f.maxMessages = parseInt(val, 0)
			case "--limit":        f.limit = parseInt(val, 50)
			case "--cursor":       f.cursor = parseInt(val, 1)
			default:               out = append(out, a)
			}
			continue
		}

		// Boolean flags
		switch a {
		case "--has-tool":  f.hasTool = true; continue
		case "--no-events": f.noEvents = true; continue
		case "--no-parts":  f.noParts = true; continue
		case "--text":      f.textOut = true; continue
		case "--verbose":   f.verbose = true; continue
		}

		// --key value form (consumes next arg)
		switch a {
		case "--db":           f.dbPath = nextArg(args, &i); continue
		case "--after":        f.after = nextArg(args, &i); continue
		case "--before":       f.before = nextArg(args, &i); continue
		case "--agent":        f.agent = nextArg(args, &i); continue
		case "--model":        f.model = nextArg(args, &i); continue
		case "--project":      f.project = nextArg(args, &i); continue
		case "--title":        f.title = nextArg(args, &i); continue
		case "--role":         f.role = nextArg(args, &i); continue
		case "--min-messages": f.minMessages = parseInt(nextArg(args, &i), 0); continue
		case "--max-messages": f.maxMessages = parseInt(nextArg(args, &i), 0); continue
		case "--limit":        f.limit = parseInt(nextArg(args, &i), 50); continue
		case "--cursor":       f.cursor = parseInt(nextArg(args, &i), 1); continue
		}

		out = append(out, a)
	}
	return f, out
}

func nextArg(args []string, i *int) string {
	*i++
	if *i >= len(args) {
		fmt.Fprintln(os.Stderr, "error: flag requires a value")
		os.Exit(1)
	}
	return args[*i]
}

func parseInt(s string, def int) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

func main() {
	f, args := parseFlags()

	if f.showHelp || len(args) == 0 {
		fmt.Fprint(os.Stderr, `ocred — Read OpenCode conversation messages from SQLite databases.

Usage:
  ocred [--db PATH] <command> [flags] [args]

Commands:
  list-dbs                         List available database files
  sessions                         List & filter sessions
  show <session-id>                Show full conversation
  search <query>                   Search across all messages
  raw <sql>                        Run raw SELECT query

Global flags (any position):
  --db PATH          Path to OpenCode database (default: largest in ~/.local/share/opencode/)

Session filter flags (for sessions, search):
  --after TIME       Filter sessions after time (ISO8601 or epoch ms)
  --before TIME      Filter sessions before time
  --agent STR        Filter by agent (build, explore, general, ...)
  --model STR        Filter by model name or ID
  --project STR      Filter by project ID
  --title STR        Filter by session title (substring)
  --min-messages N   Minimum message count (sessions only)
  --max-messages N   Maximum message count (sessions only)
  --limit N          Max results per page (default: 50, max: 500)
  --cursor N         Page number for cursor-based pagination (default: 1)

Message filter flags (for show):
  --role STR         Filter by role: user | assistant
  --has-tool         Only messages containing tool calls
  --no-events        Skip session_message events
  --no-parts         Skip message parts detail

Output flags:
  --text             Human-readable text output (default: JSON)
  --verbose          Include tokens, cost, model, slug, version fields
`)
		if f.showHelp {
			return
		}
		os.Exit(1)
	}

	// Resolve DB path
	db := f.dbPath
	if db == "" {
		db = defaultDB()
		if db == "" {
			fmt.Fprintln(os.Stderr, "error: no database found. specify with --db")
			os.Exit(1)
		}
	}

	cmd := args[0]
	cmdArgs := args[1:]
	jsonOut := !f.textOut

	switch cmd {
	case "list-dbs":
		cmdListDBs()

	case "sessions":
		cmdSessions(db, SessionFilters{
			After:       f.after,
			Before:      f.before,
			Agent:       f.agent,
			Model:       f.model,
			Project:     f.project,
			Title:       f.title,
			MinMessages: f.minMessages,
			MaxMessages: f.maxMessages,
			Limit:       f.limit,
			Cursor:      f.cursor,
		}, jsonOut, f.verbose)

	case "show":
		if len(cmdArgs) < 1 {
			fmt.Fprintln(os.Stderr, "error: missing session-id\n  usage: ocred show <session-id>")
			os.Exit(1)
		}
		cmdShow(db, cmdArgs[0], MessageFilters{
			Role:    f.role,
			HasTool: f.hasTool,
			NoParts: f.noParts,
			NoEvents: f.noEvents,
		}, jsonOut, f.verbose)

	case "search":
		if len(cmdArgs) < 1 {
			fmt.Fprintln(os.Stderr, "error: missing query\n  usage: ocred search <query>")
			os.Exit(1)
		}
		cmdSearch(db, strings.Join(cmdArgs, " "), jsonOut)

	case "raw":
		if len(cmdArgs) < 1 {
			fmt.Fprintln(os.Stderr, "error: missing SQL\n  usage: ocred raw \"SELECT ...\"")
			os.Exit(1)
		}
		cmdRaw(db, strings.Join(cmdArgs, " "))

	default:
		fmt.Fprintf(os.Stderr, "error: unknown command '%s'\n  run 'ocred --help' for usage\n", cmd)
		os.Exit(1)
	}
}
