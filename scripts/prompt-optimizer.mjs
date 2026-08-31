#!/usr/bin/env node

// Local prompt optimizer for the wizard's in-browser scenario assistant.
//
// Runs on a MacBook Pro against local MLC-LLM servers, which means evaluation
// uses the exact model artifacts and JavaScript prompt/parsing code from WebLLM:
//
//   # desktop and iOS inner-loop models
//   mlc_llm serve HF://mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC --port 8000
//   mlc_llm serve HF://mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC --port 8002
//
//   # outer-loop optimizer — 64 GB of unified memory fits a 27B model
//   mlc_llm serve HF://mlc-ai/gemma-2-27b-it-q4f16_1-MLC --port 8001
//
//   node scripts/prompt-optimizer.mjs --all-models --ios-eval-url http://127.0.0.1:8002/v1
//
// Any OpenAI-compatible server works (MLX's `mlx_lm.server` included); point
// --eval-url / --ios-eval-url / --optimizer-url at them.
//
// An agent CLI (Copilot CLI, Codex, …) can play the outer loop instead of a
// locally served optimizer model — see .github/skills/optimize-scenario-prompt.
// It only needs the eval server plus two single-shot modes:
//
//   node scripts/prompt-optimizer.mjs --evaluate            # score + failure report
//   node scripts/prompt-optimizer.mjs --score candidate.json # accept or reject a rewrite

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

import { loadPatternsFromDir } from '../src/js/patterns-node.js';
import {
  DEFAULT_SCENARIO_INSTRUCTIONS,
  buildScenarioMessages,
  scenarioCatalog,
  scenarioCatalogText,
  scenarioAttemptTemperature,
  scenarioAttemptWinner,
  selectScenario,
  slmConfig
} from '../src/js/slm.js';
import { EVAL_CORPUS, pickRandomSample, runEvals } from '../src/js/slm-evals.js';
import {
  DEFAULT_OPTIMIZER_CONFIG,
  buildReflectionMessages,
  chooseCandidate,
  formatEvalReport,
  formatFailures,
  instructionsText,
  nextRunDelay,
  parseInstructionProposal,
  scoreOf,
  summarizeRound
} from '../src/js/prompt-optimizer.js';

const defaultPatternsPath = fileURLToPath(new URL('../patterns', import.meta.url));
const defaultWizardConfigPath = fileURLToPath(new URL('../src/wizard.json', import.meta.url));
const defaultStatePath = fileURLToPath(new URL('../.optimizer/scenario-prompt.json', import.meta.url));
const defaultReportPath = fileURLToPath(new URL('../.optimizer/eval-report.md', import.meta.url));

