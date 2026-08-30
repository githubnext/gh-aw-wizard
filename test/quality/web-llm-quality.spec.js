import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect, test } from '@playwright/test';

import { safeLogValue } from '../../src/js/slm-logger.js';
import { parseScenarioSelection } from '../../src/js/slm.js';

const qualityThreshold = 50;
const qualityBaseUrl = process.env.WEB_LLM_BASE_URL || 'http://127.0.0.1:4173';
const artifactDir = resolve('test-results/web-llm-quality');
const browserProfileDir = process.env.WEB_LLM_CACHE_DIR || resolve(tmpdir(), 'gh-aw-wizard-web-llm-cache');
const resultsPath = resolve(artifactDir, 'results.jsonl');
const diagnosticsPath = resolve(artifactDir, 'diagnostics.jsonl');
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

function markdownSummary(results) {
  const good = results.filter(({ correct }) => correct).length;
  const parsedResponses = results.filter(({ mode }) => mode === 'parsed').length;
  const invalidResponses = results.filter(({ mode }) => mode === 'invalid').length;
  const errors = results.filter(({ mode }) => mode === 'error').length;
  const grouped = new Map();
  goldenIntents.forEach(({ archetype }) => {
    if (!grouped.has(archetype)) grouped.set(archetype, { total: 0, good: 0 });
  });
  results.forEach(({ expected, correct }) => {
    const bucket = grouped.get(expected);
    if (!bucket) return;
    bucket.total += 1;
    if (correct) bucket.good += 1;
  });
  const rows = [...grouped.entries()].map(([archetype, counts]) => (
    `| ${archetype} | ${counts.good} | ${counts.total} | ${roundPercent(counts.good, counts.total)}% |`
  ));
  return [
    '# WebLLM intent quality',
    '',
    `- Model: \`${wizardConfig.assistant.model.model_id}\``,
    `- Good responses: **${good}/${goldenIntents.length} (${roundPercent(good, goldenIntents.length)}%)**`,
    `- Required: **${qualityThreshold}%**`,
    `- Parsed model responses: **${parsedResponses}/${results.length}**`,
    `- Invalid model responses: **${invalidResponses}**`,
    `- Engine errors: **${errors}**`,
    '',
    '| Golden archetype | Good | Evaluated | Accuracy |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
    ''
  ].join('\n');
}

function writeArtifacts(results, diagnostics) {
  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, `${results.map((result) => JSON.stringify(result)).join('\n')}\n`);
  writeFileSync(diagnosticsPath, `${diagnostics.map((record) => JSON.stringify(record)).join('\n')}\n`);
  writeFileSync(summaryPath, markdownSummary(results));
}

test('classifies at least 50% of 100 golden intents', async () => {
  test.setTimeout(45 * 60 * 1000);
  const results = [];
  const diagnostics = [];
  const pendingDiagnostics = [];
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

    for (const golden of goldenIntents) {
      const startedAt = Date.now();
      let result;
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
      console.log(`[web-llm-quality] ${JSON.stringify(result)}`);
    }
  } finally {
    await Promise.allSettled(pendingDiagnostics);
    if (context) await context.close();
    writeArtifacts(results, diagnostics);
  }

  const good = results.filter(({ correct }) => correct).length;
  expect(
    roundPercent(good, goldenIntents.length),
    `${good}/${goldenIntents.length} model responses matched their golden archetype`
  ).toBeGreaterThanOrEqual(qualityThreshold);
});
