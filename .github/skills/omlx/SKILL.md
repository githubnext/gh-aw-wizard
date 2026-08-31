---
name: omlx
description: Set up and operate authenticated oMLX model serving for local development, evaluation, and prompt optimization.
---

# oMLX Primer

Use this skill when a task needs to install, start, authenticate to, download models into, or debug
an oMLX server on Apple Silicon.

## Ground rules

- Treat `OMLX_API_KEY` as a secret. Never print it, commit it, or place it in a URL.
- Prefer process-scoped environment variables over command-line key arguments.
- Use the OpenAI-compatible `/v1` API for inference and model load/unload operations.
- Admin model-management endpoints require a session cookie. Create it with
  `POST /admin/api/login`; a `/v1` bearer token alone does not authorize `/admin/api/*`.
- Remove temporary cookie jars with a trap.
- Discover the live API at `/openapi.json` rather than assuming endpoint payloads across versions.

## Machine setup and model preload

Install and launch the oMLX macOS app or CLI first. This repository's setup script handles server
startup when the `omlx` CLI is present and performs authenticated model download and loading:

```bash
export OMLX_API_KEY='...'
./scripts/setup-omlx-models.sh
```

With no arguments it installs the scenario-assistant eval proxy,
`mlx-community/Qwen2.5-1.5B-Instruct-4bit`. Pass one or more Hugging Face repository IDs to preload
other models:

```bash
./scripts/setup-omlx-models.sh \
  mlx-community/Qwen2.5-1.5B-Instruct-4bit \
  mlx-community/Qwen3.8-27B-4bit
```

Set `OMLX_BASE_URL` for a non-default server and `OMLX_POLL_SECONDS` to change download polling.

## API workflow

1. Check `GET /health`.
2. Log in with `POST /admin/api/login` and JSON
   `{"api_key":"...","remember":false}`, saving the returned cookie.
3. Search with `GET /admin/api/hf/search?q=<query>&mlx_only=true`.
4. Download with `POST /admin/api/hf/download` and JSON `{"repo_id":"owner/model"}`.
5. Poll `GET /admin/api/hf/tasks` until the matching task is `completed`.
6. Refresh discovery with `POST /admin/api/reload`.
7. Load with `POST /v1/models/<served-id>/load` using `Authorization: Bearer ...`.
8. Verify availability with `GET /v1/models`, then send a small chat completion.

The served ID is normally the final path segment of the Hugging Face repository ID.

## Scenario prompt evaluation

oMLX serves MLX model conversions, not the MLC artifact used by WebLLM. The
`Qwen2.5-1.5B-Instruct-4bit` conversion is useful as a close development proxy, but reports must say
which served model produced the score. Run:

```bash
export EVAL_API_KEY="$OMLX_API_KEY"
node scripts/prompt-optimizer.mjs --evaluate --sample-size 20 \
  --eval-model Qwen2.5-1.5B-Instruct-4bit
```

Use the `optimize-scenario-prompt` skill for the measured rewrite loop.
