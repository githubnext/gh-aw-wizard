// Pure logic for the offline scenario-prompt optimizer.
//
// `scripts/prompt-optimizer.mjs` runs an evaluation loop on a MacBook Pro
// against local MLC-LLM servers: the inner loop scores the wizard prompt with
// the same small model the browser runs (WebLLM and MLC-LLM share the same
// compiled model artifacts), and an hourly outer loop asks a much larger model
// to rewrite the instructions from the failures it just observed.
//
// The rewrite strategy is reflective prompt evolution (GEPA): sample a batch,
// keep the traces of what the small model actually answered, let the large
// model diagnose the failures in natural language, and only adopt a proposal
// that measurably beats the incumbent on a held-out sample.
//
// Everything here is side-effect free so it can be unit tested without a model.

import { DEFAULT_SCENARIO_INSTRUCTIONS } from './slm.js';

// Both models are served by MLC-LLM (`mlc_llm serve`), which exposes an
// OpenAI-compatible API. The eval model id is the same MLC prebuilt the wizard
// loads through WebLLM, so scores transfer to the browser. A MacBook Pro with
// 64 GB of unified memory holds the 27B optimizer and the 1.5B eval model at
// the same time, so the two servers can stay resident between rounds.
export const DEFAULT_OPTIMIZER_CONFIG = {
  evalBaseUrl: 'http://127.0.0.1:8000/v1',
  evalModel: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  evalMaxTokens: 24,
  optimizerBaseUrl: 'http://127.0.0.1:8001/v1',
  optimizerModel: 'gemma-2-27b-it-q4f16_1-MLC',
  optimizerMaxTokens: 900,
  optimizerTemperature: 0.7,
  intervalMs: 60 * 60 * 1000,
  sampleSize: 12,
  validationSize: 20,
  repetitions: 1,
  candidates: 3,
  minGain: 0.01,
  failureExamples: 8,
  rounds: 0
};

export const MAX_PROPOSED_RULES = 8;

export function instructionsText(instructions) {
  const settings = { ...DEFAULT_SCENARIO_INSTRUCTIONS, ...(instructions || {}) };
  const rules = Array.isArray(settings.rules) ? settings.rules : [];
  return [settings.preamble, ...rules].join('\n');
}

// Compact traces of what the small model got wrong, which is the only signal
// the optimizer model receives about the eval model's behaviour.
export function formatFailures(rows, limit) {
  const failures = (rows || []).filter((row) => row && !row.correct);
  const max = typeof limit === 'number' && limit > 0 ? limit : DEFAULT_OPTIMIZER_CONFIG.failureExamples;
  return failures.slice(0, max).map((row) => {
    const answer = row.errored ? '<request failed>' : JSON.stringify(row.answer || '');
    return [
      ...(row.evalTarget ? [`target: ${row.evalTarget}`] : []),
      `request: ${row.query}`,
      `expected: ${row.golden}`,
      `model answered: ${answer}`,
      `parsed as: ${row.scenario || 'none'}`
    ].join('\n');
  }).join('\n\n');
}

// Markdown report of one inner-loop evaluation. This is what an external agent
// CLI (Copilot CLI, Codex, …) reads when it plays the role of the outer loop
// instead of a locally served optimizer model.
export function formatEvalReport(options) {
  const opts = options || {};
  const instructions = { ...DEFAULT_SCENARIO_INSTRUCTIONS, ...(opts.instructions || {}) };
  const rules = Array.isArray(instructions.rules) ? instructions.rules : [];
  const evaluation = opts.evaluation || {};
  const perScenario = (evaluation.rows || [])
    .slice()
    .sort((a, b) => a.successRate - b.successRate || a.scenario.localeCompare(b.scenario))
    .map((row) => `| ${row.scenario} | ${row.successes}/${row.attempts} | ${formatPercent(row.successRate)} |`);
  const failures = formatFailures(evaluation.traces, opts.failureExamples);
  const targetScores = (evaluation.targets || []).map((target) => {
    return `| ${target.name} | ${target.model} | ${target.successes}/${target.attempts} | ${formatPercent(target.successRate)} |`;
  });

  return [
    '# Scenario prompt evaluation',
    '',
    `- eval model: ${opts.evalModel || 'unknown'}`,
    `- success rate: ${formatPercent(evaluation.successRate)} (${evaluation.successes || 0}/${evaluation.attempts || 0})`,
    `- errored requests: ${evaluation.errors || 0}`,
    ...(targetScores.length ? [
      '',
      '## Score by model target',
      '',
      '| target | model | correct | rate |',
      '| --- | --- | --- | --- |',
      ...targetScores
    ] : []),
    '',
    '## Current instructions',
    '',
    '```json',
    JSON.stringify({ preamble: instructions.preamble, rules }, null, 2),
    '```',
    '',
    '## Success rate by expected scenario',
    '',
    '| scenario | correct | rate |',
    '| --- | --- | --- |',
    ...(perScenario.length ? perScenario : ['| (none) | 0/0 | 0% |']),
    '',
    '## Failures',
    '',
    failures ? `\`\`\`\n${failures}\n\`\`\`` : 'None — every sampled request was answered correctly.',
    ''
  ].join('\n');
}

