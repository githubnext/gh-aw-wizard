import { expect, test } from '@playwright/test';

const inferenceRuntime = `
  export const env = {
    backends: { onnx: { wasm: {} } }
  };

  export async function pipeline(task, model, options) {
    globalThis.__webLlmE2E = { task, model, calls: 0 };
    options.progress_callback({ status: 'progress', file: 'model.onnx', progress: 50 });
    options.progress_callback({ status: 'ready' });

    return async function generate(messages, generationOptions) {
      globalThis.__webLlmE2E.calls += 1;
      globalThis.__webLlmE2E.messages = messages;
      globalThis.__webLlmE2E.generationOptions = generationOptions;
      return [{
        generated_text: [
          ...messages,
          { role: 'assistant', content: 'documentation-updater' }
        ]
      }];
    };
  }
`;

test('runs in-browser inference and applies the selected scenario', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get: () => ({})
    });
  });
  await page.route('**/slm/transformers.min.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: inferenceRuntime
  }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Create Your Agentic Workflow' }).click();

  const request = 'Label incoming bug reports and prioritize urgent issues';
  await page.locator('#intent-description').fill(request);

  const analyze = page.getByRole('button', { name: 'Analyze' });
  await expect(analyze).toBeVisible();
  await expect(analyze).toBeEnabled();
  await analyze.click();

  const result = page.locator('#assist-modal');
  await expect(result).toBeVisible();
  await expect(result.locator('#assist-modal-eyebrow')).toHaveText('Scenario selected');
  await expect(result.locator('#assist-modal-title')).toHaveText('Documentation Updater');
  await expect(result.locator('#assist-modal-request')).toHaveText(request);
  await expect(page.locator('input[name="archetype"][value="documentation-updater"]')).toBeChecked();
  await expect(page.locator('#wizard-assist-progress-field')).toBeHidden();

  const inference = await page.evaluate(() => globalThis.__webLlmE2E);
  expect(inference).toMatchObject({
    task: 'text-generation',
    model: 'onnx-community/Qwen2.5-0.5B-Instruct',
    calls: 1,
    generationOptions: {
      max_new_tokens: 24,
      do_sample: false,
      return_full_text: false
    }
  });
  expect(inference.messages.at(-1)).toEqual({ role: 'user', content: request });
});
