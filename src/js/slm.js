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
  max_tokens: 24,
  analysis_attempts: 1,
  analysis_consensus: 1,
  ios_analysis_attempts: 3,
  ios_analysis_consensus: 2
};

const STOP_WORDS = [
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'for', 'from',
  'have', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'that',
  'the', 'their', 'them', 'then', 'they', 'this', 'to', 'we', 'want', 'with',
  'when', 'workflow', 'would', 'you', 'your'
];

const KEYWORD_ALIASES = {
  actions: 'ci',
  child: 'hierarchy',
  children: 'hierarchy',
  ci: 'ci',
  communities: 'community',
  complexity: 'codehealth',
  contributions: 'community',
  coverage: 'test',
  debt: 'codehealth',
  dependencies: 'dependency',
  discussions: 'community',
  docs: 'documentation',
  exploitable: 'security',
  failures: 'failure',
  flaky: 'test',
  guides: 'documentation',
  harassment: 'moderation',
  insecure: 'security',
  iterations: 'loop',
  iterative: 'loop',
  issues: 'issue',
  keyboard: 'accessibility',
  labels: 'label',
  libraries: 'dependency',
  linter: 'lint',
  malicious: 'security',
  maintainability: 'codehealth',
  memory: 'performance',
  moderation: 'moderation',
  onboarding: 'user',
  outdated: 'dependency',
  packages: 'dependency',
  parent: 'hierarchy',
  parents: 'hierarchy',
  policy: 'moderation',
  pr: 'pullrequest',
  prs: 'pullrequest',
  readme: 'documentation',
  screenreader: 'accessibility',
  reviewer: 'review',
  skills: 'skill',
  slow: 'performance',
  spam: 'moderation',
  suspicious: 'security',
  tests: 'test',
  tracking: 'hierarchy',
  upstream: 'dependency',
  users: 'user',
  vulnerabilities: 'security',
  wcag: 'accessibility',
  workflows: 'agenticworkflow'
};

const STRONG_KEYWORDS = new Set([
  'accessibility', 'agenticworkflow', 'ci', 'codehealth', 'community', 'dependency', 'documentation',
  'hierarchy', 'lint', 'loop', 'moderation', 'performance', 'security', 'skill', 'test', 'user'
]);

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
  preamble: 'You are a request classifier, not an assistant. Choose the single catalog id that best matches the request.',
  catalogHeader: 'Available scenarios (id: name — description):',
  rules: [
    'Reply with exactly one id from the catalog and nothing else.',
    'Do not answer, repeat, perform, or promise to perform the request.',
    'Use pr-review for reviewing proposed code or pull request changes, unless the request specifically concerns Copilot skills.',
    'Use security-scanner for security scans or requests about vulnerabilities, exploitable code, insecure code, or malicious code.',
    'Choose custom only when every other entry is unrelated.'
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
  const canonical = normalize(value)
    .replace(/\bpull requests?\b/g, 'pullrequest')
    .replace(/\bproposed code changes?\b/g, 'pullrequest')
    .replace(/\bgithub actions?\b|\bcontinuous integration\b/g, 'ci')
    .replace(/\bcode health\b|\btechnical debt\b/g, 'codehealth')
    .replace(/\bscreen readers?\b/g, 'screenreader')
    .replace(/\bsub issues?\b/g, 'hierarchy')
    .replace(/\bagentic workflows?\b|\bworkflow markdown\b/g, 'agenticworkflow');
  return canonical.split(' ')
    .map((word) => KEYWORD_ALIASES[word] || word)
    .filter((word) => word && STOP_WORDS.indexOf(word) === -1);
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
      const paddedAnswer = ` ${answer} `;
      const index = paddedAnswer.indexOf(` ${id} `);
      const labelIndex = label ? paddedAnswer.indexOf(` ${label} `) : -1;
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
function keywordScenarioRanks(request, scenarios) {
  const requestWords = words(request);
  if (!requestWords.length || !Array.isArray(scenarios)) return [];
  return scenarios
    .filter((scenario) => scenario.id !== 'custom')
    .map((scenario) => {
      const coreWords = new Set(words(`${scenario.id} ${scenario.label}`));
      const descriptionWords = new Set(words(scenario.description));
      const score = requestWords.reduce((total, word) => {
        if (coreWords.has(word)) return total + (STRONG_KEYWORDS.has(word) ? 4 : 2);
        if (descriptionWords.has(word)) return total + (STRONG_KEYWORDS.has(word) ? 2 : 1);
        return total;
      }, 0);
      return { id: scenario.id, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function keywordScenarioMatch(request, scenarios) {
  const [best] = keywordScenarioRanks(request, scenarios);
  return best ? best.id : null;
}

export function selectScenario(modelAnswer, request, scenarios) {
  const parsed = parseScenarioSelection(modelAnswer, scenarios);
  const ranks = keywordScenarioRanks(request, scenarios);
  const best = ranks[0];
  if (!parsed) return best ? best.id : null;
  if (!best || best.id === parsed) return parsed;

  const parsedRank = ranks.find((rank) => rank.id === parsed);
  const parsedScore = parsedRank ? parsedRank.score : 0;
  const confidentCorrection = best.score >= 4 && best.score >= parsedScore + 2;
  return (parsed === 'custom' || confidentCorrection) && best.score >= 4 ? best.id : parsed;
}

export function scenarioAttemptTemperature(index) {
  return Math.round(Math.min(Math.max(Number(index) || 0, 0) * 0.2, 0.8) * 10) / 10;
}

export function scenarioAttemptWinner(attempts, requiredVotes) {
  const results = Array.isArray(attempts) ? attempts : [];
  const majority = Math.floor(results.length / 2) + 1;
  const required = Math.min(Math.max(Math.floor(requiredVotes || majority), 1), results.length || 1);
  const counts = new Map();
  results.forEach((result) => {
    if (!result || !result.scenario) return;
    counts.set(result.scenario, (counts.get(result.scenario) || 0) + 1);
  });
  const winner = [...counts].find(([, count]) => count >= required);
  return winner ? results.find((result) => result && result.scenario === winner[0]) : null;
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
