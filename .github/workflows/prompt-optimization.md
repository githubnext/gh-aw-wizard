---
name: "Prompt Optimization"
description: Daily hill-climbing optimization of the scenario-assistant prompt using an Ollama service
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
services:
  ollama:
    image: ollama/ollama:0.33.2@sha256:020e4134285e2ef4d8fd801234176de3b4faadc992a3eb06c8e66a2f9d4c4ba2
    ports:
      - 11434:11434
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

  - name: Load and verify evaluation models
    run: |
      set -e
      for model in \
        hf.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M \
        hf.co/unsloth/SmolLM2-360M-Instruct-GGUF:Q4_K_M; do
        if ! pull_response=$(curl --fail --silent --show-error --retry 10 --retry-all-errors \
          --retry-max-time 900 http://127.0.0.1:11434/api/pull \
          --json "{\"name\":\"$model\",\"stream\":false}"); then
          echo "Failed to pull $model" >&2
          exit 1
        fi
        if ! jq --exit-status '.status == "success"' <<<"$pull_response" >/dev/null; then
          echo "Ollama did not report a successful pull for $model" >&2
          exit 1
        fi
        curl --fail --silent --show-error http://127.0.0.1:11434/api/generate \
          --json "{\"model\":\"$model\",\"prompt\":\"Reply with exactly: ready\",\"stream\":false,\"keep_alive\":\"4h\"}" >/dev/null
      done
---

# Scenario Prompt Optimization

Improve the wizard's shipped scenario-assistant instructions with measured hill climbing. The
workflow has downloaded and loaded GGUF proxies for both browser models in an OpenAI-compatible
Ollama service reachable from the agent sandbox on
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