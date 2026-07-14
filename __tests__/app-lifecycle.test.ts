import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAppLifecycle,
  createPageLifecycleHandlers,
  type AppDisposable,
} from '../browser/app-lifecycle.js';
import { createWorkspaceState } from '../browser/workspace-state.js';

function disposable(name: string, events: string[], reject = false): AppDisposable {
  return {
    async dispose() {
      events.push(name);
      if (reject) throw new Error(`${name} failed`);
    },
  };
}

test('dispose synchronously invalidates runs and cleans every sibling once', async () => {
  const events: string[] = [];
  const workspace = createWorkspaceState();
  const ticket = workspace.beginRun('notes');
  const lifecycle = createAppLifecycle({
    workspace,
    disposables: [
      disposable('rest', events),
      disposable('poller', events, true),
      disposable('streaming', events),
    ],
  });
  const first = lifecycle.dispose();
  const second = lifecycle.dispose();
  assert.equal(first, second);
  assert.equal(ticket.signal.aborted, true);
  assert.equal(workspace.completeRun(ticket, { markdown: 'late' }), false);
  await first;
  assert.deepEqual(events, ['rest', 'poller', 'streaming']);
});

test('late registration is disposed immediately after lifecycle closes', async () => {
  const events: string[] = [];
  const lifecycle = createAppLifecycle({ workspace: createWorkspaceState() });
  await lifecycle.dispose();
  await lifecycle.add(disposable('late', events));
  assert.deepEqual(events, ['late']);
});

test('page lifecycle reloads a document restored from the back-forward cache', async () => {
  const events: string[] = [];
  const lifecycle = createAppLifecycle({
    workspace: createWorkspaceState(),
    disposables: [disposable('dispose', events)],
  });
  const handlers = createPageLifecycleHandlers({
    lifecycle,
    reload: () => events.push('reload'),
  });

  handlers.onPageHide();
  await lifecycle.dispose();
  handlers.onPageShow({ persisted: false });
  handlers.onPageShow({ persisted: true });

  assert.deepEqual(events, ['dispose', 'reload']);
});
