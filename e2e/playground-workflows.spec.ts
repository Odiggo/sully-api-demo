import { expect, test } from '@playwright/test';

import { installApiMocks } from './helpers/api-mocks.js';

test('runs transcription, note handoff, note generation, and coding', async ({ page }) => {
  const requests = await installApiMocks(page);
  await page.goto('/');

  await page.getByRole('tab', { name: /Transcription/ }).click();
  await page.getByLabel('Choose an audio file').setInputFiles({
    name: 'sample.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('RIFF'),
  });
  await page.getByRole('button', { name: 'Transcribe audio' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Transcription' })).toContainText(
    'Patient reports mild asthma.',
  );
  await page.getByRole('button', { name: 'Use for note' }).click();
  await expect(page.getByRole('tab', { name: /Note generation/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('textbox', { name: 'Transcript', exact: true })).toHaveValue(
    'Patient reports mild asthma.',
  );

  await page.getByLabel('Encounter date').fill('2026-07-13');
  await page.getByRole('button', { name: 'Generate note' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Note generation' })).toContainText('Mild asthma.');
  await page.getByRole('button', { name: 'Send to coding' }).click();
  await expect(page.getByLabel('Clinical text')).toHaveValue('## Assessment\nMild asthma.');
  await page.getByRole('button', { name: 'Run medical coding' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Medical coding' })).toContainText('J45.909');

  expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
    'POST /api/transcriptions',
    'POST /api/notes',
    'GET /api/notes/note_demo',
    'POST /api/codings',
  ]);
  expect(requests[1]?.body).toEqual({
    transcript: 'Patient reports mild asthma.',
    date: '2026-07-13',
    language: 'en',
    noteType: {
      type: 'note_style',
      template: 'SOAP note with Subjective, Objective, Assessment, and Plan sections.',
      includeJson: false,
    },
  });
  expect(requests[3]?.body).toEqual({ text: '## Assessment\nMild asthma.' });
});

test('loads bundled audio through the same transcription path', async ({ page }) => {
  const requests = await installApiMocks(page);
  await page.goto('/#transcription');
  await page.getByRole('button', { name: 'Use bundled sample' }).click();
  await expect(page.getByRole('button', { name: 'Bundled sample selected' })).toBeVisible();
  await page.getByRole('button', { name: 'Transcribe audio' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Transcription' })).toContainText(
    'Patient reports mild asthma.',
  );
  expect(requests.map(({ path }) => path)).toEqual(['/api/transcriptions']);
});

test('validates schema locally and renders text-to-JSON output as inert text', async ({ page }) => {
  const requests = await installApiMocks(page);
  await page.goto('/#text-to-json');
  await page.getByLabel('Source text').fill('Patient is 42 years old.');
  await page.getByLabel('Output schema (JSON object)').fill('{');
  await page.getByRole('button', { name: 'Convert to JSON' }).click();
  await expect(page.getByRole('alert')).toContainText('valid JSON object');
  expect(requests).toEqual([]);

  await page.getByLabel('Output schema (JSON object)').fill('{"age":"number"}');
  await page.getByRole('button', { name: 'Convert to JSON' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Text to JSON' });
  await expect(panel).toContainText('"age": 42');
  await expect(panel).toContainText('<img src=x onerror=window.__unsafe=true>');
  await expect(panel.locator('img')).toHaveCount(0);
  expect(requests.map(({ path }) => path)).toEqual(['/api/text-to-json']);
  expect(requests[0]?.body).toEqual({
    text: 'Patient is 42 years old.',
    schema: { age: 'number' },
  });
});
