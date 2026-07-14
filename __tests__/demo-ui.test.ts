import assert from 'node:assert/strict';
import test from 'node:test';

import { loadStreamingPreferences, saveStreamingPreferences } from '../demo-ui.js';

test('storage denial falls back to defaults and never blocks preference writes', () => {
  const deniedStorage = {
    getItem(): string | null {
      throw new DOMException('denied', 'SecurityError');
    },
    setItem(): void {
      throw new DOMException('denied', 'SecurityError');
    },
  };

  assert.deepEqual(loadStreamingPreferences(deniedStorage), {
    language: 'en',
    tokenExpiresIn: 3_600,
    dictation: true,
    wordDebug: false,
  });
  assert.doesNotThrow(() =>
    saveStreamingPreferences(
      { language: 'es', tokenExpiresIn: 300, dictation: false, wordDebug: true },
      deniedStorage,
    ),
  );
});
