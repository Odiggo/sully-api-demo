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
  await expect(page.getByText('Sully API · uploads temp', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Local API is ready. Your API key remains on the server.'),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Clinical dataMemory only');
});

test('exposes live streaming status and transcript updates to assistive technology', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-result-view="streaming"] [data-result-status]')).toHaveAttribute(
    'role',
    'status',
  );
  await expect(page.locator('[data-result-view="streaming"] [data-result-formatted]')).toHaveAttribute(
    'aria-live',
    'polite',
  );
});

test('offers every documented transcription locale plus streaming auto-detect', async ({ page }) => {
  await page.goto('/');
  const streaming = page.locator('[data-workflow-form="streaming"] select[name="language"]');
  const upload = page.locator('[data-workflow-form="transcription"] select[name="language"]');
  await expect(streaming.locator('option')).toHaveCount(90);
  await expect(upload.locator('option')).toHaveCount(89);
  await expect(streaming.locator('option[value="multi"]')).toHaveCount(1);
  await expect(upload.locator('option[value="ar-AE"]')).toHaveCount(1);
});

test('has no automatically detectable WCAG 2.2 A/AA violations initially or in dialog', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.locator('[data-navigation-dialog]').evaluate((dialog: HTMLDialogElement) => {
    dialog.showModal();
  });
  const dialogResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(dialogResults.violations).toEqual([]);
});

test('has no mobile overflow or automatically detectable WCAG 2.2 A/AA violations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
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
  await expect(page.locator('[data-setup-status]')).toContainText('SULLY_API_KEY');
  const actions = page.locator('[data-api-action]');
  await expect(actions.first()).toBeDisabled();
});
