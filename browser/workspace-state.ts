import type { PlaygroundApiError } from './playground-api.js';

export const WORKFLOW_IDS = [
  'streaming',
  'transcription',
  'notes',
  'coding',
  'text-to-json',
] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];
export type WorkflowStatus = 'idle' | 'running' | 'complete' | 'error';

export interface WorkflowSnapshot {
  input: string;
  output?: unknown;
  status: WorkflowStatus;
  error?: PlaygroundApiError;
}

export type WorkspaceSnapshot = Record<WorkflowId, WorkflowSnapshot>;

export interface RunTicket {
  readonly workflow: WorkflowId;
  readonly generation: number;
  readonly signal: AbortSignal;
}

interface OwnedRun extends RunTicket {
  controller: AbortController;
}

export interface Handoff {
  from: WorkflowId;
  to: WorkflowId;
}

export interface StoragePort {
  setItem(key: string, value: string): void;
}

export interface WorkspaceState {
  beginRun(workflow: WorkflowId): RunTicket;
  completeRun(ticket: RunTicket, result: unknown): boolean;
  failRun(ticket: RunTicket, error: PlaygroundApiError): boolean;
  abortRun(workflow: WorkflowId): void;
  setInput(workflow: WorkflowId, input: string): void;
  setOutput(workflow: WorkflowId, output: unknown): void;
  handoff(input: Handoff): boolean;
  snapshot(): WorkspaceSnapshot;
  dispose(): void;
}

export interface CreateWorkspaceStateOptions {
  storage?: StoragePort;
}

function initialSnapshot(): WorkspaceSnapshot {
  return {
    streaming: { input: '', status: 'idle' },
    transcription: { input: '', status: 'idle' },
    notes: { input: '', status: 'idle' },
    coding: { input: '', status: 'idle' },
    'text-to-json': { input: '', status: 'idle' },
  };
}

function handoffText(output: unknown): string | undefined {
  if (typeof output === 'string' && output.trim()) return output;
  if (!output || typeof output !== 'object') return undefined;
  if ('text' in output && typeof output.text === 'string' && output.text.trim()) {
    return output.text;
  }
  if ('markdown' in output && typeof output.markdown === 'string' && output.markdown.trim()) {
    return output.markdown;
  }
  if ('json' in output && output.json !== undefined) {
    try {
      return JSON.stringify(output.json, null, 2);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function createWorkspaceState(
  _options: CreateWorkspaceStateOptions = {},
): WorkspaceState {
  const state = initialSnapshot();
  const active = new Map<WorkflowId, OwnedRun>();
  let generation = 0;
  let disposed = false;

  const isCurrent = (ticket: RunTicket): boolean => {
    const owned = active.get(ticket.workflow);
    return !disposed && owned?.generation === ticket.generation && !owned.signal.aborted;
  };

  const finish = (
    ticket: RunTicket,
    update: (workflow: WorkflowSnapshot) => void,
  ): boolean => {
    if (!isCurrent(ticket)) return false;
    update(state[ticket.workflow]);
    active.delete(ticket.workflow);
    return true;
  };

  return {
    beginRun(workflow) {
      active.get(workflow)?.controller.abort();
      const controller = new AbortController();
      const ticket: OwnedRun = { workflow, generation: ++generation, signal: controller.signal, controller };
      if (disposed) {
        controller.abort();
        return ticket;
      }
      active.set(workflow, ticket);
      state[workflow].status = 'running';
      state[workflow].error = undefined;
      return ticket;
    },
    completeRun: (ticket, result) =>
      finish(ticket, (workflow) => {
        workflow.status = 'complete';
        workflow.output = result;
        workflow.error = undefined;
      }),
    failRun: (ticket, error) =>
      finish(ticket, (workflow) => {
        workflow.status = 'error';
        workflow.error = error;
      }),
    abortRun(workflow) {
      active.get(workflow)?.controller.abort();
      active.delete(workflow);
      if (!disposed) state[workflow].status = 'idle';
    },
    setInput(workflow, input) {
      if (!disposed) state[workflow].input = input;
    },
    setOutput(workflow, output) {
      if (!disposed) state[workflow].output = output;
    },
    handoff({ from, to }) {
      if (disposed) return false;
      const text = handoffText(state[from].output);
      if (text === undefined) return false;
      state[to].input = text;
      return true;
    },
    snapshot: () => ({
      streaming: { ...state.streaming },
      transcription: { ...state.transcription },
      notes: { ...state.notes },
      coding: { ...state.coding },
      'text-to-json': { ...state['text-to-json'] },
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const run of active.values()) run.controller.abort();
      active.clear();
    },
  };
}
