import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('exposes five keyboard-operable workflows', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(5);
  await tabs.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(tabs.nth(4)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tabs.nth(4)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Text to JSON' })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(tabs.nth(0)).toBeFocused();
});

test('states credential and transient upload boundaries precisely', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('API key', { exact: true })).toBeVisible();
  await expect(page.getByText('Sully + temp storage', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Local API is ready. Your API key remains on the server.'),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Clinical dataMemory only');
});

test('has no automatically detectable WCAG A/AA violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('boots its browser entrypoint without page or CSP errors', async ({ page }) => {
  const errors: Error[] = [];
  const violations: string[] = [];
  page.on('pageerror', (error) => errors.push(error));
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sully API Playground' })).toBeVisible();
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
});

test('keeps setup page usable while disabling API actions when health is not ready', async ({ page }) => {
  await page.route('**/health', (route) =>
    route.fulfill({
      json: { ok: false, missing: ['SULLY_API_KEY'], invalid: [] },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('SULLY_API_KEY');
  const actions = page.locator('[data-api-action]');
  await expect(actions.first()).toBeDisabled();
});