export function buildReflectionMessages(options) {
  const opts = options || {};
  const instructions = { ...DEFAULT_SCENARIO_INSTRUCTIONS, ...(opts.instructions || {}) };
  const rules = Array.isArray(instructions.rules) ? instructions.rules : [];
  const system = [
    'You optimize the system prompt of a very small language model (about 1.5B parameters)',
    'that must map a free-form automation request to exactly one scenario id.',
    'You rewrite only the instruction lines. The scenario catalog is injected between them',
    'and must not be repeated, reordered, or summarized by you.',
    'Small models follow short, concrete, unambiguous rules. Prefer removing ambiguity over adding length.',
    `Answer with a single JSON object inside a \`\`\`json code block, with keys "diagnosis" (string), "preamble" (string) and "rules" (array of at most ${MAX_PROPOSED_RULES} short strings).`
  ].join('\n');

  const failures = opts.failures ? opts.failures : 'none — every sampled request was answered correctly';
  const user = [
    `Current success rate: ${formatPercent(opts.successRate)} over ${opts.attempts || 0} attempts.`,
    '',
    'Current preamble:',
    instructions.preamble,
    '',
    'Current rules:',
    rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n') || '(none)',
    '',
    'Scenario catalog the small model sees (do not restate it in your answer):',
    opts.catalogText || '',
    '',
    'Failures observed in the latest evaluation batch:',
    failures,
    '',
    'Diagnose why the small model failed, then propose improved instructions that fix those',
    'failures without breaking the requests it already answers correctly.'
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

function formatPercent(rate) {
  const value = typeof rate === 'number' && isFinite(rate) ? rate : 0;
  return `${Math.round(value * 1000) / 10}%`;
}

function extractJsonObject(text) {
  const source = String(text || '');
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, index + 1);
    }
  }
  return null;
}

// Large models still wrap answers in prose, so the proposal is recovered from
// whatever JSON object the response contains and validated before use.
export function parseInstructionProposal(text, currentInstructions) {
  const json = extractJsonObject(text);
  if (!json) return null;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const current = { ...DEFAULT_SCENARIO_INSTRUCTIONS, ...(currentInstructions || {}) };
  const preamble = typeof parsed.preamble === 'string' ? parsed.preamble.trim() : '';
  const rules = Array.isArray(parsed.rules)
    ? parsed.rules
      .filter((rule) => typeof rule === 'string' && rule.trim())
      .map((rule) => rule.trim())
      .slice(0, MAX_PROPOSED_RULES)
    : [];
  if (!preamble || !rules.length) return null;

  return {
    instructions: { preamble, catalogHeader: current.catalogHeader, rules },
    diagnosis: typeof parsed.diagnosis === 'string' ? parsed.diagnosis.trim() : ''
  };
}

export function scoreOf(result) {
  return result && typeof result.successRate === 'number' ? result.successRate : 0;
}

export function preservesTargetScores(current, candidate) {
  const baselines = current && Array.isArray(current.targets) ? current.targets : [];
  if (!baselines.length) return true;
  const candidates = candidate && Array.isArray(candidate.targets) ? candidate.targets : [];
  return baselines.every((baseline) => {
    const match = candidates.find((target) => target.name === baseline.name);
    return match && scoreOf(match) >= scoreOf(baseline);
  });
}

// Greedy acceptance with a minimum gain: a candidate has to beat the incumbent
// by more than the sampling noise without regressing any configured model target.
export function chooseCandidate(current, candidates, minGain) {
  const threshold = typeof minGain === 'number' ? minGain : DEFAULT_OPTIMIZER_CONFIG.minGain;
  const currentScore = scoreOf(current);
  const ranked = (candidates || [])
    .filter(Boolean)
    .filter((candidate) => preservesTargetScores(current, candidate))
    .slice()
    .sort((a, b) => {
      const delta = scoreOf(b) - scoreOf(a);
      if (delta !== 0) return delta;
      return instructionsText(a.instructions).length - instructionsText(b.instructions).length;
    });
  const best = ranked[0];
  if (!best || scoreOf(best) - currentScore <= threshold) {
    return { accepted: false, winner: current, improvement: best ? scoreOf(best) - currentScore : 0 };
  }
  return { accepted: true, winner: best, improvement: scoreOf(best) - currentScore };
}

export function summarizeRound(round) {
  const info = round || {};
  const status = info.accepted ? 'accepted new instructions' : 'kept current instructions';
  return [
    `round ${info.round || 0}: baseline ${formatPercent(info.baselineScore)}`,
    `best candidate ${formatPercent(info.bestScore)}`,
    status
  ].join(' — ');
}

// Rounds start on a fixed cadence, so a slow round shortens the wait instead of
// pushing the schedule out.
export function nextRunDelay(intervalMs, elapsedMs) {
  const interval = typeof intervalMs === 'number' && intervalMs > 0 ? intervalMs : 0;
  const elapsed = typeof elapsedMs === 'number' && elapsedMs > 0 ? elapsedMs : 0;
  return Math.max(0, interval - elapsed);
}
