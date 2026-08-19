// Definition-based engine discovery from gh-aw.

export var ENGINES_URL = 'https://raw.githubusercontent.com/github/gh-aw/main/.github/aw/engines.json';

var ENGINE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
var builtInEngineIds = new Set(['copilot', 'claude', 'codex', 'gemini', 'pi']);
var definitionEngineIds = new Set();

export function formatEngineLabel(engine) {
  return engine.split('-').map(function (part) {
    if (part === 'ai') return 'AI';
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}

export function parseDefinitionEngines(data) {
  if (!data || !Array.isArray(data.engines)) return [];

  var seen = new Set();
  return data.engines.filter(function (engine) {
    if (!engine || typeof engine.id !== 'string' || typeof engine.import !== 'string') return false;
    if (!ENGINE_ID_PATTERN.test(engine.id) || seen.has(engine.id)) return false;
    seen.add(engine.id);
    return true;
  });
}

export function registerDefinitionEngines(engines) {
  definitionEngineIds.clear();
  engines.forEach(function (engine) {
    if (engine && ENGINE_ID_PATTERN.test(engine.id)) definitionEngineIds.add(engine.id);
  });
}

export function isKnownEngine(engine) {
  return builtInEngineIds.has(engine) || definitionEngineIds.has(engine);
}

export function loadDefinitionEngines(fetchImpl) {
  fetchImpl = fetchImpl || fetch;
  return fetchImpl(ENGINES_URL).then(function (response) {
    if (!response.ok) throw new Error('Unable to load gh-aw engines');
    return response.json();
  }).then(parseDefinitionEngines).catch(function () {
    return [];
  });
}
