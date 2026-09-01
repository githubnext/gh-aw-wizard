---
name: "Prompt Optimization"
description: Daily hill-climbing optimization of the scenario-assistant prompt using cached Hugging Face models served by Ollama
engine: copilot
on:
  schedule: daily
  workflow_dispatch:
permissions:
  contents: read
  pull-requests: read
  copilot-requests: write
network:
  allowed:
    - defaults
    - node
    - local
skills:
  - .github/skills/optimize-scenario-prompt
tools:
  bash: ["*"]
  github:
    mode: gh-proxy
    toolsets: [pull_requests, repos]
safe-outputs:
  create-pull-request:
    draft: true
    title-prefix: "Prompt optimization: "
    if-no-changes: "ignore"
    allowed-files:
      - src/js/slm.js
  create-pull-request-review-comment:
    max: 1
    side: RIGHT
    target: "*"
  submit-pull-request-review:
    max: 1
    allowed-events: [COMMENT]
    target: "*"
sandbox:
  agent:
    id: awf
    runtime: docker-sudo-iptables
    allow-host-ports: [11434]
strict: true
timeout-minutes: 180
steps:
  - name: Set up Node.js
    uses: actions/setup-node@v7
    with:
      node-version: 24
      cache: npm

  - name: Install dependencies
    run: npm ci

  - name: Restore Hugging Face model weights
    uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9
    with:
      key: ollama-hugging-face-models-v1-${{ runner.os }}
      path: ~/.ollama

  - name: Set up Ollama
    uses: ai-action/setup-ollama@0fdcbba8ac63bc9c0e7629cf85f46b77a4ad4072
    with:
      version: 0.33.2

  - name: Start Ollama
    run: |
      OLLAMA_HOST=0.0.0.0:11434 ollama serve >"$RUNNER_TEMP/ollama.log" 2>&1 &
      for attempt in {1..30}; do
        if curl --fail --silent http://127.0.0.1:11434/api/version >/dev/null; then
          exit 0
        fi
        if [ "$attempt" -eq 30 ]; then
          cat "$RUNNER_TEMP/ollama.log" >&2
          echo "Ollama did not become ready" >&2
          exit 1
        fi
        sleep 2
      done

  - name: Load and verify evaluation models
    run: |
      for model in \
        hf.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M \
        hf.co/unsloth/SmolLM2-360M-Instruct-GGUF:Q4_K_M; do
        ollama pull "$model"
        ollama run --keepalive 4h "$model" "Reply with exactly: ready" >/dev/null
      done
      ollama ps
---

# Scenario Prompt Optimization

Improve the wizard's shipped scenario-assistant instructions with measured hill climbing. The
workflow has already restored the Ollama cache, downloaded GGUF proxies for both browser models
from Hugging Face, and started an OpenAI-compatible Ollama server on
`http://host.docker.internal:11434/v1`.

Use the installed `optimize-scenario-prompt` skill and
`scripts/prompt-optimizer.mjs`. Use these options for every evaluation or score command:

```text
--all-models
--eval-url http://host.docker.internal:11434/v1
--eval-model hf.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M
--ios-eval-url http://host.docker.internal:11434/v1
--ios-eval-model hf.co/unsloth/SmolLM2-360M-Instruct-GGUF:Q4_K_M
```

These are Ollama/GGUF proxy scores, not bit-for-bit WebLLM scores. Preserve that qualification in
the pull request and review comment.

## Existing pull request guard

Before optimizing, use the read-only GitHub tools to search for an open pull request whose title
starts with `Prompt optimization:`.

- If one exists and it has no line-level review comment from this workflow summarizing the measured
  proxy scores, inspect its diff and body, add that review comment to the changed
  `DEFAULT_SCENARIO_INSTRUCTIONS`, and submit a `COMMENT` review. Supply the pull request number to
  both safe-output calls, then stop.
- If it already has that review comment, call `noop` with its pull request number and stop.
- Only continue to optimization when no matching open pull request exists. Do not attempt to review
  a pull request created during the current run; the next daily run will review it after GitHub has
  assigned its number.

## Hill-climbing loop

1. Measure the incumbent with `--evaluate --sample-size 20` and save its aggregate and per-model
   scores.
2. Read `.optimizer/eval-report.md`, group failures by root cause, and choose one small,
   attributable instruction change.
3. Write one candidate under `.optimizer/` and score it with `--score`, `--validation-size 30`, and
   `--min-gain 0.01`.
4. Treat an accepted candidate as the new incumbent. For a rejection, use the measured regression
   or unchanged failures to choose a materially different single change.
5. Repeat for at most four candidate evaluations. Stop earlier after two consecutive rejections,
   when no actionable failure cluster remains, or when either model would regress.
6. Re-evaluate the winner with `--evaluate --sample-size 30`.

Keep the candidate concise and optimized for the 360M model. Preserve exact-one-id output,
`custom` fallback behavior, and a maximum of eight rules. Do not restate or modify the scenario
catalog. Never claim an improvement that the harness did not measure.

## Apply and validate

Only if the final incumbent measurably improves on the original without regressing either model:

1. Copy its `preamble` and `rules` into `DEFAULT_SCENARIO_INSTRUCTIONS` in `src/js/slm.js`.
2. Run `npm test`.
3. Confirm the only repository file changed is `src/js/slm.js`.
4. Create one draft pull request using `create-pull-request`.

The pull request body must describe the diagnosed failure cluster, the single-step mutations tried,
accepted and rejected candidates, before/after proxy scores, sample sizes, and `npm test` result.

If no candidate qualifies, tests fail, or an unrelated file would need to change, revert repository
changes, call `noop` with the measured reason, and create no pull request or review comment.

## DO NOT

- Do NOT modify eval labels, scenario definitions, the harness, tests, or model configuration to
  manufacture a gain.
- Do NOT accept aggregate improvement when either model regresses.
- Do NOT commit `.optimizer/` files, model weights, reports, or candidates.
- Do NOT create more than one pull request, review comment, or review.
- Do NOT use a GitHub write API directly; use only the configured safe outputs.