// Pure logic for the in-browser scenario assistant.
//
// A small language model (SLM) runs locally in the browser and is asked to pick
// the wizard scenario that best matches a free-form request. Everything in this
// module is side-effect free so it can be unit tested without a browser.

// The runtime is served from the site itself (see `scripts/fetch-vendor-assets.mjs`
// and the `vendorPlugin` in `vite.config.js`) rather than from a CDN, so it
// stays reachable on networks that block third-party asset hosts.
export const DEFAULT_SLM_CONFIG = {
  enabled: true,
  module_url: 'slm/webllm.js',
  model_id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  // This WebLLM prebuilt is explicitly marked for low-resource devices and
  // avoids the shader-f16 feature that is not available on every iPhone.
  ios_model_id: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
  cache_backend: 'cache',
  max_tokens: 24
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

// iOS can run the assistant, but only the smaller model fits comfortably within
// its WebGPU memory limits, so it is swapped in based on the runtime platform.
export function modelIdFor(config, navigatorImpl) {
  const settings = config || {};
  if (isIOS(navigatorImpl) && settings.ios_model_id) return settings.ios_model_id;
  return settings.model_id;
}

// iPadOS reports as "Macintosh" in the user agent, so touch support on an
// otherwise Mac-looking platform is the only reliable signal.
export function isIOS(navigatorImpl) {
  const nav = navigatorImpl || (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav) return false;
  const userAgent = typeof nav.userAgent === 'string' ? nav.userAgent : '';
  if (/iphone|ipad|ipod/i.test(userAgent)) return true;
  const platform = typeof nav.platform === 'string' ? nav.platform : '';
  return platform === 'MacIntel' && typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 1;
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
  return { module: resolveRuntimeUrl(settings.module_url, opts.baseUrl) };
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

// The instruction lines wrapped around the scenario catalog. Exported so the
// offline prompt optimizer (scripts/prompt-optimizer.mjs) can evaluate
// alternative wordings against the exact prompt the wizard ships.
export const DEFAULT_SCENARIO_INSTRUCTIONS = {
  preamble: 'You match a user request to one automation scenario for GitHub Agentic Workflows.',
  catalogHeader: 'Available scenarios (id: name — description):',
  rules: [
    'Answer with exactly one scenario id from the list above and nothing else.',
    'If nothing fits, answer with: custom'
  ]
};

// Chat messages handed to the SLM. The system message carries the UI
// information (the scenario cards the wizard renders) and constrains the model
// to answering with a single scenario id.
export function buildScenarioMessages(scenarios, request, instructions) {
  const settings = { ...DEFAULT_SCENARIO_INSTRUCTIONS, ...(instructions || {}) };
  const rules = Array.isArray(settings.rules) ? settings.rules : DEFAULT_SCENARIO_INSTRUCTIONS.rules;
  const system = [
    settings.preamble,
    settings.catalogHeader,
    scenarioCatalogText(scenarios),
    ...rules
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

// WebLLM reports a normalized overall ratio while it downloads and prepares the
// selected prebuilt model.
export function progressTracker() {
  let current = 0;
  return {
    update(event) {
      if (event && typeof event.progress === 'number') {
        const ratio = Math.min(Math.max(event.progress, 0), 1);
        current = Math.round(ratio * 100);
      }
      return this.percent();
    },
    percent() {
      return current;
    }
  };
}

export function progressLabel(event, percent) {
  if (percent >= 100) return 'Model ready';
  if (event && typeof event.text === 'string' && event.text.trim()) return event.text.trim();
  return `Downloading model — ${percent}%`;
}
