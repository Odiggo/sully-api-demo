import { expect, test } from '@playwright/test';

test('shows token failure without requesting microphone resources', async ({ page }) => {
  let tokenCalls = 0;
  await page.route('**/api/streaming-token', async (route) => {
    tokenCalls += 1;
    await route.fulfill({
      status: 502,
      json: {
        error: {
          code: 'UPSTREAM_HTTP_ERROR',
          message: 'Sully API rejected the token request',
          requestId: 'stream-request',
        },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('alert')).toContainText('rejected the token request');
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled();
  expect(tokenCalls).toBe(1);
});

test('requires explicit stop before switching during pending start', async ({ page }) => {
  let releaseToken: (() => void) | undefined;
  let tokenCalls = 0;
  await page.route('**/api/streaming-token', async (route) => {
    tokenCalls += 1;
    await new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    await route
      .fulfill({
        json: {
          token: 'late-token',
          apiUrl: 'https://api-testing.sully.ai/v1',
          accountId: 'account',
        },
      })
      .catch(() => undefined);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByText('Preparing', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Transcription/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Stop active workflow?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop and switch' }).click();
  await expect(page.getByRole('tab', { name: /Transcription/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  releaseToken?.();
  expect(tokenCalls).toBe(1);
});

test('persists only non-clinical streaming preferences', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Language').first().selectOption('es');
  await page.getByLabel('Token lifetime').selectOption('300');
  await page.getByLabel('Medical dictation').first().uncheck();
  await page.getByLabel('Word details').check();
  await page.reload();
  await expect(page.getByLabel('Language').first()).toHaveValue('es');
  await expect(page.getByLabel('Token lifetime')).toHaveValue('300');
  await expect(page.getByLabel('Medical dictation').first()).not.toBeChecked();
  await expect(page.getByLabel('Word details')).toBeChecked();
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys).toEqual([
    'sully-playground:streaming-dictation',
    'sully-playground:streaming-language',
    'sully-playground:streaming-token-expiry',
    'sully-playground:streaming-word-debug',
  ]);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
