#!/usr/bin/env bash
# script/divee.sh — curl one-liners for the TaskApi (draft-10 P7).
#
# When the SSH surface is unavailable (ssh2 probe failed, or the operator
# prefers curl), this script prints the exact commands to create a task,
# list tasks, follow a task's logs, and cancel a task. Auth is HTTP basic
# from env vars; the base URL defaults to localhost:4097.
#
# Usage:
#   DIVEEOI_URL=http://localhost:4097 DIVEEOI_USER=opencode DIVEEOI_PASS=... \
#     ./script/divee.sh run "Fix the CORS bug"
#   ./script/divee.sh tasks
#   ./script/divee.sh logs task_01J... --follow
#   ./script/divee.sh cancel task_01J...

set -euo pipefail

URL="${DIVEEOI_URL:-http://localhost:4097}"
USER="${DIVEEOI_USER:-opencode}"
PASS="${DIVEEOI_PASS:-${VITE_DIVEEOI_SERVER_PASSWORD:-}}"
AUTH="${USER}:${PASS}"

if [[ -z "${PASS}" ]]; then
  echo "Error: DIVEEOI_PASS (or VITE_DIVEEOI_SERVER_PASSWORD) must be set" >&2
  exit 1
fi

cmd="${1:-help}"
shift || true

case "${cmd}" in
  run)
    prompt="$*"
    if [[ -z "${prompt}" ]]; then
      echo "Usage: divee.sh run <prompt>" >&2
      exit 1
    fi
    curl -sS -X POST "${URL}/api/v1/tasks" \
      -u "${AUTH}" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg p "${prompt}" '{prompt: $p, autoRun: true}')" \
      | jq .
    ;;
  tasks)
    curl -sS "${URL}/api/v1/tasks" -u "${AUTH}" | jq .
    ;;
  status)
    id="${1:?Usage: divee.sh status <task_id>}"
    curl -sS "${URL}/api/v1/tasks/${id}" -u "${AUTH}" | jq .
    ;;
  logs)
    id="${1:?Usage: divee.sh logs <task_id> [--follow]}"
    follow="${2:-}"
    if [[ "${follow}" == "--follow" || "${follow}" == "-f" ]]; then
      curl -sS -N "${URL}/api/v1/tasks/${id}/events" -u "${AUTH}"
    else
      curl -sS "${URL}/api/v1/tasks/${id}/events" -u "${AUTH}" | jq .
    fi
    ;;
  cancel)
    id="${1:?Usage: divee.sh cancel <task_id>}"
    curl -sS -X DELETE "${URL}/api/v1/tasks/${id}" -u "${AUTH}" | jq .
    ;;
  models)
    curl -sS "${URL}/api/model" -u "${AUTH}" | jq .
    ;;
  health)
    curl -sS "${URL}/api/health" -u "${AUTH}" | jq .
    ;;
  help|--help|-h)
    cat <<EOF
DiveeOI curl helper (draft-10 P7).

Env:
  DIVEEOI_URL   (default http://localhost:4097)
  DIVEEOI_USER  (default opencode)
  DIVEEOI_PASS  (required — falls back to VITE_DIVEEOI_SERVER_PASSWORD)

Commands:
  run <prompt>           Create + auto-run a task with the given prompt.
  tasks                  List all tasks.
  status <id>            Get one task's status.
  logs <id> [--follow]   Stream a task's events (SSE when --follow).
  cancel <id>             Cancel a task.
  models                 List available models.
  health                 Server health check.
EOF
    ;;
  *)
    echo "Unknown command: ${cmd}. Try 'divee.sh help'." >&2
    exit 1
    ;;
esac
