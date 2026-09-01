// Definition-based engine discovery from gh-aw.

export const ENGINES_URL = 'https://raw.githubusercontent.com/github/gh-aw/main/.github/aw/engines.json';

const ENGINE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const FEATURED_ENGINE_IDS = ['codex', 'claude', 'copilot', 'pi'];
const builtInEngineIds = new Set(['copilot', 'claude', 'codex', 'gemini', 'pi']);
const definitionEngineIds = new Set();
const builtInEngineCompanies = {
  copilot: 'GitHub',
  claude: 'Anthropic',
  codex: 'OpenAI',
  gemini: 'Google',
  pi: 'Inflection'
};
const engineIconSymbols = {
  copilot: 'vendor-github',
  claude: 'vendor-anthropic',
  codex: 'vendor-openai',
  gemini: 'vendor-google',
  pi: 'vendor-pi'
};
const extensionLogoText = {
  aider: 'AI',
  crush: 'CR',
  cursor: 'CU',
  'deepseek-harness': 'DS',
  // gh-aw publishes a "custom" extension backed by GenAIScript.
  custom: 'CT',
  goose: 'GO',
  kiro: 'KI',
  'pydantic-ai': 'PY',
  opencode: 'OC'
};

export function formatEngineLabel(engine) {
  engine = engine || 'extension';
  return engine.split('-').map((part) => {
    if (part === 'ai') return 'AI';
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}

export function formatEngineOptionLabel(engine) {
  const company = builtInEngineCompanies[engine];
  return formatEngineLabel(engine) + (company ? ` (${  company  })` : ' (Extension)');
}

export function engineIconMarkup(engine) {
  const symbol = engineIconSymbols[engine];
  if (symbol) {
    return `<span class="engine-vendor-icon" aria-hidden="true"><svg class="vendor-icon" focusable="false"><use href="#${  symbol  }"></use></svg></span>`;
  }
  const mark = extensionLogoText[engine] || fallbackEngineLogoText(engine);
  return `<span class="engine-vendor-icon engine-logo-mark" aria-hidden="true">${  mark  }</span>`;
}

function fallbackEngineLogoText(engine) {
  const labelParts = formatEngineLabel(engine).split(/\s+/).filter(Boolean);
  if (labelParts.length === 1) {
    const singleWordMark = labelParts[0].slice(0, 2).toUpperCase();
    return singleWordMark.length === 1 ? singleWordMark + singleWordMark : singleWordMark;
  }
  return labelParts.slice(0, 2).map((part) => {
    return part.charAt(0);
  }).join('').toUpperCase();
}

export function parseDefinitionEngines(data) {
  if (!data || !Array.isArray(data.engines)) return [];

  const seen = new Set();
  return data.engines.filter((engine) => {
    if (!engine || typeof engine.id !== 'string' || typeof engine.import !== 'string') return false;
    if (!ENGINE_ID_PATTERN.test(engine.id) || seen.has(engine.id)) return false;
    seen.add(engine.id);
    return true;
  });
}

export function registerDefinitionEngines(engines) {
  definitionEngineIds.clear();
  engines.forEach((engine) => {
    if (engine && ENGINE_ID_PATTERN.test(engine.id)) definitionEngineIds.add(engine.id);
  });
}

export function registerBuiltInEngines(engines) {
  builtInEngineIds.clear();
  engines.forEach((engine) => {
    if (engine && ENGINE_ID_PATTERN.test(engine.id)) builtInEngineIds.add(engine.id);
  });
}

export function isKnownEngine(engine) {
  return builtInEngineIds.has(engine) || definitionEngineIds.has(engine);
}

export function loadDefinitionEngines(fetchImpl, url) {
  fetchImpl = fetchImpl || fetch;
  return fetchImpl(url || ENGINES_URL).then((response) => {
    if (!response.ok) throw new Error('Unable to load gh-aw engines');
    return response.json();
  }).then(parseDefinitionEngines).catch(() => {
    return [];
  });
}
