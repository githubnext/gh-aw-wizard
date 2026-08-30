import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const qualityThreshold = 50;
const artifactDir = resolve('test-results/web-llm-quality');
const resultsPath = resolve(artifactDir, 'results.jsonl');
const summaryPath = resolve(artifactDir, 'summary.md');
const goldenIntents = JSON.parse(readFileSync(
  fileURLToPath(new URL('../fixtures/web-llm-golden-intents.json', import.meta.url)),
  'utf8'
));
const wizardConfig = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../src/wizard.json', import.meta.url)),
  'utf8'
));

function roundPercent(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 10000) / 100 : 0;
}

function markdownSummary(results) {
  const good = results.filter(({ correct }) => correct).length;
  const modelResponses = results.filter(({ mode }) => mode === 'model').length;
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
    `- Responses produced by the model: **${modelResponses}/${results.length}**`,
    '',
    '| Golden archetype | Good | Evaluated | Accuracy |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
    ''
  ].join('\n');
}

function writeArtifacts(results) {
  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, `${results.map((result) => JSON.stringify(result)).join('\n')}\n`);
  writeFileSync(summaryPath, markdownSummary(results));
}

test('classifies at least 50% of 100 golden intents', async ({ page }) => {
  test.setTimeout(45 * 60 * 1000);
  const results = [];

  try {
    await page.goto('/');
    const gpu = await page.evaluate(async () => {
      if (!navigator.gpu) return { available: false, adapter: false };
      const adapter = await navigator.gpu.requestAdapter();
      return { available: true, adapter: Boolean(adapter) };
    });
    expect(gpu, 'A real WebGPU adapter is required for the WebLLM quality evaluation').toEqual({
      available: true,
      adapter: true
    });

    await page.getByRole('button', { name: 'Create Your Agentic Workflow' }).click();
    const input = page.locator('#intent-description');
    const analyze = page.locator('#wizard-assist');
    const modal = page.locator('#assist-modal');
    await expect(analyze).toBeVisible();

    for (const golden of goldenIntents) {
      const startedAt = Date.now();
      await input.evaluate((element, intent) => {
        element.value = intent;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }, golden.intent);
      await expect(analyze).toBeEnabled();
      await analyze.evaluate((element) => element.click());
      await expect(modal).toHaveAttribute('open', '', { timeout: 5 * 60 * 1000 });
      await expect(page.locator('#assist-modal-request')).toHaveText(golden.intent);

      const eyebrow = await page.locator('#assist-modal-eyebrow').textContent();
      const actual = await page.locator('input[name="archetype"]:checked').getAttribute('value');
      const mode = eyebrow === wizardConfig.assistant.result_eyebrow ? 'model' : 'fallback';
      const result = {
        id: golden.id,
        intent: golden.intent,
        expected: golden.archetype,
        actual,
        mode,
        correct: mode === 'model' && actual === golden.archetype,
        durationMs: Date.now() - startedAt
      };
      results.push(result);
      console.log(`[web-llm-quality] ${JSON.stringify(result)}`);

      await page.locator('#assist-modal-close').evaluate((element) => element.click());
      await expect(modal).not.toHaveAttribute('open', '');
    }
  } finally {
    writeArtifacts(results);
  }

  const good = results.filter(({ correct }) => correct).length;
  expect(
    roundPercent(good, goldenIntents.length),
    `${good}/${goldenIntents.length} model responses matched their golden archetype`
  ).toBeGreaterThanOrEqual(qualityThreshold);
});