function usage() {
  return [
    'Usage: node scripts/prompt-optimizer.mjs [options]',
    '',
    'Optimize the scenario-assistant system prompt against local MLC-LLM servers.',
    'The inner loop scores the small browser model; an hourly outer loop asks a',
    'large model to rewrite the instructions from the failures it just saw.',
    '',
    'Options:',
    `      --eval-url <url>         Eval server base URL (default: ${DEFAULT_OPTIMIZER_CONFIG.evalBaseUrl})`,
    '      --eval-api-key <key>     Eval server bearer token (default: EVAL_API_KEY)',
    '      --eval-model <id>        Eval model id (default: the model the wizard loads in the browser)',
    '      --all-models             Evaluate desktop and iOS models concurrently',
    '      --ios-eval-url <url>     iOS eval server URL (default: --eval-url)',
    '      --ios-eval-api-key <key> iOS bearer token (default: IOS_EVAL_API_KEY or EVAL_API_KEY)',
    '      --ios-eval-model <id>    iOS model id (default: ios_model_id from wizard configuration)',
    '      --ios-attempts <n>       iOS attempts per request (default: ios_analysis_attempts)',
    '      --ios-consensus <n>      Votes required for an iOS winner (default: ios_analysis_consensus)',
    `      --optimizer-url <url>    Optimizer server base URL (default: ${DEFAULT_OPTIMIZER_CONFIG.optimizerBaseUrl})`,
    '      --optimizer-api-key <key> Optimizer server bearer token (default: OPTIMIZER_API_KEY)',
    `      --optimizer-model <id>   Optimizer model id (default: ${DEFAULT_OPTIMIZER_CONFIG.optimizerModel})`,
    `      --interval <minutes>     Outer loop cadence (default: ${DEFAULT_OPTIMIZER_CONFIG.intervalMs / 60000})`,
    `      --sample-size <n>        Requests per reflection batch (default: ${DEFAULT_OPTIMIZER_CONFIG.sampleSize})`,
    `      --validation-size <n>    Requests used to confirm a candidate (default: ${DEFAULT_OPTIMIZER_CONFIG.validationSize})`,
    `      --repetitions <n>        Repeats per request (default: ${DEFAULT_OPTIMIZER_CONFIG.repetitions})`,
    '      --attempts <n>           Model attempts per request (default: wizard configuration)',
    '      --consensus <n>          Votes required for a winner (default: strict majority)',
    `      --candidates <n>         Proposals per round (default: ${DEFAULT_OPTIMIZER_CONFIG.candidates})`,
    `      --min-gain <ratio>       Required improvement to adopt (default: ${DEFAULT_OPTIMIZER_CONFIG.minGain})`,
    '      --rounds <n>             Stop after n rounds (default: run forever)',
    '      --once                   Run a single round and exit',
    '      --evaluate               Score the current instructions, write a failure report, exit',
    '      --score <path>           Score a candidate instructions JSON file and adopt it if better',
    '      --instructions <path>    Instructions JSON to evaluate instead of the saved state',
    `      --report <path>          Where --evaluate writes its markdown report (default: ${'.optimizer/eval-report.md'})`,
    '      --dry-run                With --score, report the decision without writing the state',
    '      --state <path>           Where to persist the best prompt (default: .optimizer/scenario-prompt.json)',
    '      --patterns <path>        Pattern library directory (default: patterns/)',
    '      --wizard-config <path>   Wizard configuration file (default: src/wizard.json)',
    '  -h, --help                   Show this help message'
  ].join('\n');
}

