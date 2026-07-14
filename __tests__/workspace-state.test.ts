import assert from 'node:assert/strict';
import test from 'node:test';

import { PlaygroundApiError } from '../browser/playground-api.js';
import { createWorkspaceState } from '../browser/workspace-state.js';

test('replacement run aborts prior work and rejects stale writes', () => {
  const state = createWorkspaceState();
  const oldRun = state.beginRun('notes');
  const newRun = state.beginRun('notes');
  assert.equal(oldRun.signal.aborted, true);
  assert.equal(state.completeRun(oldRun, { markdown: 'old' }), false);
  assert.equal(state.completeRun(newRun, { markdown: 'new' }), true);
  assert.deepEqual(state.snapshot().notes.output, { markdown: 'new' });
});

test('handoff transfers exact text only after explicit action', () => {
  const state = createWorkspaceState();
  state.setOutput('transcription', { text: 'Patient text' });
  assert.equal(state.snapshot().notes.input, '');
  assert.equal(state.handoff({ from: 'transcription', to: 'notes' }), true);
  assert.equal(state.snapshot().notes.input, 'Patient text');
});

test('normalizes note JSON handoff only when explicitly requested', () => {
  const state = createWorkspaceState();
  state.setOutput('notes', { json: { section: 'Assessment' } });
  assert.equal(state.handoff({ from: 'notes', to: 'coding' }), true);
  assert.equal(state.snapshot().coding.input, '{\n  "section": "Assessment"\n}');
});

test('failure and abort apply only to current run', () => {
  const state = createWorkspaceState();
  const run = state.beginRun('coding');
  const error = new PlaygroundApiError('LOCAL_API_TIMEOUT', 'Timed out');
  assert.equal(state.failRun(run, error), true);
  assert.equal(state.snapshot().coding.status, 'error');
  assert.equal(state.failRun(run, error), false);
  const next = state.beginRun('coding');
  state.abortRun('coding');
  assert.equal(next.signal.aborted, true);
  assert.equal(state.completeRun(next, {}), false);
});

test('dispose aborts every active run and rejects all late writes', () => {
  const state = createWorkspaceState();
  const note = state.beginRun('notes');
  const coding = state.beginRun('coding');
  state.dispose();
  assert.equal(note.signal.aborted, true);
  assert.equal(coding.signal.aborted, true);
  assert.equal(state.completeRun(note, {}), false);
  assert.equal(state.completeRun(coding, {}), false);
  const lateRun = state.beginRun('notes');
  assert.equal(lateRun.signal.aborted, true);
  assert.equal(state.completeRun(lateRun, {}), false);
});
