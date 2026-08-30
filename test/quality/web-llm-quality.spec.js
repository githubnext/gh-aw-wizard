import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect, test } from '@playwright/test';

import { safeLogValue } from '../../src/js/slm-logger.js';
import { parseScenarioSelection } from '../../src/js/slm.js';

const qualityThreshold = 50;
const maxRepetitions = 10;
const evaluationBudgetMs = 4 * 60 * 1000;
const artifactReserveMs = 15 * 1000;
const calibrationCount = 3;
const qualityBaseUrl = process.env.WEB_LLM_BASE_URL || 'http://127.0.0.1:4173';
const artifactDir = resolve('test-results/web-llm-quality');
const browserProfileDir = process.env.WEB_LLM_CACHE_DIR || resolve(tmpdir(), 'gh-aw-wizard-web-llm-cache');
const resultsPath = resolve(artifactDir, 'results.jsonl');
const diagnosticsPath = resolve(artifactDir, 'diagnostics.jsonl');
const variabilityPath = resolve(artifactDir, 'variability.jsonl');
const summaryPath = resolve(artifactDir, 'summary.md');
const goldenIntents = JSON.parse(readFileSync(
  fileURLToPath(new URL('../fixtures/web-llm-golden-intents.json', import.meta.url)),
  'utf8'
));
const wizardConfig = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../src/wizard.json', import.meta.url)),
  'utf8'
));
const manifest = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../patterns/manifest.json', import.meta.url)),
  'utf8'
));
const scenarios = manifest.archetypes.map((id) => JSON.parse(readFileSync(
  fileURLToPath(new URL(`../../patterns/archetypes/${id}.json`, import.meta.url)),
  'utf8'
))).map(({ id, label, description }) => ({ id, label, description }));

function roundPercent(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 10000) / 100 : 0;
}