function parseArgs(args) {
  const options = {
    ...DEFAULT_OPTIMIZER_CONFIG,
    state: defaultStatePath,
    patterns: defaultPatternsPath,
    wizardConfig: defaultWizardConfigPath,
    evalModel: null,
    evalAttempts: null,
    evalConsensus: null,
    evalApiKey: process.env.EVAL_API_KEY || '',
    iosEvalBaseUrl: null,
    iosEvalModel: null,
    iosEvalAttempts: null,
    iosEvalConsensus: null,
    iosEvalApiKey: process.env.IOS_EVAL_API_KEY || '',
    optimizerApiKey: process.env.OPTIMIZER_API_KEY || '',
    report: defaultReportPath,
    mode: 'loop'
  };
  const number = (value, name) => {
    const parsed = Number(value);
    if (!isFinite(parsed)) throw new Error(`${name} must be a number`);
    return parsed;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') return { help: true };
    else if (arg === '--eval-url') options.evalBaseUrl = args[++index];
    else if (arg === '--eval-api-key') options.evalApiKey = args[++index];
    else if (arg === '--eval-model') options.evalModel = args[++index];
    else if (arg === '--all-models') options.allModels = true;
    else if (arg === '--ios-eval-url') options.iosEvalBaseUrl = args[++index];
    else if (arg === '--ios-eval-api-key') options.iosEvalApiKey = args[++index];
    else if (arg === '--ios-eval-model') options.iosEvalModel = args[++index];
    else if (arg === '--ios-attempts') options.iosEvalAttempts = number(args[++index], '--ios-attempts');
    else if (arg === '--ios-consensus') options.iosEvalConsensus = number(args[++index], '--ios-consensus');
    else if (arg === '--optimizer-url') options.optimizerBaseUrl = args[++index];
    else if (arg === '--optimizer-api-key') options.optimizerApiKey = args[++index];
    else if (arg === '--optimizer-model') options.optimizerModel = args[++index];
    else if (arg === '--interval') options.intervalMs = number(args[++index], '--interval') * 60000;
    else if (arg === '--sample-size') options.sampleSize = number(args[++index], '--sample-size');
    else if (arg === '--validation-size') options.validationSize = number(args[++index], '--validation-size');
    else if (arg === '--repetitions') options.repetitions = number(args[++index], '--repetitions');
    else if (arg === '--attempts') options.evalAttempts = number(args[++index], '--attempts');
    else if (arg === '--consensus') options.evalConsensus = number(args[++index], '--consensus');
    else if (arg === '--candidates') options.candidates = number(args[++index], '--candidates');
    else if (arg === '--min-gain') options.minGain = number(args[++index], '--min-gain');
    else if (arg === '--rounds') options.rounds = number(args[++index], '--rounds');
    else if (arg === '--once') options.rounds = 1;
    else if (arg === '--evaluate') options.mode = 'evaluate';
    else if (arg === '--score') { options.mode = 'score'; options.candidate = args[++index]; }
    else if (arg === '--instructions') options.instructions = args[++index];
    else if (arg === '--report') options.report = args[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--state') options.state = args[++index];
    else if (arg === '--patterns') options.patterns = args[++index];
    else if (arg === '--wizard-config') options.wizardConfig = args[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.mode === 'score' && !options.candidate) {
    throw new Error('--score requires the path of a candidate instructions JSON file');
  }
  return options;
}

function log(message) {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

export async function chatCompletion(baseUrl, body, apiKey = '') {
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ stream: false, ...body })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${baseUrl} returned ${response.status}: ${detail.slice(0, 200)}`);
  }
  const output = await response.json();
  const message = output && output.choices && output.choices[0] && output.choices[0].message;
  return message && typeof message.content === 'string' ? message.content : '';
}

async function evaluateTarget(options, target, scenarios, instructions, corpus) {
  const rows = [];
  const result = await runEvals({
    corpus,
    repetitions: options.repetitions,
    onRow: (row) => rows.push(row),
    analyze: async (request) => {
      const attempts = [];
      for (let index = 0; index < target.attempts; index += 1) {
        const answer = await chatCompletion(target.baseUrl, {
          model: target.model,
          messages: buildScenarioMessages(scenarios, request, instructions),
          max_tokens: options.evalMaxTokens,
          temperature: scenarioAttemptTemperature(index)
        }, target.apiKey);
        attempts.push({ answer, scenario: selectScenario(answer, request, scenarios) });
      }
      const winner = scenarioAttemptWinner(attempts, target.consensus);
      return winner || { answer: attempts.map((attempt) => attempt.answer).join('\n'), scenario: null };
    }
  });
  return {
    ...result,
    name: target.name,
    model: target.model,
    traces: rows.map((row) => ({ ...row, evalTarget: target.name })),
    instructions
  };
}

export function aggregateTargetEvaluations(evaluations, instructions) {
  const results = Array.isArray(evaluations) ? evaluations : [];
  const byScenario = new Map();
  results.forEach((evaluation) => {
    (evaluation.rows || []).forEach((row) => {
      const current = byScenario.get(row.scenario) || {
        scenario: row.scenario,
        queries: 0,
        attempts: 0,
        successes: 0,
        errors: 0
      };
      current.queries += row.queries || 0;
      current.attempts += row.attempts || 0;
      current.successes += row.successes || 0;
      current.errors += row.errors || 0;
      byScenario.set(row.scenario, current);
    });
  });
  const rows = [...byScenario.values()].map((row) => ({
    ...row,
    successRate: row.attempts ? row.successes / row.attempts : 0
  }));
  const attempts = results.reduce((total, result) => total + result.attempts, 0);
  const successes = results.reduce((total, result) => total + result.successes, 0);
  return {
    queries: results.reduce((total, result) => total + result.queries, 0),
    attempts,
    successes,
    errors: results.reduce((total, result) => total + result.errors, 0),
    successRate: attempts ? successes / attempts : 0,
    rows,
    traces: results.flatMap((result) => result.traces || []),
    targets: results.map((result) => ({
      name: result.name,
      model: result.model,
      attempts: result.attempts,
      successes: result.successes,
      errors: result.errors,
      successRate: result.successRate
    })),
    instructions
  };
}

// All configured browser models score the same sample concurrently. This keeps
// dual-target optimization practical without allowing one model to hide another.
async function evaluatePrompt(options, scenarios, instructions, corpus) {
  const evaluations = await Promise.all(options.evalTargets.map((target) => {
    return evaluateTarget(options, target, scenarios, instructions, corpus);
  }));
  return aggregateTargetEvaluations(evaluations, instructions);
}

async function proposeInstructions(options, instructions, catalogText, evaluation) {
  const messages = buildReflectionMessages({
    instructions,
    catalogText,
    failures: formatFailures(evaluation.traces, options.failureExamples),
    successRate: evaluation.successRate,
    attempts: evaluation.attempts
  });
  const answer = await chatCompletion(options.optimizerBaseUrl, {
    model: options.optimizerModel,
    messages,
    max_tokens: options.optimizerMaxTokens,
    temperature: options.optimizerTemperature
  }, options.optimizerApiKey);
  return parseInstructionProposal(answer, instructions);
}

async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function loadState(path) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    return state && state.instructions ? state : null;
  } catch {
    return null;
  }
}

function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

// Read a `{ preamble, rules }` document written by an agent CLI (or by hand)
// and normalize it into the instructions shape the prompt builder expects.
async function readInstructions(path) {
  const document = JSON.parse(await readFile(path, 'utf8'));
  const source = document && document.instructions ? document.instructions : document;
  const preamble = source && typeof source.preamble === 'string' ? source.preamble.trim() : '';
  const rules = source && Array.isArray(source.rules)
    ? source.rules.filter((rule) => typeof rule === 'string' && rule.trim()).map((rule) => rule.trim())
    : [];
  if (!preamble || !rules.length) {
    throw new Error(`${path} must contain a non-empty "preamble" string and a "rules" array of strings`);
  }
  return {
    preamble,
    catalogHeader: DEFAULT_SCENARIO_INSTRUCTIONS.catalogHeader,
    rules
  };
}

// Outer loop delegated to an agent CLI, step 1: score the instructions in play
// and hand the agent a report of exactly what the small model got wrong.
async function runEvaluate(options, scenarios, state) {
  const instructions = options.instructions
    ? await readInstructions(options.instructions)
    : state.instructions;
  const sample = pickRandomSample(EVAL_CORPUS, options.sampleSize);
  const evaluation = await evaluatePrompt(options, scenarios, instructions, sample);
  const report = formatEvalReport({
    instructions,
    evaluation,
    evalModel: options.evalTargets.map((target) => `${target.name}:${target.model}`).join(', '),
    failureExamples: options.failureExamples
  });
  await mkdir(dirname(options.report), { recursive: true });
  await writeFile(options.report, report, 'utf8');
  process.stdout.write(`${report}\n`);
  log(`report written to ${options.report}`);
}

// Outer loop delegated to an agent CLI, step 2: judge the rewrite the agent
// produced on a held-out sample, using the same acceptance rule as the
// self-contained loop so both paths agree on what counts as an improvement.
async function runScore(options, scenarios, state) {
  const candidate = await readInstructions(options.candidate);
  const validation = pickRandomSample(EVAL_CORPUS, options.validationSize);
  const currentValidation = await evaluatePrompt(options, scenarios, state.instructions, validation);
  const candidateValidation = await evaluatePrompt(options, scenarios, candidate, validation);
  const decision = chooseCandidate(currentValidation, [candidateValidation], options.minGain);
  log(summarizeRound({
    round: (state.history || []).length + 1,
    baselineScore: currentValidation.successRate,
    bestScore: candidateValidation.successRate,
    accepted: decision.accepted
  }));
  if (!decision.accepted || options.dryRun) {
    if (decision.accepted) log('dry run — the candidate was not saved');
    return;
  }
  const next = {
    ...state,
    updatedAt: new Date().toISOString(),
    evalModel: options.evalTargets.map((target) => target.model).join(','),
    evalTargets: candidateValidation.targets,
    optimizerModel: `agent-cli:${options.candidate}`,
    instructions: candidate,
    score: scoreOf(candidateValidation),
    validationSize: validation.length,
    history: (state.history || []).concat([{
      round: (state.history || []).length + 1,
      at: new Date().toISOString(),
      baselineScore: currentValidation.successRate,
      bestScore: candidateValidation.successRate,
      accepted: true,
      improvement: decision.improvement,
      diagnosis: ''
    }]).slice(-100)
  };
  await saveState(options.state, next);
  log(`adopted the candidate\n${instructionsText(candidate)}`);
}

async function runRound(options, scenarios, catalogText, state, roundNumber) {
  const minibatch = pickRandomSample(EVAL_CORPUS, options.sampleSize);
  const baseline = await evaluatePrompt(options, scenarios, state.instructions, minibatch);
  log(`round ${roundNumber}: baseline scored ${(baseline.successRate * 100).toFixed(1)}% on ${baseline.attempts} attempts`);

  const survivors = [];
  for (let index = 0; index < options.candidates; index += 1) {
    const proposal = await proposeInstructions(options, state.instructions, catalogText, baseline);
    if (!proposal) {
      log(`round ${roundNumber}: candidate ${index + 1} was not a usable proposal`);
      continue;
    }
    if (proposal.diagnosis) log(`round ${roundNumber}: candidate ${index + 1} diagnosis — ${proposal.diagnosis}`);
    const scored = await evaluatePrompt(options, scenarios, proposal.instructions, minibatch);
    log(`round ${roundNumber}: candidate ${index + 1} scored ${(scored.successRate * 100).toFixed(1)}% on the batch`);
    if (scoreOf(scored) >= scoreOf(baseline)) survivors.push({ ...scored, diagnosis: proposal.diagnosis });
  }

  if (!survivors.length) {
    log(summarizeRound({ round: roundNumber, baselineScore: baseline.successRate, bestScore: baseline.successRate }));
    return { state, accepted: false };
  }

  // Confirm on a held-out sample so a candidate cannot win by overfitting the
  // handful of requests its diagnosis was written from.
  const validation = pickRandomSample(EVAL_CORPUS, options.validationSize);
  const currentValidation = await evaluatePrompt(options, scenarios, state.instructions, validation);
  const candidateValidations = [];
  for (const survivor of survivors) {
    const scored = await evaluatePrompt(options, scenarios, survivor.instructions, validation);
    candidateValidations.push({ ...scored, diagnosis: survivor.diagnosis });
  }

  const decision = chooseCandidate(currentValidation, candidateValidations, options.minGain);
  const bestScore = candidateValidations.reduce((best, entry) => Math.max(best, scoreOf(entry)), 0);
  log(summarizeRound({
    round: roundNumber,
    baselineScore: currentValidation.successRate,
    bestScore,
    accepted: decision.accepted
  }));

  const next = {
    updatedAt: new Date().toISOString(),
    evalModel: options.evalTargets.map((target) => target.model).join(','),
    evalTargets: decision.winner.targets,
    optimizerModel: options.optimizerModel,
    instructions: decision.winner.instructions || state.instructions,
    score: scoreOf(decision.winner),
    validationSize: validation.length,
    history: (state.history || []).concat([{
      round: roundNumber,
      at: new Date().toISOString(),
      baselineScore: currentValidation.successRate,
      bestScore,
      accepted: decision.accepted,
      improvement: decision.improvement,
      diagnosis: decision.accepted ? decision.winner.diagnosis || '' : ''
    }]).slice(-100)
  };
  if (decision.accepted) log(`round ${roundNumber}: new instructions\n${instructionsText(next.instructions)}`);
  return { state: next, accepted: decision.accepted };
}

export async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const patterns = await loadPatternsFromDir(options.patterns);
  // The wizard configuration supplies the custom card and the browser model id,
  // so the local evaluation mirrors what visitors actually run.
  const wizardConfig = JSON.parse(await readFile(options.wizardConfig, 'utf8'));
  const custom = wizardConfig.archetypes && wizardConfig.archetypes.custom
    ? [wizardConfig.archetypes.custom]
    : [];
  const modelConfig = slmConfig(wizardConfig);
  options.evalModel = options.evalModel || modelConfig.model_id;
  options.evalAttempts = Math.min(Math.max(
    Math.floor(options.evalAttempts || modelConfig.analysis_attempts || 1),
    1
  ), 5);
  options.evalConsensus = Math.min(Math.max(
    Math.floor(options.evalConsensus || modelConfig.analysis_consensus || Math.floor(options.evalAttempts / 2) + 1),
    1
  ), options.evalAttempts);
  options.evalTargets = [{
    name: 'desktop',
    model: options.evalModel,
    baseUrl: options.evalBaseUrl,
    apiKey: options.evalApiKey,
    attempts: options.evalAttempts,
    consensus: options.evalConsensus
  }];
  if (options.allModels) {
    if (!modelConfig.ios_model_id && !options.iosEvalModel) {
      throw new Error('--all-models requires assistant.model.ios_model_id or --ios-eval-model');
    }
    options.evalTargets.push({
      name: 'ios',
      model: options.iosEvalModel || modelConfig.ios_model_id,
      baseUrl: options.iosEvalBaseUrl || options.evalBaseUrl,
      apiKey: options.iosEvalApiKey || options.evalApiKey,
      attempts: Math.min(Math.max(
        Math.floor(options.iosEvalAttempts || modelConfig.ios_analysis_attempts || 1),
        1
      ), 5),
      consensus: 1
    });
    const iosTarget = options.evalTargets[options.evalTargets.length - 1];
    iosTarget.consensus = Math.min(Math.max(
      Math.floor(options.iosEvalConsensus
        || modelConfig.ios_analysis_consensus
        || Math.floor(iosTarget.attempts / 2) + 1),
      1
    ), iosTarget.attempts);
  }
  const scenarios = scenarioCatalog(patterns, custom);
  if (!scenarios.length) throw new Error('No scenarios were found in the pattern library');
  const catalogText = scenarioCatalogText(scenarios);

  const restored = await loadState(options.state);
  let state = restored || {
    updatedAt: new Date().toISOString(),
    instructions: DEFAULT_SCENARIO_INSTRUCTIONS,
    score: 0,
    history: []
  };
  log(restored ? `resumed from ${options.state}` : 'starting from the shipped instructions');
  options.evalTargets.forEach((target) => {
    log(`eval target ${target.name}: ${target.model} at ${target.baseUrl} (${target.consensus}/${target.attempts} consensus)`);
  });

  if (options.mode === 'evaluate') return runEvaluate(options, scenarios, state);
  if (options.mode === 'score') return runScore(options, scenarios, state);

  log(`optimizer model ${options.optimizerModel} at ${options.optimizerBaseUrl}`);

  const controller = new AbortController();
  const stop = () => {
    log('stopping after the current round');
    controller.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  let round = (state.history || []).length;
  for (;;) {
    round += 1;
    const startedAt = Date.now();
    try {
      const outcome = await runRound(options, scenarios, catalogText, state, round);
      state = outcome.state;
      await saveState(options.state, state);
    } catch (error) {
      log(`round ${round} failed: ${error.message}`);
    }
    if (controller.signal.aborted) break;
    if (options.rounds && round >= options.rounds) break;
    const delay = nextRunDelay(options.intervalMs, Date.now() - startedAt);
    log(`sleeping ${Math.round(delay / 1000)}s until the next round`);
    await sleep(delay, controller.signal);
    if (controller.signal.aborted) break;
  }
  log(`best prompt saved to ${options.state}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
