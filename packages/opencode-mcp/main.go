package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	_ "github.com/mattn/go-sqlite3"
)

type namedDB struct {
	db   *sql.DB
	name string
}

func main() {
	dataDir := os.Getenv("OPENCODE_DATA_DIR")
	if dataDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintf(os.Stderr, "error getting home dir: %v\n", err)
			os.Exit(1)
		}
		dataDir = filepath.Join(home, ".local", "share", "opencode")
	}

	entries, err := os.ReadDir(dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading data dir %s: %v\n", dataDir, err)
		os.Exit(1)
	}

	var dbs []namedDB
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !strings.HasPrefix(e.Name(), "opencode") || !strings.HasSuffix(e.Name(), ".db") {
			continue
		}
		dbPath := filepath.Join(dataDir, e.Name())
		db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_query_only=true")
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: error opening %s: %v\n", e.Name(), err)
			continue
		}
		if err := db.Ping(); err != nil {
			fmt.Fprintf(os.Stderr, "warning: error connecting %s: %v\n", e.Name(), err)
			db.Close()
			continue
		}
		dbs = append(dbs, namedDB{db: db, name: e.Name()})
	}

	if len(dbs) == 0 {
		fmt.Fprintf(os.Stderr, "no opencode databases found in %s\n", dataDir)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "opened %d databases: %v\n", len(dbs), func() []string {
		names := make([]string, len(dbs))
		for i, ndb := range dbs {
			names[i] = ndb.name
		}
		return names
	}())

	for _, ndb := range dbs {
		defer ndb.db.Close()
	}

	s := server.NewMCPServer(
		"ocreadb",
		"1.0.0",
		server.WithToolCapabilities(true),
		server.WithRecovery(),
	)

	s.AddTool(getCurrentSessionTool(), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return handleGetCurrentSession(dbs, req)
	})

	s.AddTool(listSessionsTool(), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return handleListSessions(dbs, req)
	})

	s.AddTool(showSessionTool(), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return handleShowSession(dbs, req)
	})

	s.AddTool(searchTool(), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return handleSearch(dbs, req)
	})

	if err := server.ServeStdio(s); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}

func getCurrentSessionTool() mcp.Tool {
	return mcp.NewTool("get_current_session",
		mcp.WithDescription("Get the most recent session. Optionally filter by directory (path prefix match) or project_id."),
		mcp.WithString("directory",
			mcp.Description("Filter sessions by directory prefix (e.g. /home/user/projects/myapp)"),
		),
		mcp.WithString("project_id",
			mcp.Description("Filter by project ID (the git SHA of the worktree)"),
		),
	)
}

func listSessionsTool() mcp.Tool {
	return mcp.NewTool("list_sessions",
		mcp.WithDescription("List sessions with optional filters: project_id, directory, page, limit, offset, and time ranges."),
		mcp.WithString("directory",
			mcp.Description("Filter sessions by directory prefix"),
		),
		mcp.WithString("project_id",
			mcp.Description("Filter by project ID"),
		),
		mcp.WithNumber("page",
			mcp.Description("Page number (1-based, default 1). Simpler alternative to offset."),
		),
		mcp.WithNumber("limit",
			mcp.Description("Maximum sessions to return (default 20, max 100)"),
		),
		mcp.WithNumber("offset",
			mcp.Description("Pagination offset (default 0). Alternative to page."),
		),
		mcp.WithNumber("before_time",
			mcp.Description("Return sessions older than this unix timestamp (milliseconds)"),
		),
		mcp.WithNumber("after_time",
			mcp.Description("Return sessions newer than this unix timestamp (milliseconds)"),
		),
	)
}

func showSessionTool() mcp.Tool {
	return mcp.NewTool("show_session",
		mcp.WithDescription("Show a session's messages with page-based pagination (first → newest). Page 1 = first N messages. Use page=N to go forward."),
		mcp.WithString("session_id",
			mcp.Required(),
			mcp.Description("The session ID (e.g. ses_0d6d11f43ffe...)"),
		),
		mcp.WithNumber("page",
			mcp.Description("Page number (1-based, default 1). Increment to get the next page."),
		),
		mcp.WithNumber("limit",
			mcp.Description("Messages per page (default 20, max 100)"),
		),
	)
}

