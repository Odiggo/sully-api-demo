import { PlaygroundApiError } from '../playground-api.js';
import type { ResultPayload } from '../result-view.js';
import { WORKFLOW_IDS, type WorkflowId } from '../workspace-state.js';
import type { WorkflowContext, WorkflowController } from './workflow-controller.js';

export interface WorkflowExecution {
  output: unknown;
  result: ResultPayload;
}

export interface FormWorkflowSpec {
  id: WorkflowId;
  loadingMessage: string;
  run(context: WorkflowContext, signal: AbortSignal): Promise<WorkflowExecution>;
  mountExtra?(context: WorkflowContext): void | (() => void);
  deactivateExtra?(): void | Promise<void>;
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof PlaygroundApiError && error.code === 'LOCAL_API_ABORTED')
  );
}

function safeError(error: unknown): PlaygroundApiError {
  if (error instanceof PlaygroundApiError) return error;
  const message = error instanceof Error ? error.message : 'Workflow could not be completed.';
  return new PlaygroundApiError('WORKFLOW_FAILED', message);
}

function targetInput(workflow: WorkflowId): HTMLTextAreaElement | undefined {
  const fieldName = workflow === 'notes' ? 'transcript' : 'text';
  return document.querySelector<HTMLTextAreaElement>(
    `[data-workflow-form="${workflow}"] textarea[name="${fieldName}"]`,
  ) ?? undefined;
}

function mountHandoffs(context: WorkflowContext): () => void {
  const buttons = [...context.panel.querySelectorAll<HTMLButtonElement>('[data-handoff]')];
  const cleanups: Array<() => void> = [];
  for (const button of buttons) {
    const [fromValue, toValue] = button.dataset.handoff?.split(':') ?? [];
    const from = WORKFLOW_IDS.find((id) => id === fromValue);
    const to = WORKFLOW_IDS.find((id) => id === toValue);
    if (!from || !to || from !== context.panel.dataset.workflowPanel) continue;
    const click = async () => {
      if (context.workspace.handoff({ from, to })) {
        const input = targetInput(to);
        if (input) input.value = context.workspace.snapshot()[to].input;
        if (await context.activate(to)) input?.focus();
      }
    };
    const handleClick = () => void click();
    button.addEventListener('click', handleClick);
    cleanups.push(() => button.removeEventListener('click', handleClick));
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}

function setHandoffDisabled(context: WorkflowContext, disabled: boolean): void {
  for (const button of context.panel.querySelectorAll<HTMLButtonElement>('[data-handoff]')) {
    button.disabled = disabled;
  }
}

export function createFormWorkflow(spec: FormWorkflowSpec): WorkflowController {
  let context: WorkflowContext | undefined;
  let removeExtra: (() => void) | undefined;
  let removeHandoffs: (() => void) | undefined;

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!context) return;
    context.showError('');
    setHandoffDisabled(context, true);
    const submitButton = context.form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    const ticket = context.workspace.beginRun(spec.id);
    context.result.setLoading(spec.loadingMessage);
    try {
      const execution = await spec.run(context, ticket.signal);
      if (!context.workspace.completeRun(ticket, execution.output)) return;
      context.result.setResult(execution.result);
      setHandoffDisabled(context, false);
      context.announce(`${spec.id} workflow complete`);
    } catch (error: unknown) {
      if (isAbort(error)) return;
      const safe = safeError(error);
      if (!context.workspace.failRun(ticket, safe)) return;
      context.result.setError(safe.message);
      context.showError(safe.message);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  };

  return {
    id: spec.id,
    mount(nextContext) {
      context = nextContext;
      context.form.addEventListener('submit', submit);
      removeHandoffs = mountHandoffs(context);
      const cleanup = spec.mountExtra?.(context);
      if (cleanup) removeExtra = cleanup;
    },
    canDeactivate: async () => true,
    async deactivate() {
      await spec.deactivateExtra?.();
      context?.workspace.abortRun(spec.id);
    },
    async dispose() {
      await spec.deactivateExtra?.();
      context?.workspace.abortRun(spec.id);
      context?.form.removeEventListener('submit', submit);
      removeExtra?.();
      removeHandoffs?.();
    },
  };
}
