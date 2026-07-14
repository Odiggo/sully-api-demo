import assert from 'node:assert/strict';
import test from 'node:test';

import { copyResultText } from '../browser/result-view.js';

test('copies exact result text and announces success', async () => {
  const writes: string[] = [];
  const announcements: string[] = [];
  const errors: string[] = [];
  let focusCalls = 0;
  const copied = await copyResultText({
    text: 'Exact result\nwith spacing',
    clipboard: {
      async writeText(text) {
        writes.push(text);
      },
    },
    announce: (message) => announcements.push(message),
    showError: (message) => errors.push(message),
    restoreFocus: () => {
      focusCalls += 1;
    },
  });
  assert.equal(copied, true);
  assert.deepEqual(writes, ['Exact result\nwith spacing']);
  assert.deepEqual(announcements, ['Result copied to clipboard']);
  assert.deepEqual(errors, []);
  assert.equal(focusCalls, 1);
});

test('clipboard denial stays visible and preserves result text', async () => {
  const source = 'Do not mutate me';
  const errors: string[] = [];
  let focusCalls = 0;
  const copied = await copyResultText({
    text: source,
    clipboard: { writeText: async () => Promise.reject(new Error('denied')) },
    announce: () => undefined,
    showError: (message) => errors.push(message),
    restoreFocus: () => {
      focusCalls += 1;
    },
  });
  assert.equal(copied, false);
  assert.equal(source, 'Do not mutate me');
  assert.deepEqual(errors, ['Clipboard access was denied. Select and copy the result manually.']);
  assert.equal(focusCalls, 1);
});
