// Pure logic for the in-browser scenario assistant.
//
// A small language model (SLM) runs locally in the browser and is asked to pick
// the wizard scenario that best matches a free-form request. Everything in this
// module is side-effect free so it can be unit tested without a browser.

// The runtime is served from the site itself (see `scripts/fetch-slm-runtime.mjs`
// and the `slmRuntimePlugin` in `vite.config.js`) rather than from a CDN, so it
// stays reachable on networks that block third-party script hosts.
export const DEFAULT_SLM_CONFIG = {
  enabled: true,
  module_url: 'slm/transformers.min.js',
  wasm_paths: {
    mjs: 'slm/ort/ort-wasm-simd-threaded.asyncify.mjs',
    wasm: 'slm/ort/ort-wasm-simd-threaded.asyncify.wasm'
  },
  // Safari runs the non-asyncify build of onnxruntime-web.
  safari_wasm_paths: {
    mjs: 'slm/ort/ort-wasm-simd-threaded.mjs',
    wasm: 'slm/ort/ort-wasm-simd-threaded.wasm'
  },
  model_id: 'onnx-community/Qwen2.5-0.5B-Instruct',
  webgpu_dtype: 'q4f16',
  wasm_dtype: 'q4',
  max_new_tokens: 24
};

const STOP_WORDS = [
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'for', 'from',
  'have', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'that',
  'the', 'their', 'them', 'then', 'they', 'this', 'to', 'we', 'want', 'with',
  'when', 'workflow', 'would', 'you', 'your'
];

export function slmConfig(wizardConfig) {
  const configured = wizardConfig && wizardConfig.assistant && wizardConfig.assistant.model
    ? wizardConfig.assistant.model
    : {};
  return { ...DEFAULT_SLM_CONFIG, ...configured };
}

export function isSafari(navigatorImpl) {
  const nav = navigatorImpl || (typeof navigator !== 'undefined' ? navigator : null);
  const userAgent = nav && typeof nav.userAgent === 'string' ? nav.userAgent : '';
  return /safari/i.test(userAgent) && !/chrome|chromium|android/i.test(userAgent);
}