func searchTool() mcp.Tool {
	return mcp.NewTool("search",
		mcp.WithDescription("Search across session titles and message content. Searches in session titles, tool outputs, and assistant responses."),
		mcp.WithString("query",
			mcp.Required(),
			mcp.Description("Search query string"),
		),
		mcp.WithNumber("limit",
			mcp.Description("Maximum results (default 20, max 100)"),
		),
	)
}

type session struct {
	ID           string `json:"id"`
	ProjectID    string `json:"project_id"`
	Slug         string `json:"slug"`
	Title        string `json:"title"`
	Directory    string `json:"directory"`
	Agent        string `json:"agent"`
	Model        string `json:"model"`
	TimeCreated  int64  `json:"time_created"`
	TimeUpdated  int64  `json:"time_updated"`
	MessageCount int    `json:"message_count,omitempty"`
	DBName       string `json:"db_name,omitempty"`
}

type sessionMessage struct {
	ID          string `json:"id"`
	SessionID   string `json:"session_id"`
	Type        string `json:"type"`
	Seq         int    `json:"seq"`
	TimeCreated int64  `json:"time_created"`
	Data        string `json:"data,omitempty"`
}

type messageWithParts struct {
	Message sessionMessage `json:"message"`
	Parts   []part         `json:"parts"`
	DBName  string         `json:"db_name,omitempty"`
}

type part struct {
	ID          string `json:"id"`
	MessageID   string `json:"message_id"`
	SessionID   string `json:"session_id"`
	TimeCreated int64  `json:"time_created"`
	Type        string `json:"type"`
	Text        string `json:"text"`
}

type searchResult struct {
	session
	MatchType    string `json:"match_type"`
	MatchSnippet string `json:"match_snippet"`
}

type pagination struct {
	Page       int `json:"page"`
	TotalPages int `json:"total_pages"`
	HasNext    bool `json:"has_next"`
	HasPrev    bool `json:"has_prev"`
}

func querySessions(ndb namedDB, directory, projectID string, beforeTime, afterTime int64, limit, offset int) ([]session, error) {
	var whereClauses []string
	var args []any

	if directory != "" {
		whereClauses = append(whereClauses, "s.directory LIKE ?")
		args = append(args, directory+"%")
	}
	if projectID != "" {
		whereClauses = append(whereClauses, "s.project_id = ?")
		args = append(args, projectID)
	}
	if beforeTime > 0 {
		whereClauses = append(whereClauses, "s.time_created < ?")
		args = append(args, beforeTime)
	}
	if afterTime > 0 {
		whereClauses = append(whereClauses, "s.time_created > ?")
		args = append(args, afterTime)
	}

	where := ""
	if len(whereClauses) > 0 {
		where = "WHERE " + strings.Join(whereClauses, " AND ")
	}

	q := fmt.Sprintf(`
		SELECT s.id, s.project_id, s.slug, s.title, s.directory, s.agent, s.model,
		       s.time_created, s.time_updated,
		       (SELECT COUNT(*) FROM message WHERE session_id = s.id) as msg_count
		FROM session s
		%s
		ORDER BY s.time_updated DESC
		LIMIT ? OFFSET ?
	`, where)
	args = append(args, limit, offset)

	rows, err := ndb.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []session
	for rows.Next() {
		var s session
		if err := rows.Scan(&s.ID, &s.ProjectID, &s.Slug, &s.Title, &s.Directory,
			&s.Agent, &s.Model, &s.TimeCreated, &s.TimeUpdated, &s.MessageCount); err != nil {
			continue
		}
		s.DBName = ndb.name
		sessions = append(sessions, s)
	}
	return sessions, nil
}

func handleGetCurrentSession(dbs []namedDB, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	directory := req.GetString("directory", "")
	projectID := req.GetString("project_id", "")

	var all []session
	for _, ndb := range dbs {
		sessions, err := querySessions(ndb, directory, projectID, 0, 0, 1, 0)
		if err != nil {
			continue
		}
		all = append(all, sessions...)
	}

	if len(all) == 0 {
		return mcp.NewToolResultText("No session found"), nil
	}

	sort.Slice(all, func(i, j int) bool {
		return all[i].TimeUpdated > all[j].TimeUpdated
	})

	b, _ := json.MarshalIndent(all[0], "", "  ")
	return mcp.NewToolResultText(string(b)), nil
}

