// Pattern library loading and lookup helpers.

export var PATTERNS_URL = 'patterns.json';

export function loadPatterns(url) {
  return fetch(url || PATTERNS_URL)
    .then(function (r) { return r.json(); })
    .catch(function () {
      // patterns unavailable — generator still works with defaults
      return null;
    });
}

export function getArchetype(patterns, id) {
  if (!patterns || !patterns.archetypes) return null;
  for (var i = 0; i < patterns.archetypes.length; i++) {
    if (patterns.archetypes[i].id === id) return patterns.archetypes[i];
  }
  return null;
}
