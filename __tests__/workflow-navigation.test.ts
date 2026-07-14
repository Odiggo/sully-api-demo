import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkflowNavigation, type NavigationWorkflow } from '../browser/workflow-navigation.js';
import { createWorkspaceState } from '../browser/workspace-state.js';

function workflow(
  id: NavigationWorkflow['id'],
  events: string[],
  canDeactivate = true,
): NavigationWorkflow {
  return {
    id,
    canDeactivate: async () => canDeactivate,
    deactivate: async () => {
      events.push(`deactivate:${id}`);
    },
  };
}

test('awaits deactivation, aborts old run, then activates target', async () => {
  const events: string[] = [];
  const workspace = createWorkspaceState();
  const oldRun = workspace.beginRun('streaming');
  const navigation = createWorkflowNavigation({
    initial: 'streaming',
    workflows: [workflow('streaming', events), workflow('notes', events)],
    workspace,
    onActivate: (id) => events.push(`activate:${id}`),
  });
  assert.equal(await navigation.activate('notes'), true);
  assert.equal(oldRun.signal.aborted, true);
  assert.deepEqual(events, ['deactivate:streaming', 'activate:notes']);
  assert.equal(navigation.current(), 'notes');
});

test('refusal keeps current workflow and active run', async () => {
  const events: string[] = [];
  const workspace = createWorkspaceState();
  const run = workspace.beginRun('streaming');
  const navigation = createWorkflowNavigation({
    initial: 'streaming',
    workflows: [workflow('streaming', events, false), workflow('notes', events)],
    workspace,
    onActivate: (id) => events.push(`activate:${id}`),
  });
  assert.equal(await navigation.activate('notes'), false);
  assert.equal(run.signal.aborted, false);
  assert.equal(navigation.current(), 'streaming');
  assert.deepEqual(events, []);
});

test('same-workflow activation is idempotent', async () => {
  const events: string[] = [];
  const navigation = createWorkflowNavigation({
    initial: 'coding',
    workflows: [workflow('coding', events)],
    workspace: createWorkspaceState(),
    onActivate: (id) => events.push(`activate:${id}`),
  });
  assert.equal(await navigation.activate('coding'), true);
  assert.deepEqual(events, []);
});

test('failed deactivation stays on source workflow and reports the error', async () => {
  const errors: unknown[] = [];
  const navigation = createWorkflowNavigation({
    initial: 'streaming',
    workflows: [
      {
        id: 'streaming',
        canDeactivate: async () => true,
        deactivate: async () => {
          throw new Error('cleanup failed');
        },
      },
      workflow('notes', []),
    ],
    workspace: createWorkspaceState(),
    onActivate: () => undefined,
    onError: (error) => errors.push(error),
  });

  assert.equal(await navigation.activate('notes'), false);
  assert.equal(navigation.current(), 'streaming');
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /cleanup failed/);
});
