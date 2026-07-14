import type { WorkflowId, WorkspaceState } from './workspace-state.js';

export interface NavigationWorkflow {
  readonly id: WorkflowId;
  canDeactivate(): Promise<boolean>;
  deactivate(): Promise<void>;
}

export interface WorkflowNavigation {
  activate(target: WorkflowId): Promise<boolean>;
  current(): WorkflowId;
}

export interface CreateWorkflowNavigationOptions {
  initial: WorkflowId;
  workflows: NavigationWorkflow[];
  workspace: WorkspaceState;
  onActivate: (workflow: WorkflowId) => void;
  onError?: (error: unknown) => void;
}

export function createWorkflowNavigation(
  options: CreateWorkflowNavigationOptions,
): WorkflowNavigation {
  const workflows = new Map(options.workflows.map((workflow) => [workflow.id, workflow]));
  if (!workflows.has(options.initial)) throw new Error('Initial workflow is not registered');
  let current = options.initial;
  let transition: Promise<boolean> | undefined;

  async function change(target: WorkflowId): Promise<boolean> {
    if (target === current) return true;
    const source = workflows.get(current);
    const destination = workflows.get(target);
    if (!source || !destination) throw new Error('Workflow is not registered');
    if (!(await source.canDeactivate())) return false;
    await source.deactivate();
    options.workspace.abortRun(current);
    current = target;
    options.onActivate(target);
    return true;
  }

  return {
    activate(target) {
      if (transition) return transition;
      transition = change(target)
        .catch((error: unknown) => {
          options.onError?.(error);
          return false;
        })
        .finally(() => {
          transition = undefined;
        });
      return transition;
    },
    current: () => current,
  };
}