func handleListSessions(dbs []namedDB, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	directory := req.GetString("directory", "")
	projectID := req.GetString("project_id", "")
	limit := int(req.GetFloat("limit", 20))
	page := int(req.GetFloat("page", 0))
	offset := int(req.GetFloat("offset", 0))
	if page > 0 {
		offset = (page - 1) * limit
	}
	beforeTime := int64(req.GetFloat("before_time", 0))
	afterTime := int64(req.GetFloat("after_time", 0))

	if limit > 100 {
		limit = 100
	}
	if limit < 1 {
		limit = 1
	}

	var all []session
	for _, ndb := range dbs {
		sessions, err := querySessions(ndb, directory, projectID, beforeTime, afterTime, limit+offset, 0)
		if err != nil {
			continue
		}
		all = append(all, sessions...)
	}

	if len(all) == 0 {
		return mcp.NewToolResultText("No sessions found"), nil
	}

	sort.Slice(all, func(i, j int) bool {
		return all[i].TimeUpdated > all[j].TimeUpdated
	})

	seen := make(map[string]bool)
	var deduped []session
	for _, s := range all {
		if seen[s.ID] {
			continue
		}
		seen[s.ID] = true
		deduped = append(deduped, s)
	}

	if offset >= len(deduped) {
		return mcp.NewToolResultText("No sessions found"), nil
	}
	end := offset + limit
	if end > len(deduped) {
		end = len(deduped)
	}
	deduped = deduped[offset:end]

	b, _ := json.MarshalIndent(deduped, "", "  ")
	return mcp.NewToolResultText(string(b)), nil
}

func handleShowSession(dbs []namedDB, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	sessionID, err := req.RequireString("session_id")
	if err != nil {
		return mcp.NewToolResultError("session_id is required"), nil
	}

	limit := int(req.GetFloat("limit", 20))
	if limit > 100 {
		limit = 100
	}
	if limit < 1 {
		limit = 1
	}

	page := int(req.GetFloat("page", 1))
	if page < 1 {
		page = 1
	}

	for _, ndb := range dbs {
		var s session
		err := ndb.db.QueryRow(`
			SELECT id, project_id, slug, title, directory, agent, model,
			       time_created, time_updated,
			       (SELECT COUNT(*) FROM message WHERE session_id = session.id) as msg_count
			FROM session WHERE id = ?
		`, sessionID).Scan(&s.ID, &s.ProjectID, &s.Slug, &s.Title, &s.Directory,
			&s.Agent, &s.Model, &s.TimeCreated, &s.TimeUpdated, &s.MessageCount)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			continue
		}
		s.DBName = ndb.name
		totalMessages := s.MessageCount
		totalPages := (totalMessages + limit - 1) / limit
		if totalPages < 1 {
			totalPages = 1
		}
		if page > totalPages {
			page = totalPages
		}
		offset := (page - 1) * limit

		var messages []messageWithParts

		rows, err := ndb.db.Query(`
			SELECT id, session_id,
			       json_extract(data, '$.role') as type,
			       time_created, time_created, data
			FROM message
			WHERE session_id = ?
			ORDER BY time_created ASC
			LIMIT ? OFFSET ?
		`, sessionID, limit, offset)
		if err == nil {
			for rows.Next() {
				var m sessionMessage
				var role sql.NullString
				if err := rows.Scan(&m.ID, &m.SessionID, &role, &m.TimeCreated, &m.TimeCreated, &m.Data); err != nil {
					continue
				}
				if role.Valid {
					m.Type = role.String
				}

				mwp := messageWithParts{Message: m, DBName: ndb.name}

				partRows, err := ndb.db.Query(`
					SELECT id, message_id, session_id, time_created,
					       json_extract(data, '$.type') as ptype,
					       json_extract(data, '$.text') as ptext
					FROM part
					WHERE message_id = ?
					ORDER BY time_created ASC
				`, m.ID)
				if err == nil {
					for partRows.Next() {
						var p part
						if err := partRows.Scan(&p.ID, &p.MessageID, &p.SessionID, &p.TimeCreated, &p.Type, &p.Text); err == nil {
							mwp.Parts = append(mwp.Parts, p)
						}
					}
					partRows.Close()
				}

				messages = append(messages, mwp)
			}
			rows.Close()
		}

		evtRows, err := ndb.db.Query(`
			SELECT id, session_id, type, seq, time_created, data
			FROM session_message
			WHERE session_id = ?
			ORDER BY seq ASC
		`, sessionID)
		if err == nil {
			for evtRows.Next() {
				var m sessionMessage
				if err := evtRows.Scan(&m.ID, &m.SessionID, &m.Type, &m.Seq, &m.TimeCreated, &m.Data); err == nil {
					mwp := messageWithParts{Message: m, DBName: ndb.name}
					messages = append(messages, mwp)
				}
			}
			evtRows.Close()
		}

		result := map[string]any{
			"session": s,
			"messages": messages,
			"pagination": pagination{
				Page:       page,
				TotalPages: totalPages,
				HasNext:    page < totalPages,
				HasPrev:    page > 1,
			},
		}
		b, _ := json.MarshalIndent(result, "", "  ")
		return mcp.NewToolResultText(string(b)), nil
	}

	return mcp.NewToolResultError("session not found"), nil
}

