import { expect, test } from '@playwright/test';

test('main start serves the browser demo without page errors', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');

  await expect(page).toHaveTitle('Sully API Playground');
  await expect(page.getByRole('heading', { name: 'Sully API Playground' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('main start exposes a health endpoint', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
});
