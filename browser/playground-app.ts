import { createAppLifecycle, type AppDisposable } from './app-lifecycle.js';
import { createPlaygroundApi } from './playground-api.js';
import { createResultView, type ResultView } from './result-view.js';
import { createWorkflowNavigation, type WorkflowNavigation } from './workflow-navigation.js';
import {
  WORKFLOW_IDS,
  createWorkspaceState,
  type WorkflowId,
} from './workspace-state.js';
import {
  createPlaceholderWorkflow,
  type WorkflowController,
} from './workflows/workflow-controller.js';
import { createCodingWorkflow } from './workflows/coding-workflow.js';
import { createNoteWorkflow } from './workflows/note-workflow.js';
import { createTextToJsonWorkflow } from './workflows/text-to-json-workflow.js';
import { createTranscriptionWorkflow } from './workflows/transcription-workflow.js';

interface DomRegistry {
  tabs: Map<WorkflowId, HTMLButtonElement>;
  panels: Map<WorkflowId, HTMLElement>;
  forms: Map<WorkflowId, HTMLFormElement>;
  results: Map<WorkflowId, ResultView>;
}

function requireElement<ElementType extends Element>(
  selector: string,
  root: ParentNode = document,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Playground is missing ${selector}`);
  return element;
}

function createResultOptions() {
  const announcer = requireElement<HTMLElement>('[data-announcer]');
  const alert = requireElement<HTMLElement>('[data-global-alert]');
  return {
    clipboard: { writeText: (text: string) => navigator.clipboard.writeText(text) },
    announce(message: string) {
      announcer.textContent = '';
      queueMicrotask(() => {
        announcer.textContent = message;
      });
    },
    showError(message: string) {
      alert.textContent = message;
      alert.hidden = message.length === 0;
    },
  };
}

function createDomRegistry(): DomRegistry {
  const tabs = new Map<WorkflowId, HTMLButtonElement>();
  const panels = new Map<WorkflowId, HTMLElement>();
  const forms = new Map<WorkflowId, HTMLFormElement>();
  const results = new Map<WorkflowId, ResultView>();
  const resultOptions = createResultOptions();
  for (const id of WORKFLOW_IDS) {
    tabs.set(id, requireElement(`[data-workflow-tab="${id}"]`));
    panels.set(id, requireElement(`[data-workflow-panel="${id}"]`));
    forms.set(id, requireElement(`[data-workflow-form="${id}"]`));
    const resultRoot = requireElement<HTMLElement>(`[data-result-view="${id}"]`);
    results.set(id, createResultView(resultRoot, resultOptions));
  }
  return { tabs, panels, forms, results };
}

function applyActiveWorkflow(registry: DomRegistry, active: WorkflowId): void {
  for (const id of WORKFLOW_IDS) {
    const selected = id === active;
    const tab = registry.tabs.get(id);
    const panel = registry.panels.get(id);
    if (!tab || !panel) throw new Error(`Workflow DOM is incomplete for ${id}`);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected;
  }
}

function workflowFromHash(): WorkflowId {
  const candidate = location.hash.replace(/^#/, '');
  return WORKFLOW_IDS.find((id) => id === candidate) ?? 'streaming';
}

function mountTabControls(
  registry: DomRegistry,
  navigation: WorkflowNavigation,
): AppDisposable {
  const cleanups: Array<() => void> = [];
  const moveFocus = (index: number) => {
    const target = registry.tabs.get(WORKFLOW_IDS[index]);
    if (!target) return;
    for (const tab of registry.tabs.values()) tab.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  };
  for (const [index, id] of WORKFLOW_IDS.entries()) {
    const tab = registry.tabs.get(id);
    if (!tab) throw new Error(`Workflow tab is missing for ${id}`);
    const click = () => void navigation.activate(id);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') moveFocus((index + 1) % WORKFLOW_IDS.length);
      else if (event.key === 'ArrowLeft') moveFocus((index - 1 + WORKFLOW_IDS.length) % WORKFLOW_IDS.length);
      else if (event.key === 'Home') moveFocus(0);
      else if (event.key === 'End') moveFocus(WORKFLOW_IDS.length - 1);
      else if (event.key === 'Enter' || event.key === ' ') void navigation.activate(id);
      else return;
      event.preventDefault();
    };
    tab.addEventListener('click', click);
    tab.addEventListener('keydown', keydown);
    cleanups.push(() => {
      tab.removeEventListener('click', click);
      tab.removeEventListener('keydown', keydown);
    });
  }
  return { dispose: () => cleanups.forEach((cleanup) => cleanup()) };
}

function updateReadiness(ready: boolean, diagnostics: string[]): void {
  const connection = requireElement<HTMLElement>('[data-connection-state]');
  const connectionLabel = requireElement<HTMLElement>('[data-connection-label]');
  const setup = requireElement<HTMLElement>('[data-setup-status]');
  const setupMessage = requireElement<HTMLElement>('[data-setup-message]');
  connection.dataset.connectionState = ready ? 'ready' : 'blocked';
  connectionLabel.textContent = ready ? 'API ready' : 'Setup required';
  setup.dataset.ready = String(ready);
  setupMessage.textContent = ready
    ? 'Local API is ready. Credentials remain on the server.'
    : `Add or fix ${diagnostics.join(', ')} in .env, then restart the playground.`;
  for (const action of document.querySelectorAll<HTMLButtonElement>('[data-api-action]')) {
    action.disabled = !ready;
  }
}

async function bootstrap(): Promise<void> {
  const api = createPlaygroundApi({ fetch: globalThis.fetch.bind(globalThis) });
  const workspace = createWorkspaceState();
  const registry = createDomRegistry();
  const controllers: WorkflowController[] = [
    createPlaceholderWorkflow('streaming'),
    createTranscriptionWorkflow(),
    createNoteWorkflow(),
    createCodingWorkflow(),
    createTextToJsonWorkflow(),
  ];
  const initialWorkflow = workflowFromHash();
  const navigation = createWorkflowNavigation({
    initial: initialWorkflow,
    workflows: controllers,
    workspace,
    onActivate: (id) => {
      applyActiveWorkflow(registry, id);
      history.replaceState(null, '', `#${id}`);
    },
  });
  const lifecycle = createAppLifecycle({ workspace, disposables: controllers });
  void lifecycle.add(mountTabControls(registry, navigation));
  for (const result of registry.results.values()) void lifecycle.add(result);

  const resultOptions = createResultOptions();
  for (const controller of controllers) {
    const form = registry.forms.get(controller.id);
    const panel = registry.panels.get(controller.id);
    const result = registry.results.get(controller.id);
    if (!form || !panel || !result) throw new Error(`Workflow context is missing for ${controller.id}`);
    controller.mount({
      api,
      workspace,
      form,
      panel,
      result,
      announce: resultOptions.announce,
      showError: resultOptions.showError,
      activate: (id) => navigation.activate(id),
    });
  }
  applyActiveWorkflow(registry, initialWorkflow);
  window.addEventListener('pagehide', () => void lifecycle.dispose(), { once: true });

  try {
    const health = await api.getHealth();
    updateReadiness(health.ok, [...health.missing, ...health.invalid]);
  } catch {
    updateReadiness(false, ['local API connection']);
  }
}

bootstrap().catch(() => {
  const alert = document.querySelector<HTMLElement>('[data-global-alert]');
  if (alert) {
    alert.textContent = 'Playground could not start. Check the local server and reload.';
    alert.hidden = false;
  }
});
