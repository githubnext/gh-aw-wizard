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

var SAFE_OUTPUT_MAP = {
  'add-comment': ['comments'],
  'add-label': ['labels'],
  'add-labels': ['labels'],
  'create-issue': ['new-issues'],
  'create-pull-request': ['pull-requests'],
  'commit-files': ['commits'],
  'issues': ['comments', 'labels', 'new-issues'],
  'pull-requests': ['pull-requests', 'comments'],
  'contents': ['commits']
};

function wizardOutputs(safeOutputs) {
  var outputs = [];
  (safeOutputs || []).forEach(function (safeOutput) {
    (SAFE_OUTPUT_MAP[safeOutput] || []).forEach(function (output) {
      if (outputs.indexOf(output) === -1) outputs.push(output);
    });
  });
  return outputs;
}

export function getRecommendedConfiguration(patterns, id) {
  var archetype = getArchetype(patterns, id);
  if (!archetype) return { triggers: [], outputs: [], profile: null };

  var profiles = (patterns.configuration_profiles || [])
    .filter(function (profile) { return profile.archetype === id; })
    .slice()
    .sort(function (a, b) {
      return (b.confidence_score || 0) - (a.confidence_score || 0) ||
        (b.total_runs || 0) - (a.total_runs || 0);
    });
  var profile = profiles[0] || null;

  var triggers = profile && Array.isArray(profile.triggers)
    ? profile.triggers.slice()
    : (archetype.recommended_triggers || []).map(function (trigger) { return trigger.type; });
  var safeOutputs = profile && Array.isArray(profile.safe_outputs)
    ? profile.safe_outputs
    : (archetype.recommended_tools || archetype.recommended_safe_outputs || []);

  return {
    triggers: triggers,
    outputs: wizardOutputs(safeOutputs),
    profile: profile
  };
}
