---
name: optimize-scenario-prompt
description: Use an agent CLI as the outer loop that rewrites the wizard's scenario-assistant prompt from small-model eval results.
---

# Optimize the Scenario Assistant Prompt

Use this skill when a user wants to improve the accuracy of the wizard's in-browser scenario
assistant, and an agent CLI (Copilot CLI, Codex, or similar) is available to act as the large model
in the outer loop instead of a locally served optimizer model.

You are the optimizer. `scripts/prompt-optimizer.mjs` is the measurement harness: it runs the small
model that ships in the browser and reports what it got wrong. Never claim an improvement you have
not measured.

## Prerequisites

For the most transferable score, run the same MLC artifact the browser loads
(`assistant.model.model_id` in `src/wizard.json`):

```bash
mlc_llm serve HF://mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC --port 8000
```

Any OpenAI-compatible endpoint works; pass it with `--eval-url`. Authenticated endpoints accept
`EVAL_API_KEY` or `--eval-api-key`. Prefer the environment variable so the key is not exposed in the
process list or shell history. The optimizer server is not needed in this mode — you replace it.

### oMLX on Apple Silicon

When MLC-LLM is unavailable, oMLX can run the equivalent 4-bit MLX conversion as a close local
proxy. It is not the exact browser artifact, so label measured results as oMLX/MLX proxy scores and
do not claim bit-for-bit transfer to WebLLM.

```bash
export OMLX_API_KEY='...'
./scripts/setup-omlx-models.sh
export EVAL_API_KEY="$OMLX_API_KEY"
node scripts/prompt-optimizer.mjs --evaluate --sample-size 20 \
  --eval-model Qwen2.5-1.5B-Instruct-4bit
```

The setup script starts oMLX when its CLI is available, downloads
`mlx-community/Qwen2.5-1.5B-Instruct-4bit` through the admin API, waits for completion, reloads model
discovery, and loads the model. Pass additional Hugging Face repository IDs as arguments to preload
more models. Use the `omlx` skill for API details and troubleshooting.

## Loop

Repeat until the score stops improving or the user stops you. One iteration:

1. **Measure.** Run the harness and read the report it prints:

   ```bash
   node scripts/prompt-optimizer.mjs --evaluate --sample-size 20 [--eval-model <served-id>]
   ```

   It scores the instructions currently saved in `.optimizer/scenario-prompt.json` (the shipped
   `DEFAULT_SCENARIO_INSTRUCTIONS` on the first run) and writes `.optimizer/eval-report.md` with the
   per-scenario success rates and the failing traces.

2. **Diagnose.** For each failure, state why the small model chose the wrong id: overlapping
   scenario descriptions, an instruction that invites prose instead of a bare id, a missing
   tie-break rule, or an ambiguous request that the golden label resolves arbitrarily. Group the
   failures — one root cause usually explains several rows.

3. **Rewrite.** Write a candidate to a JSON file, for example `.optimizer/candidate.json`:

   ```json
   {
     "preamble": "…one or two sentences framing the task…",
     "rules": ["…short imperative rule…", "…"]
   }
   ```

   Only the instruction lines are yours. The scenario catalog is injected between the preamble and
   the rules by the harness — do not restate, reorder, or summarize it in the candidate.

4. **Verify.** Score the candidate against the incumbent on a held-out sample:

   ```bash
   node scripts/prompt-optimizer.mjs --score .optimizer/candidate.json --validation-size 30 \
     [--eval-model <served-id>]
   ```

   The harness adopts the candidate into `.optimizer/scenario-prompt.json` only when it beats the
   incumbent by more than `--min-gain`. Add `--dry-run` to see the decision without saving. If the
   candidate is rejected, go back to step 2 with the new report rather than resubmitting a variant
   of the same idea.

## Rules for the rewrite

- The model has roughly 1.5B parameters: prefer short, concrete, unambiguous rules over long ones.
- Keep the constraint that the answer is exactly one scenario id and nothing else, and keep the
  fallback that produces `custom` when nothing fits — the wizard's parser and UI depend on both.
- Fix diagnosed failures without breaking the requests that already pass; a candidate that trades
  one scenario for another is not an improvement.
- Change one thing at a time so a regression can be attributed.
- Cap the rule list at eight entries; if a new rule is needed, replace a weaker one.

## Finishing

- Report the measured before/after success rates and the sample sizes they came from.
- Adopting a prompt in the product is a deliberate, separate step: copy the winning `preamble` and
  `rules` from `.optimizer/scenario-prompt.json` into `DEFAULT_SCENARIO_INSTRUCTIONS` in
  `src/js/slm.js`, then run `npm test`.
- `.optimizer/` is gitignored; never commit eval reports, candidates, or state files.
- If the user instead wants the loop to run unattended with a large local model, use
  `npm run optimize` (see the README) rather than this skill.
