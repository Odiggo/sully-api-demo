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
