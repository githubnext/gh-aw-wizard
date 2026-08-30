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

* **Inner loop** — scores the current instructions on a random sample of the eval corpus using the
  exact same JavaScript prompt building and answer parsing the browser runs (`src/js/slm.js`,
  `src/js/slm-evals.js`), so a score measured locally transfers to the wizard.
* **Outer loop** — every hour, a much larger model reads the failing traces, diagnoses why the small
  model got them wrong, and proposes new instructions (reflective prompt evolution, as in GEPA).
  Proposals are re-scored on the same batch, then confirmed on a held-out sample, and only adopted
  when they beat the incumbent by more than the sampling noise.

Both models are served by [MLC-LLM](https://llm.mlc.ai/), the same stack the browser uses through
WebLLM, so the evaluation model is the identical compiled artifact visitors download. A MacBook Pro
with 64 GB of unified memory holds a 27B optimizer and the 1.5B browser model resident at once:

```bash
# inner loop: the model the wizard loads in the browser (~1.5B)
mlc_llm serve HF://mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC --port 8000

# outer loop: prompt optimizer (~27B, fits in 64 GB alongside the small model)
mlc_llm serve HF://mlc-ai/gemma-2-27b-it-q4f16_1-MLC --port 8001

npm run optimize            # hourly rounds until interrupted
npm run optimize -- --once  # a single round
```

The best instructions and the round history are written to `.optimizer/scenario-prompt.json`, which
is resumed on the next start. Copy the winning `preamble` and `rules` into
`DEFAULT_SCENARIO_INSTRUCTIONS` in `src/js/slm.js` to ship them. Any OpenAI-compatible server works
(including MLX's `mlx_lm.server`) via `--eval-url` / `--optimizer-url`; run
`node scripts/prompt-optimizer.mjs --help` for all options.

## License

MIT
