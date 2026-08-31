# gh-aw-wizard

🔗 **[Try it live →](https://githubnext.github.io/gh-aw-wizard)**

A wizard interface to create GitHub Agentic Workflows. Create ready-to-use [GitHub Agentic Workflows](https://github.github.com/gh-aw/) in minutes — just answer a few questions and get a workflow file you can drop into your repo.

## Customize the wizard

The dashboard is rendered at runtime from [`src/wizard.json`](src/wizard.json). The file defines the
landing-page text, footer labels and URLs, archetype ordering, trigger/output/extra/engine cards,
summary text, recommendation mappings, and the URLs of the pattern library and engine catalog.

To host a customized wizard in another repository:

1. Run `npm run build` and publish the contents of `dist/`.
2. Edit the published `wizard.json` without rebuilding the JavaScript bundle.
3. Point `patterns_url` at a compatible pattern manifest. Relative URLs are resolved from the
   location of `wizard.json`, so the configuration and its pattern library can be hosted together.
   The `recommendations.safe_outputs` map retains singular and plural aliases where upstream pattern
   libraries use both forms (for example, `add-label` and `add-labels`).

The default page reads the configuration URL from:

```html
<meta name="gh-aw-wizard-config" content="wizard.json">
```

An embedding application can instead call `initWizard({ configUrl })`. Cross-origin configuration,
pattern, and engine endpoints must allow the embedding origin with CORS headers. Option IDs should
match definitions in the configured pattern library's `workflow-generation.json`.

The site loads its third-party browser assets — Primer CSS and the WebLLM scenario assistant
runtime — from the published site rather than a CDN, so a customized deployment must publish
`dist/primer/` and `dist/slm/` alongside the rest of the site. WebLLM downloads and caches the
selected model from its prebuilt model catalog on first use.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

`npm run dev` and `npm run build` download the vendored browser assets into the gitignored
`vendor/` directory; `npm run vendor` refreshes them.

## Prompt optimization (local, Apple Silicon)

`scripts/prompt-optimizer.mjs` tunes the system prompt behind the in-browser scenario assistant on a
MacBook Pro, without changing anything the site ships until a better prompt is proven.

* **Inner loop** — concurrently scores the current instructions with the desktop and iOS models on
  the same random sample using the exact JavaScript prompt building and answer parsing the browser
  runs (`src/js/slm.js`, `src/js/slm-evals.js`).
* **Outer loop** — every hour, a much larger model reads the failing traces, diagnoses why the small
  model got them wrong, and proposes new instructions (reflective prompt evolution, as in GEPA).
  Proposals are re-scored on the same batch, then confirmed on a held-out sample, and only adopted
  when they beat the incumbent by more than the sampling noise without regressing either model.

The models are served by [MLC-LLM](https://llm.mlc.ai/), the same stack the browser uses through
WebLLM, so the evaluation models are the identical compiled artifacts visitors download:

```bash
# inner loop: the model the wizard loads in the browser (~1.5B)
mlc_llm serve HF://mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC --port 8000

# iOS inner loop: the low-memory model loaded on iPhone and iPad (~360M)
mlc_llm serve HF://mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC --port 8002

# outer loop: prompt optimizer (~27B, fits in 64 GB alongside the small model)
mlc_llm serve HF://mlc-ai/gemma-2-27b-it-q4f16_1-MLC --port 8001

npm run optimize -- --all-models --ios-eval-url http://127.0.0.1:8002/v1
```

### Using an agent CLI as the outer loop

An agent CLI (Copilot CLI, Codex, …) can replace the local optimizer model. Only the eval server is
needed, and the harness exposes the two single-shot modes the agent drives:

```bash
node scripts/prompt-optimizer.mjs --evaluate --all-models --sample-size 20 \
  --ios-eval-url http://127.0.0.1:8002/v1
node scripts/prompt-optimizer.mjs --score .optimizer/candidate.json --all-models \
  --ios-eval-url http://127.0.0.1:8002/v1
```

`--evaluate` writes `.optimizer/eval-report.md` with aggregate, per-model, and per-scenario scores
plus target-labelled failing traces. The agent diagnoses them, writes a `{ "preamble", "rules" }`
candidate, and `--score` confirms it on a held-out sample. A candidate must improve the aggregate
score without regressing either model. The
[`optimize-scenario-prompt` skill](.github/skills/optimize-scenario-prompt/SKILL.md) contains the
instructions for that agent.

The best instructions and the round history are written to `.optimizer/scenario-prompt.json`, which
is resumed on the next start. Copy the winning `preamble` and `rules` into
`DEFAULT_SCENARIO_INSTRUCTIONS` in `src/js/slm.js` to ship them. Any OpenAI-compatible server works
(including MLX's `mlx_lm.server`) via `--eval-url` / `--ios-eval-url` / `--optimizer-url`; run
`node scripts/prompt-optimizer.mjs --help` for all options. For authenticated endpoints, set
`EVAL_API_KEY`, `IOS_EVAL_API_KEY`, and/or `OPTIMIZER_API_KEY`; matching CLI flags are also
available.

For an oMLX-backed Apple Silicon machine, preload the equivalent 4-bit MLX eval model through the
authenticated oMLX APIs:

```bash
export OMLX_API_KEY='...'
./scripts/setup-omlx-models.sh \
  mlx-community/Qwen2.5-1.5B-Instruct-4bit \
  Irfanuruchi/SmolLM2-360M-Instruct-MLX-4bit
export EVAL_API_KEY="$OMLX_API_KEY"
node scripts/prompt-optimizer.mjs --evaluate --all-models --sample-size 20 \
  --eval-model Qwen2.5-1.5B-Instruct-4bit \
  --ios-eval-model SmolLM2-360M-Instruct-MLX-4bit
```

These MLX conversions are close proxies for local iteration, not the exact MLC artifacts used by
WebLLM.

## License

MIT
