import { expect, test } from '@playwright/test';

test('website loads and opens the wizard', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('GitHub Agentic Workflow Generator');
  await expect(page.getByRole('heading', { name: 'Automate your repository with AI agents' })).toBeVisible();

  await page.getByRole('button', { name: 'Create An Agentic Workflow' }).click();

  await expect(page.locator('#step-1')).toHaveClass(/active/);
  await expect(page.locator('#preview-code')).not.toBeEmpty();
});
