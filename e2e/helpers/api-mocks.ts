import type { Page } from '@playwright/test';

const TIMESTAMP = '2026-07-13T12:00:00.000Z';
const TRANSCRIPTION_COMPLETE = {
  data: {
    id: 'tr_demo',
    status: 'completed',
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    result: {
      channels: [{ transcript: 'Patient reports mild asthma.', confidence: 0.97 }],
    },
  },
};
const CODING_COMPLETE = {
  data: {
    id: 'coding_demo',
    status: 'completed',
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    result: {
      diagnoses: [
        {
          id: 'd1',
          code: {
            coding: [
              { system: 'ICD-10', code: 'J45.909', display: 'Unspecified asthma' },
            ],
            text: 'Asthma',
          },
          text_span: { start_char: 0, end_char: 6, text: 'asthma' },
        },
      ],
      procedures: [],
    },
  },
};

export interface CapturedRequest {
  method: string;
  path: string;
  body?: unknown;
}

export async function installApiMocks(page: Page): Promise<CapturedRequest[]> {
  const requests: CapturedRequest[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown;
    if (request.headers()['content-type']?.includes('application/json')) {
      body = request.postDataJSON();
    }
    requests.push({ method: request.method(), path: url.pathname, body });

    if (url.pathname === '/api/transcriptions' && request.method() === 'POST') {
      await route.fulfill({
        json: {
          data: {
            id: 'tr_demo',
            status: 'pending',
            created_at: TIMESTAMP,
            updated_at: TIMESTAMP,
          },
        },
      });
      return;
    }
    if (url.pathname === '/api/transcriptions/tr_demo') {
      await route.fulfill({ json: TRANSCRIPTION_COMPLETE });
      return;
    }
    if (url.pathname === '/api/notes' && request.method() === 'POST') {
      await route.fulfill({ json: { status: 'ok', data: { noteId: 'note_demo' }, date: TIMESTAMP } });
      return;
    }
    if (url.pathname === '/api/notes/note_demo') {
      await route.fulfill({ json: { status: 'ok', data: { id: 'note_demo', status: 'STATUS_DONE', payload: { markdown: '## Assessment\nMild asthma.' } }, date: TIMESTAMP } });
      return;
    }
    if (url.pathname === '/api/codings' && request.method() === 'POST') {
      await route.fulfill({
        json: {
          data: {
            id: 'coding_demo',
            status: 'processing',
            created_at: TIMESTAMP,
            updated_at: TIMESTAMP,
          },
        },
      });
      return;
    }
    if (url.pathname === '/api/codings/coding_demo') {
      await route.fulfill({ json: CODING_COMPLETE });
      return;
    }
    if (url.pathname === '/api/text-to-json') {
      await route.fulfill({ json: { data: { age: 42, warning: '<img src=x onerror=window.__unsafe=true>' } } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'mock-request' } } });
  });
  return requests;
}
