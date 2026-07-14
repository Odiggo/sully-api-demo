import type { PlaygroundApi } from '../playground-api.js';
import type { ResultView } from '../result-view.js';
import type { NavigationWorkflow } from '../workflow-navigation.js';
import type { WorkflowId, WorkspaceState } from '../workspace-state.js';

export interface WorkflowContext {
  api: PlaygroundApi;
  workspace: WorkspaceState;
  form: HTMLFormElement;
  panel: HTMLElement;
  result: ResultView;
  announce(message: string): void;
  showError(message: string): void;
  activate(workflow: WorkflowId): Promise<boolean>;
}

export interface WorkflowController extends NavigationWorkflow {
  mount(context: WorkflowContext): void;
  dispose(): Promise<void>;
}