func handleSearch(dbs []namedDB, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	query, err := req.RequireString("query")
	if err != nil || query == "" {
		return mcp.NewToolResultError("query is required"), nil
	}
	limit := int(req.GetFloat("limit", 20))
	if limit > 100 {
		limit = 100
	}
	if limit < 1 {
		limit = 1
	}

	likePattern := "%" + query + "%"
	var all []searchResult
	seen := make(map[string]bool)

	for _, ndb := range dbs {
		titleRows, err := ndb.db.Query(`
			SELECT s.id, s.project_id, s.slug, s.title, s.directory, s.agent, s.model,
			       s.time_created, s.time_updated, 0 as msg_count
			FROM session s
			WHERE s.title LIKE ?
			ORDER BY s.time_updated DESC
			LIMIT ?
		`, likePattern, limit)
		if err == nil {
			for titleRows.Next() {
				var s session
				if err := titleRows.Scan(&s.ID, &s.ProjectID, &s.Slug, &s.Title, &s.Directory,
					&s.Agent, &s.Model, &s.TimeCreated, &s.TimeUpdated, &s.MessageCount); err == nil {
					if seen[s.ID] {
						continue
					}
					seen[s.ID] = true
					s.DBName = ndb.name
					all = append(all, searchResult{
						session:      s,
						MatchType:    "title",
						MatchSnippet: s.Title,
					})
				}
			}
			titleRows.Close()
		}
	}

	for _, ndb := range dbs {
		contentRows, err := ndb.db.Query(`
			SELECT p.session_id,
			       json_extract(p.data, '$.text') as text
			FROM part p
			WHERE json_extract(p.data, '$.text') IS NOT NULL
			  AND json_extract(p.data, '$.text') LIKE ?
			ORDER BY p.time_created DESC
			LIMIT ?
		`, likePattern, limit)
		if err == nil {
			for contentRows.Next() {
				var sessionID, snippet string
				if err := contentRows.Scan(&sessionID, &snippet); err != nil {
					continue
				}
				if seen[sessionID] {
					continue
				}

				var s session
				err := ndb.db.QueryRow(`
					SELECT id, project_id, slug, title, directory, agent, model,
					       time_created, time_updated, 0
					FROM session WHERE id = ?
				`, sessionID).Scan(&s.ID, &s.ProjectID, &s.Slug, &s.Title, &s.Directory,
					&s.Agent, &s.Model, &s.TimeCreated, &s.TimeUpdated, &s.MessageCount)
				if err != nil {
					continue
				}
				seen[s.ID] = true
				s.DBName = ndb.name

				truncated := snippet
				if len(truncated) > 300 {
					truncated = truncated[:300] + "..."
				}

				all = append(all, searchResult{
					session:      s,
					MatchType:    "content",
					MatchSnippet: truncated,
				})
			}
			contentRows.Close()
		}
	}

	if len(all) == 0 {
		return mcp.NewToolResultText("No results found"), nil
	}

	sort.Slice(all, func(i, j int) bool {
		return all[i].TimeUpdated > all[j].TimeUpdated
	})

	if len(all) > limit {
		all = all[:limit]
	}

	b, _ := json.MarshalIndent(all, "", "  ")
	return mcp.NewToolResultText(string(b)), nil
}
