import { expect, test } from '@playwright/test';

test('website loads and opens the wizard', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('GitHub Agentic Workflow Generator');
  await expect(page.getByRole('heading', { name: 'Automate your repository with AI agents' })).toBeVisible();

  await page.getByRole('button', { name: 'Create Your Agentic Workflow' }).click();

  await expect(page.locator('#step-1')).toHaveClass(/active/);
  await expect(page.getByLabel('Tell us your intent so that we can generate graders and evals')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#step-2')).toHaveClass(/active/);
  await expect
    .poll(async () => page.locator('#archetype-options input[type="radio"]').count())
    .toBeGreaterThan(0);
  await expect(page.locator('#archetype-options input[type="radio"]').first()).toBeVisible();
});

test('landing phase labels do not wrap on iPhone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');

  const labels = page.locator('.ld-phase-label');
  await expect(labels).toHaveCount(3);
  for (const label of await labels.all()) {
    await expect(label).toHaveCSS('white-space', 'nowrap');
  }
});