// Runtime assets are configured as site-relative paths so a wizard hosted under
// a sub-path (such as GitHub Pages project sites) resolves them correctly.
export function resolveRuntimeUrl(url, baseUrl) {
  if (!url) return url;
  const base = baseUrl
    || (globalThis.document && globalThis.document.baseURI)
    || (globalThis.location && globalThis.location.href);
  if (!base) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

export function runtimeUrls(config, options) {
  const opts = options || {};
  const settings = config || {};
  const paths = (isSafari(opts.navigator) ? settings.safari_wasm_paths : settings.wasm_paths) || {};
  const wasmPaths = paths.mjs && paths.wasm
    ? {
      mjs: resolveRuntimeUrl(paths.mjs, opts.baseUrl),
      wasm: resolveRuntimeUrl(paths.wasm, opts.baseUrl)
    }
    : null;
  return { module: resolveRuntimeUrl(settings.module_url, opts.baseUrl), wasmPaths };
}

// The scenarios the model may choose from, derived from what the wizard shows
// in the "What" step so the prompt always mirrors the current UI.
export function scenarioCatalog(patterns, extraScenarios) {
  const archetypes = patterns && Array.isArray(patterns.archetypes) ? patterns.archetypes : [];
  const extras = Array.isArray(extraScenarios) ? extraScenarios : [];
  const seen = new Set();
  return archetypes.concat(extras).reduce((scenarios, archetype) => {
    if (!archetype || typeof archetype.id !== 'string' || seen.has(archetype.id)) return scenarios;
    seen.add(archetype.id);
    scenarios.push({
      id: archetype.id,
      label: typeof archetype.label === 'string' ? archetype.label : archetype.id,
      description: typeof archetype.description === 'string' ? archetype.description : ''
    });
    return scenarios;
  }, []);
}

export function scenarioCatalogText(scenarios) {
  return scenarios.map((scenario) => {
    const description = scenario.description ? ` — ${scenario.description}` : '';
    return `- ${scenario.id}: ${scenario.label}${description}`;
  }).join('\n');
}

// Chat messages handed to the SLM. The system message carries the UI
// information (the scenario cards the wizard renders) and constrains the model
// to answering with a single scenario id.
export function buildScenarioMessages(scenarios, request) {
  const system = [
    'You match a user request to one automation scenario for GitHub Agentic Workflows.',
    'Available scenarios (id: name — description):',
    scenarioCatalogText(scenarios),
    'Answer with exactly one scenario id from the list above and nothing else.',
    'If nothing fits, answer with: custom'
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: String(request || '').trim() }
  ];
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function words(value) {
  return normalize(value).split(' ').filter((word) => word && STOP_WORDS.indexOf(word) === -1);
}

// Pull a known scenario id out of whatever the model produced. Small models are
// chatty, so accept ids or labels appearing anywhere in the answer.
export function parseScenarioSelection(text, scenarios) {
  const answer = normalize(text);
  if (!answer || !Array.isArray(scenarios) || !scenarios.length) return null;

  const byId = scenarios.find((scenario) => normalize(scenario.id) === answer);
  if (byId) return byId.id;
  const byLabel = scenarios.find((scenario) => normalize(scenario.label) === answer);
  if (byLabel) return byLabel.id;

  const contained = scenarios
    .map((scenario) => {
      const id = normalize(scenario.id);
      const label = normalize(scenario.label);
      const index = answer.indexOf(id);
      const labelIndex = label ? answer.indexOf(label) : -1;
      const position = index === -1 ? labelIndex : index;
      const length = index === -1 ? label.length : id.length;
      return { id: scenario.id, position, length };
    })
    .filter((match) => match.position !== -1)
    .sort((a, b) => a.position - b.position || b.length - a.length);
  return contained.length ? contained[0].id : null;
}

// Deterministic fallback used when the model is unavailable or its answer does
// not name a known scenario.
export function keywordScenarioMatch(request, scenarios) {
  const requestWords = words(request);
  if (!requestWords.length || !Array.isArray(scenarios) || !scenarios.length) return null;
  let best = null;
  scenarios.forEach((scenario) => {
    if (scenario.id === 'custom') return;
    const scenarioWords = words(`${scenario.label} ${scenario.description}`);
    const score = scenarioWords.reduce((total, word) => {
      return total + (requestWords.indexOf(word) === -1 ? 0 : 1);
    }, 0);
    if (score > 0 && (!best || score > best.score)) best = { id: scenario.id, score };
  });
  return best ? best.id : null;
}

export function selectScenario(modelAnswer, request, scenarios) {
  return parseScenarioSelection(modelAnswer, scenarios)
    || keywordScenarioMatch(request, scenarios)
    || null;
}

export function scenarioLabel(scenarios, id) {
  const scenario = (scenarios || []).find((candidate) => candidate.id === id);
  return scenario ? scenario.label : id;
}

// ── Loading progress ───────────────────────────────────────────────────────

// transformers.js reports one event per model file. Keep a per-file ratio so the
// overall percentage is stable while several files download in parallel.
export function progressTracker() {
  const files = new Map();
  return {
    update(event) {
      const status = event && event.status;
      const file = event && (event.file || event.name) ? String(event.file || event.name) : 'model';
      if (status === 'progress' || status === 'download' || status === 'initiate') {
        const ratio = typeof event.progress === 'number'
          ? Math.min(Math.max(event.progress / 100, 0), 1)
          : 0;
        files.set(file, ratio);
      } else if (status === 'done') {
        files.set(file, 1);
      }
      return this.percent();
    },
    percent() {
      if (!files.size) return 0;
      let total = 0;
      files.forEach((ratio) => { total += ratio; });
      return Math.round((total / files.size) * 100);
    }
  };
}

export function progressLabel(event, percent) {
  const status = event && event.status ? event.status : '';
  if (status === 'ready') return 'Model ready';
  if (status === 'done') return 'Preparing model';
  const file = event && event.file ? ` ${event.file}` : '';
  return `Downloading model${file} — ${percent}%`;
}
