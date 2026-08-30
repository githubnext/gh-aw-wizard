import { expect, test } from '@playwright/test';

const webLlmRuntimeRoute = '**/slm/webllm.js';

const inferenceRuntime = `
  export const prebuiltAppConfig = {
    model_list: [
      { model_id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC' },
      { model_id: 'SmolLM2-360M-Instruct-q4f32_1-MLC' }
    ]
  };

  export async function CreateMLCEngine(model, options) {
    globalThis.__webLlmE2E = {
      model,
      cacheBackend: options.appConfig.cacheBackend,
      calls: 0
    };
    options.initProgressCallback({ progress: 0.5, text: 'Fetching model parameters' });
    options.initProgressCallback({ progress: 1, text: 'Finished loading model' });

    return {
      chat: {
        completions: {
          async create(generationOptions) {
            globalThis.__webLlmE2E.calls += 1;
            globalThis.__webLlmE2E.generationOptions = generationOptions;
            return {
              choices: [{
                message: { role: 'assistant', content: 'documentation-updater' }
              }]
            };
          }
        }
      }
    };
  }
`;

test('runs in-browser inference and applies the selected scenario', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get: () => ({})
    });

    test('loads the secret eval control only with evals=1', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'gpu', {
          configurable: true,
          get: () => ({})
        });
      });

      await page.goto('/');
      await expect(page.locator('#wizard-evals')).toHaveCount(0);

      await page.goto('/?evals=1');
      const evals = page.getByRole('button', { name: 'Run evals' });
      await expect(evals).toBeVisible();
      await expect(evals).toBeEnabled();
      await expect(page.locator('.intent-actions')).toContainText('Analyze');
      await expect(page.locator('.intent-actions')).toContainText('Run evals');
    });
  });
  await page.route(webLlmRuntimeRoute, (route) => route.fulfill({
    contentType: 'text/javascript',
    body: inferenceRuntime
  }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Create Your Agentic Workflow' }).click();

  // This would keyword-match Issue Triage, proving the model result wins over fallback matching.
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
  await expect(result.locator('#assist-modal-description')).toHaveText(
    'Copy the prompt, then run it with an agent in the repository you want to automate.'
  );
  await expect(result.getByRole('button', { name: 'Copy prompt' })).toHaveCSS(
    'background-image',
    /linear-gradient/
  );
  await expect(result.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  await expect(page.locator('input[name="archetype"][value="documentation-updater"]')).toBeChecked();
  await expect(page.locator('#wizard-assist-progress-field')).toBeHidden();

  const inference = await page.evaluate(() => globalThis.__webLlmE2E);
  expect(inference).toMatchObject({
    model: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    cacheBackend: 'cache',
    calls: 1,
    generationOptions: {
      max_tokens: 24,
      temperature: 0,
      stream: false
    }
  });
  expect(inference.generationOptions.messages.at(-1)).toEqual({ role: 'user', content: request });
});
