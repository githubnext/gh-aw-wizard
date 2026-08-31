#!/usr/bin/env bash

set -euo pipefail

OMLX_BASE_URL="${OMLX_BASE_URL:-http://127.0.0.1:8000}"
DEFAULT_MODEL="mlx-community/Qwen2.5-1.5B-Instruct-4bit"
POLL_SECONDS="${OMLX_POLL_SECONDS:-5}"

if [[ -z "${OMLX_API_KEY:-}" ]]; then
  echo "OMLX_API_KEY is required." >&2
  exit 1
fi

if [[ "$#" -eq 0 ]]; then
  set -- "$DEFAULT_MODEL"
fi

if ! curl -fsS --max-time 2 "$OMLX_BASE_URL/health" >/dev/null; then
  if command -v omlx >/dev/null 2>&1; then
    omlx start
    for _ in {1..30}; do
      curl -fsS --max-time 2 "$OMLX_BASE_URL/health" >/dev/null && break
      sleep 1
    done
  fi
fi

if ! curl -fsS --max-time 2 "$OMLX_BASE_URL/health" >/dev/null; then
  echo "oMLX is not reachable at $OMLX_BASE_URL. Install and start the oMLX app first." >&2
  exit 1
fi

cookie_file="$(mktemp "${TMPDIR:-/tmp}/omlx-admin.XXXXXX")"
trap 'rm -f "$cookie_file"' EXIT

login_body="$(
  OMLX_API_KEY="$OMLX_API_KEY" python3 -c \
    'import json, os; print(json.dumps({"api_key": os.environ["OMLX_API_KEY"], "remember": False}))'
)"
curl -fsS \
  -c "$cookie_file" \
  -H 'Content-Type: application/json' \
  -d "$login_body" \
  "$OMLX_BASE_URL/admin/api/login" >/dev/null

is_installed() {
  local repo_id="$1"
  curl -fsS -b "$cookie_file" "$OMLX_BASE_URL/admin/api/hf/models" |
    python3 -c '
import json, sys
repo_id = sys.argv[1]
models = json.load(sys.stdin).get("models", [])
raise SystemExit(0 if any(model.get("display_name") == repo_id for model in models) else 1)
' "$repo_id"
}

wait_for_download() {
  local task_id="$1"
  local repo_id="$2"
  local previous=""
  while true; do
    local task
    task="$(
      curl -fsS -b "$cookie_file" "$OMLX_BASE_URL/admin/api/hf/tasks" |
        python3 -c '
import json, sys
task_id = sys.argv[1]
payload = json.load(sys.stdin)
tasks = payload.get("tasks", payload if isinstance(payload, list) else [])
task = next((item for item in tasks if item.get("task_id") == task_id), None)
print(json.dumps(task or {}))
' "$task_id"
    )"
    local status progress message
    status="$(printf '%s' "$task" | python3 -c 'import json, sys; print(json.load(sys.stdin).get("status", "missing"))')"
    progress="$(printf '%s' "$task" | python3 -c 'import json, sys; print(round(json.load(sys.stdin).get("progress", 0), 1))')"
    message="$status $progress%"
    if [[ "$message" != "$previous" ]]; then
      echo "$repo_id: $message"
      previous="$message"
    fi
    case "$status" in
      completed) return ;;
      failed|cancelled|missing)
        echo "$repo_id download failed: $task" >&2
        exit 1
        ;;
    esac
    sleep "$POLL_SECONDS"
  done
}

for repo_id in "$@"; do
  if is_installed "$repo_id"; then
    echo "$repo_id: already downloaded"
  else
    request_body="$(python3 -c 'import json, sys; print(json.dumps({"repo_id": sys.argv[1]}))' "$repo_id")"
    response="$(
      curl -fsS \
        -b "$cookie_file" \
        -H 'Content-Type: application/json' \
        -d "$request_body" \
        "$OMLX_BASE_URL/admin/api/hf/download"
    )"
    task_id="$(printf '%s' "$response" | python3 -c 'import json, sys; print(json.load(sys.stdin)["task"]["task_id"])')"
    wait_for_download "$task_id" "$repo_id"
  fi

  curl -fsS -b "$cookie_file" -X POST "$OMLX_BASE_URL/admin/api/reload" >/dev/null
  model_id="${repo_id##*/}"
  encoded_model_id="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$model_id")"
  curl -fsS \
    -X POST \
    -H "Authorization: Bearer $OMLX_API_KEY" \
    "$OMLX_BASE_URL/v1/models/$encoded_model_id/load" >/dev/null
  echo "$repo_id: loaded as $model_id"
done