function stratifiedIntents(intents) {
  const buckets = new Map();
  intents.forEach((intent) => {
    if (!buckets.has(intent.archetype)) buckets.set(intent.archetype, []);
    buckets.get(intent.archetype).push(intent);
  });
  const ordered = [];
  while (ordered.length < intents.length) {
    buckets.forEach((bucket) => {
      if (bucket.length) ordered.push(bucket.shift());
    });
  }
  return ordered;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function withinDeadline(promise, timeoutMs) {
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('The evaluation time budget was exhausted');
      error.name = 'EvaluationBudgetError';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function evaluationPlan(results, elapsedMs) {
  const steadyStateDurations = results.slice(1).map(({ durationMs }) => durationMs);
  const estimatedAttemptMs = Math.max(1, median(steadyStateDurations.length
    ? steadyStateDurations
    : results.map(({ durationMs }) => durationMs)));
  const remainingMs = Math.max(0, evaluationBudgetMs - elapsedMs - artifactReserveMs);
  const capacity = results.length + Math.floor(remainingMs / (estimatedAttemptMs * 1.25));
  const maximumEvaluations = goldenIntents.length * maxRepetitions;
  const plannedEvaluations = Math.max(results.length, Math.min(maximumEvaluations, capacity));
  const repetitions = plannedEvaluations >= 4
    ? Math.min(maxRepetitions, Math.max(2, Math.floor(plannedEvaluations / goldenIntents.length)))
    : 1;
  const sampleCount = Math.min(
    goldenIntents.length,
    Math.max(results.length, Math.floor(plannedEvaluations / repetitions))
  );
  return {
    sampleCount,
    repetitions,
    evaluations: sampleCount * repetitions,
    estimatedAttemptMs,
    estimatedFullDurationMs: elapsedMs + ((maximumEvaluations - results.length) * estimatedAttemptMs),
    estimatedPlanDurationMs: elapsedMs + (((sampleCount * repetitions) - results.length) * estimatedAttemptMs)
  };
}

function sampleVariability(results) {
  return goldenIntents.map(({ id, intent, archetype }) => {
    const attempts = results.filter((result) => result.id === id);
    const outcomes = new Map();
    attempts.forEach(({ actual, answer, mode, error }) => {
      const outcome = { actual, answer, mode, error: error && error.message };
      const key = JSON.stringify(outcome);
      outcomes.set(key, { ...outcome, count: (outcomes.get(key)?.count || 0) + 1 });
    });
    const good = attempts.filter(({ correct }) => correct).length;
    return {
      id,
      intent,
      expected: archetype,
      good,
      attempts: attempts.length,
      accuracy: roundPercent(good, attempts.length),
      distinctOutcomes: outcomes.size,
      outcomes: [...outcomes.values()]
    };
  });
}

function markdownSummary(results, variability, run) {
  const good = results.filter(({ correct }) => correct).length;
  const parsedResponses = results.filter(({ mode }) => mode === 'parsed').length;
  const invalidResponses = results.filter(({ mode }) => mode === 'invalid').length;
  const errors = results.filter(({ mode }) => mode === 'error').length;
  const variableSamples = variability.filter(({ distinctOutcomes }) => distinctOutcomes > 1).length;
  const grouped = new Map();
  goldenIntents.forEach(({ archetype }) => {
    if (!grouped.has(archetype)) grouped.set(archetype, { total: 0, good: 0, variable: 0 });
  });
  results.forEach(({ expected, correct }) => {
    const bucket = grouped.get(expected);
    if (!bucket) return;
    bucket.total += 1;
    if (correct) bucket.good += 1;
  });
  variability.forEach(({ expected, distinctOutcomes }) => {
    if (distinctOutcomes > 1) grouped.get(expected).variable += 1;
  });
  const rows = [...grouped.entries()].map(([archetype, counts]) => (
    `| ${archetype} | ${counts.good} | ${counts.total} | ${roundPercent(counts.good, counts.total)}% | ${counts.variable} |`
  ));
  return [
    '# WebLLM intent quality',
    '',
    `- Model: \`${wizardConfig.assistant.model.model_id}\``,
    `- Time budget: **${evaluationBudgetMs / 1000} seconds**`,
    `- Actual evaluation duration: **${Math.round(run.elapsedMs / 10) / 100} seconds**`,
    `- Estimated full 100 × ${maxRepetitions} duration: **${Math.round(run.plan.estimatedFullDurationMs / 10) / 100} seconds**`,
    `- Adaptive plan: **${run.plan.sampleCount} samples × ${run.plan.repetitions} repetitions**`,
    `- Completed coverage: **${run.completedSamples} samples / ${results.length} evaluations**`,
    `- Stopped for time budget: **${run.stoppedForBudget ? 'yes' : 'no'}**`,
    `- Good responses: **${good}/${results.length} (${roundPercent(good, results.length)}%)**`,
    `- Required: **${qualityThreshold}%**`,
    `- Parsed model responses: **${parsedResponses}/${results.length}**`,
    `- Invalid model responses: **${invalidResponses}**`,
    `- Engine errors: **${errors}**`,
    `- Samples with multiple outcomes: **${variableSamples}/${goldenIntents.length}**`,
    '',
    '| Golden archetype | Good | Evaluated | Accuracy | Variable samples |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows,
    ''
  ].join('\n');
}

function writeArtifacts(results, diagnostics, run) {
  const variability = sampleVariability(results);
  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, `${results.map((result) => JSON.stringify(result)).join('\n')}\n`);
  writeFileSync(diagnosticsPath, `${diagnostics.map((record) => JSON.stringify(record)).join('\n')}\n`);
  writeFileSync(variabilityPath, `${variability.map((sample) => JSON.stringify(sample)).join('\n')}\n`);
  writeFileSync(summaryPath, markdownSummary(results, variability, run));
}

test(`classifies at least 50% of adaptively sampled golden intents within a ${evaluationBudgetMs / 1000}-second budget`, async () => {
  test.setTimeout(5 * 60 * 1000);
  const results = [];
  const diagnostics = [];
  const pendingDiagnostics = [];
  const orderedIntents = stratifiedIntents(goldenIntents);
  const startedAt = Date.now();
  let plan = {
    sampleCount: calibrationCount,
    repetitions: 1,
    evaluations: calibrationCount,
    estimatedAttemptMs: 0,
    estimatedFullDurationMs: 0,
    estimatedPlanDurationMs: 0
  };
  let stoppedForBudget = false;
  let goodCount = 0;
  let context;

  try {
    context = await chromium.launchPersistentContext(browserProfileDir, {
      headless: true,
      args: [
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist'
      ]
    });
    const page = context.pages()[0] || await context.newPage();
    page.on('console', (message) => {
      pendingDiagnostics.push((async () => {
        const values = await Promise.all(message.args().map(async (argument) => {
          try {
            return await argument.jsonValue();
          } catch {
            return null;
          }
        }));
        const record = values.find((value) => value && typeof value === 'object' && value.evt);
        if (!record) return;
        diagnostics.push(record);
        console.log(`[web-llm-diagnostic] ${JSON.stringify(record)}`);
      })());
    });
    await page.goto(qualityBaseUrl);
    const gpu = await page.evaluate(async () => {
      if (!navigator.gpu) return { available: false, adapter: false };
      const adapter = await navigator.gpu.requestAdapter();
      return { available: true, adapter: Boolean(adapter) };
    });
    expect(gpu, 'A real WebGPU adapter is required for the WebLLM quality evaluation').toEqual({
      available: true,
      adapter: true
    });
    console.log(`[web-llm-run] ${JSON.stringify({
      event: 'started',
      model: wizardConfig.assistant.model.model_id,
      availableSamples: goldenIntents.length,
      maxRepetitions,
      maxEvaluations: goldenIntents.length * maxRepetitions,
      evaluationBudgetMs,
      browserProfileDir
    })}`);

    const completed = new Set();
    async function evaluate(golden, repetition) {
      const evaluation = results.length + 1;
      const attemptStartedAt = Date.now();
      let result;
      console.log(`[web-llm-attempt] ${JSON.stringify({
        event: 'started',
        id: golden.id,
        repetition,
        evaluation,
        elapsedMs: attemptStartedAt - startedAt,
        remainingMs: Math.max(0, evaluationBudgetMs - (attemptStartedAt - startedAt))
      })}`);
      try {
        const remainingMs = Math.max(1, evaluationBudgetMs - (Date.now() - startedAt) - artifactReserveMs);
        const output = await withinDeadline(
          page.evaluate(async ({ config, intent, scenarioCatalog }) => {
            if (!globalThis.__webLlmQualityAssistant) {
              const { createScenarioAssistant } = await import('/js/slm-runner.js');
              globalThis.__webLlmQualityAssistant = createScenarioAssistant({ config });
            }
            return globalThis.__webLlmQualityAssistant.analyze(intent, scenarioCatalog);
          }, {
            config: wizardConfig.assistant.model,
            intent: golden.intent,
            scenarioCatalog: scenarios
          }),
          remainingMs
        );
        const actual = parseScenarioSelection(output.answer, scenarios);
        result = {
          id: golden.id,
          repetition,
          evaluation,
          intent: golden.intent,
          expected: golden.archetype,
          actual,
          answer: output.answer,
          mode: actual ? 'parsed' : 'invalid',
          correct: actual === golden.archetype,
          durationMs: Date.now() - attemptStartedAt
        };
      } catch (error) {
        result = {
          id: golden.id,
          repetition,
          evaluation,
          intent: golden.intent,
          expected: golden.archetype,
          actual: null,
          mode: 'error',
          correct: false,
          durationMs: Date.now() - attemptStartedAt,
          error: safeLogValue(error, 'error')
        };
        if (error.name === 'EvaluationBudgetError') stoppedForBudget = true;
      }
      results.push(result);
      completed.add(`${golden.id}:${repetition}`);
      if (result.correct) goodCount += 1;
      console.log(`[web-llm-quality] ${JSON.stringify(result)}`);
    }

    for (const golden of orderedIntents.slice(0, calibrationCount)) {
      await evaluate(golden, 1);
      if (stoppedForBudget) break;
    }
    plan = evaluationPlan(results, Date.now() - startedAt);
    console.log(`[web-llm-plan] ${JSON.stringify({
      event: 'estimated',
      ...plan,
      calibrationEvaluations: results.length,
      elapsedMs: Date.now() - startedAt
    })}`);

    evaluation:
    for (let repetition = 1; !stoppedForBudget && repetition <= plan.repetitions; repetition++) {
      for (const golden of orderedIntents.slice(0, plan.sampleCount)) {
        if (completed.has(`${golden.id}:${repetition}`)) continue;
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs + (plan.estimatedAttemptMs * 1.5) + artifactReserveMs >= evaluationBudgetMs) {
          stoppedForBudget = true;
          console.log(`[web-llm-budget] ${JSON.stringify({
            event: 'stopped',
            elapsedMs,
            remainingMs: evaluationBudgetMs - elapsedMs,
            estimatedAttemptMs: plan.estimatedAttemptMs,
            completedEvaluations: results.length
          })}`);
          break evaluation;
        }
        await evaluate(golden, repetition);
      }
      console.log(`[web-llm-repetition-progress] ${JSON.stringify({
        completedRepetitions: repetition,
        plannedRepetitions: plan.repetitions,
        completedEvaluations: results.length,
        plannedEvaluations: plan.evaluations,
        good: goodCount,
        accuracy: roundPercent(goodCount, results.length),
        elapsedMs: Date.now() - startedAt
      })}`);
    }
  } finally {
    await Promise.allSettled(pendingDiagnostics);
    if (context) await context.close();
    const completedSamples = new Set(results.map(({ id }) => id)).size;
    writeArtifacts(results, diagnostics, {
      plan,
      completedSamples,
      stoppedForBudget,
      elapsedMs: Date.now() - startedAt
    });
  }

  expect(results.length, 'The adaptive evaluation must complete at least one sample').toBeGreaterThan(0);
  expect(
    roundPercent(goodCount, results.length),
    `${goodCount}/${results.length} model responses matched their golden archetype`
  ).toBeGreaterThanOrEqual(qualityThreshold);
});
