// Pattern library loading and lookup helpers.
//
// The pattern library is split into one file per archetype so it can be
// versioned and reviewed independently: `patterns/manifest.json` lists the
// archetype ids plus every other field, and `patterns/archetypes/<id>.json`
// holds each archetype's data.

export const PATTERNS_MANIFEST_URL = 'patterns/manifest.json';

// Combine a manifest (with an `archetypes` array of ids) and the loaded
// archetype objects back into the shape the rest of the app expects.
export function mergePatterns(manifest, archetypes, workflowGeneration) {
  const merged = {};
  for (const key in manifest) {
    if (Object.prototype.hasOwnProperty.call(manifest, key)) merged[key] = manifest[key];
  }
  merged.archetypes = archetypes;
  merged.workflow_generation = workflowGeneration || null;
  return merged;
}

function patternsBaseUrlFor(manifestUrl) {
  const lastSlash = manifestUrl.lastIndexOf('/');
  return lastSlash === -1 ? '' : manifestUrl.slice(0, lastSlash + 1);
}

function archetypesBaseUrlFor(manifestUrl) {
  return `${patternsBaseUrlFor(manifestUrl)  }archetypes/`;
}

export function loadPatterns(manifestUrl) {
  const resolvedManifestUrl = manifestUrl || PATTERNS_MANIFEST_URL;
  const archetypesBaseUrl = archetypesBaseUrlFor(resolvedManifestUrl);
  return fetch(resolvedManifestUrl)
    .then((r) => { return r.json(); })
    .then((manifest) => {
      const ids = Array.isArray(manifest.archetypes) ? manifest.archetypes : [];
      const workflowGenerationUrl = manifest.workflow_generation
        ? patternsBaseUrlFor(resolvedManifestUrl) + manifest.workflow_generation
        : null;
      const archetypesPromise = Promise.all(ids.map((id) => {
        return fetch(`${archetypesBaseUrl + id  }.json`).then((r) => { return r.json(); });
      }));
      const workflowGenerationPromise = workflowGenerationUrl
        ? fetch(workflowGenerationUrl).then((r) => { return r.json(); })
        : Promise.resolve(null);
      return Promise.all([archetypesPromise, workflowGenerationPromise]).then(([archetypes, workflowGeneration]) => {
        return mergePatterns(manifest, archetypes, workflowGeneration);
      });
    })
    .catch(() => {
      // patterns unavailable — generator still works with defaults
      return null;
    });
}

export function getWorkflowGeneration(patterns) {
  return patterns && patterns.workflow_generation ? patterns.workflow_generation : null;
}

export function getWorkflowDefinition(patterns, id) {
  const generation = getWorkflowGeneration(patterns);
  return generation && generation.archetypes ? generation.archetypes[id] || null : null;
}

export function getArchetype(patterns, id) {
  if (!patterns || !patterns.archetypes) return null;
  for (let i = 0; i < patterns.archetypes.length; i++) {
    if (patterns.archetypes[i].id === id) return patterns.archetypes[i];
  }
  return null;
}

function wizardOutputs(safeOutputs, safeOutputMap) {
  const outputs = [];
  (safeOutputs || []).forEach((safeOutput) => {
    (safeOutputMap[safeOutput] || []).forEach((output) => {
      if (outputs.indexOf(output) === -1) outputs.push(output);
    });
  });
  return outputs;
}

export function getRecommendedConfiguration(patterns, id, wizardConfig) {
  const archetype = getArchetype(patterns, id);
  if (!archetype) return { triggers: [], outputs: [], profile: null };
  const recommendations = wizardConfig && wizardConfig.recommendations
    ? wizardConfig.recommendations
    : {};
  const recommendableTriggers = Array.isArray(recommendations.triggers)
    ? recommendations.triggers
    : [];
  const safeOutputMap = recommendations.safe_outputs || {};

  const profiles = (patterns.configuration_profiles || [])
    .filter((profile) => {
      return profile.archetype === id &&
        Array.isArray(profile.triggers) &&
        profile.triggers.every((trigger) => { return recommendableTriggers.indexOf(trigger) !== -1; }) &&
        Array.isArray(profile.safe_outputs) &&
        profile.safe_outputs.length > 0 &&
        profile.safe_outputs.every((safeOutput) => { return safeOutputMap[safeOutput]; });
    })
    .slice()
    .sort((a, b) => {
      return (b.confidence_score || 0) - (a.confidence_score || 0) ||
        (b.total_runs || 0) - (a.total_runs || 0);
    });
  const profile = profiles[0] || null;

  const triggerCandidates = profile && Array.isArray(profile.triggers)
    ? profile.triggers.slice()
    : (archetype.recommended_triggers || []).map((trigger) => { return trigger.type; });
  const rankedTriggers = (archetype.recommended_triggers || []).map((trigger) => { return trigger.type; });
  const mostRelevantTrigger = rankedTriggers.find((trigger) => {
    return triggerCandidates.indexOf(trigger) !== -1;
  }) || triggerCandidates[0];
  const triggers = mostRelevantTrigger ? [mostRelevantTrigger] : [];
  const safeOutputs = profile && Array.isArray(profile.safe_outputs)
    ? profile.safe_outputs
    : (archetype.recommended_tools || archetype.recommended_safe_outputs || []);

  return {
    triggers,
    outputs: wizardOutputs(safeOutputs, safeOutputMap),
    profile
  };
}
