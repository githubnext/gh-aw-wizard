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
  'add-comment': ['add-comment'],
  'add-label': ['add-labels'],
  'add-labels': ['add-labels'],
  'create-issue': ['create-issue'],
  'create-pull-request': ['create-pull-request'],
  'create-pull-request-review-comment': ['create-pull-request-review-comment'],
  'commit-files': ['create-pull-request'],
  'issues': ['add-comment', 'add-labels', 'create-issue'],
  'pull-requests': ['create-pull-request', 'add-comment', 'create-pull-request-review-comment'],
  'contents': ['create-pull-request']
};
var RECOMMENDABLE_TRIGGERS = [
  'issues',
  'pull_request',
  'schedule',
  'slash_command',
  'label_command',
  'push'
];

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
    .filter(function (profile) {
      return profile.archetype === id &&
        Array.isArray(profile.triggers) &&
        profile.triggers.every(function (trigger) { return RECOMMENDABLE_TRIGGERS.indexOf(trigger) !== -1; }) &&
        Array.isArray(profile.safe_outputs) &&
        profile.safe_outputs.length > 0 &&
        profile.safe_outputs.every(function (safeOutput) { return SAFE_OUTPUT_MAP[safeOutput]; });
    })
    .slice()
    .sort(function (a, b) {
      return (b.confidence_score || 0) - (a.confidence_score || 0) ||
        (b.total_runs || 0) - (a.total_runs || 0);
    });
  var profile = profiles[0] || null;

  var triggerCandidates = profile && Array.isArray(profile.triggers)
    ? profile.triggers.slice()
    : (archetype.recommended_triggers || []).map(function (trigger) { return trigger.type; });
  var rankedTriggers = (archetype.recommended_triggers || []).map(function (trigger) { return trigger.type; });
  var mostRelevantTrigger = rankedTriggers.find(function (trigger) {
    return triggerCandidates.indexOf(trigger) !== -1;
  }) || triggerCandidates[0];
  var triggers = mostRelevantTrigger ? [mostRelevantTrigger] : [];
  var safeOutputs = profile && Array.isArray(profile.safe_outputs)
    ? profile.safe_outputs
    : (archetype.recommended_tools || archetype.recommended_safe_outputs || []);

  return {
    triggers: triggers,
    outputs: wizardOutputs(safeOutputs),
    profile: profile
  };
}
