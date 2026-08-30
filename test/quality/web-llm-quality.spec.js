import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect, test } from '@playwright/test';

import { safeLogValue } from '../../src/js/slm-logger.js';
import { parseScenarioSelection } from '../../src/js/slm.js';

const qualityThreshold = 50;
const repetitions = 10;
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

function markdownSummary(results, variability) {
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
    `- Repetitions per intent: **${repetitions}**`,
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

function writeArtifacts(results, diagnostics) {
  const variability = sampleVariability(results);
  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, `${results.map((result) => JSON.stringify(result)).join('\n')}\n`);
  writeFileSync(diagnosticsPath, `${diagnostics.map((record) => JSON.stringify(record)).join('\n')}\n`);
  writeFileSync(variabilityPath, `${variability.map((sample) => JSON.stringify(sample)).join('\n')}\n`);
  writeFileSync(summaryPath, markdownSummary(results, variability));
}

test(`classifies at least 50% of ${goldenIntents.length} golden intents over ${repetitions} runs each`, async () => {
  test.setTimeout(3 * 60 * 60 * 1000);
  const results = [];
  const diagnostics = [];
  const pendingDiagnostics = [];
  const evaluationCount = goldenIntents.length * repetitions;
  let completedIntents = 0;
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
      samples: goldenIntents.length,
      repetitions,
      evaluations: evaluationCount,
      browserProfileDir
    })}`);

    for (const golden of goldenIntents) {
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        const evaluation = results.length + 1;
        const startedAt = Date.now();
        let result;
        console.log(`[web-llm-attempt] ${JSON.stringify({
          event: 'started',
          id: golden.id,
          repetition,
          evaluation,
          evaluations: evaluationCount
        })}`);
        try {
          const output = await page.evaluate(async ({ config, intent, scenarioCatalog }) => {
            if (!globalThis.__webLlmQualityAssistant) {
              const { createScenarioAssistant } = await import('/js/slm-runner.js');
              globalThis.__webLlmQualityAssistant = createScenarioAssistant({ config });
            }
            return globalThis.__webLlmQualityAssistant.analyze(intent, scenarioCatalog);
          }, {
            config: wizardConfig.assistant.model,
            intent: golden.intent,
            scenarioCatalog: scenarios
          });
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
            durationMs: Date.now() - startedAt
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
            durationMs: Date.now() - startedAt,
            error: safeLogValue(error, 'error')
          };
        }
        results.push(result);
        if (result.correct) goodCount += 1;
        console.log(`[web-llm-quality] ${JSON.stringify(result)}`);
      }
      const completedEvaluations = results.length;
      completedIntents += 1;
      console.log(`[web-llm-batch-progress] ${JSON.stringify({
        completedIntents,
        totalIntents: goldenIntents.length,
        completedEvaluations,
        totalEvaluations: evaluationCount,
        good: goodCount,
        accuracy: roundPercent(goodCount, completedEvaluations)
      })}`);
    }
  } finally {
    await Promise.allSettled(pendingDiagnostics);
    if (context) await context.close();
    writeArtifacts(results, diagnostics);
  }

  expect(results, 'Every golden intent must complete all repetitions').toHaveLength(evaluationCount);
  expect(
    roundPercent(goodCount, results.length),
    `${goodCount}/${results.length} model responses matched their golden archetype`
  ).toBeGreaterThanOrEqual(qualityThreshold);
});
