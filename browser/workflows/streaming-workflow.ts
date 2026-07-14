import { joinTranscriptSegments } from '../../dictation-layout.js';
import { PlaygroundApiError } from '../playground-api.js';
import {
  SullyStreamingDemo,
  type SessionPhase,
  type StreamEndReason,
  type StreamingConfig,
  type StreamingTransport,
  type TranscriptSegment,
  type TranscriptWord,
} from '../../sully-browser-demo.js';
import {
  loadStreamingPreferences,
  saveStreamingPreferences,
} from '../../demo-ui.js';
import type { WorkflowContext, WorkflowController } from './workflow-controller.js';

export interface StreamingCoordinator {
  start(): Promise<void>;
  stop(reason?: StreamEndReason): Promise<void>;
  canDeactivate(): Promise<boolean>;
  deactivate(): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateStreamingCoordinatorOptions {
  transport: StreamingTransport;
  confirmStop: () => Promise<boolean>;
}

export function createStreamingCoordinator(
  options: CreateStreamingCoordinatorOptions,
): StreamingCoordinator {
  const isActive = () => !['idle', 'error'].includes(options.transport.getPhase());
  return {
    start: () => options.transport.start(),
    stop: (reason = 'manual') => options.transport.stop(reason),
    canDeactivate: async () => !isActive() || options.confirmStop(),
    deactivate: () => (isActive() ? options.transport.stop('navigation') : Promise.resolve()),
    dispose: () => options.transport.stop('pagehide'),
  };
}

export interface CreateStreamingWorkflowOptions {
  createTransport?: (config: StreamingConfig) => StreamingTransport;
  confirmStop?: () => Promise<boolean>;
}

function requireControl<ElementType extends Element>(root: ParentNode, selector: string): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Streaming workflow is missing ${selector}`);
  return element;
}

function createDialogConfirmation(): () => Promise<boolean> {
  const dialog = requireControl<HTMLDialogElement>(document, '[data-navigation-dialog]');
  let pending: Promise<boolean> | undefined;
  return () => {
    if (pending) return pending;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
    pending = new Promise((resolve) => {
      dialog.addEventListener(
        'close',
        () => {
          const confirmed = dialog.returnValue === 'confirm';
          pending = undefined;
          previousFocus?.focus();
          resolve(confirmed);
        },
        { once: true },
      );
      dialog.showModal();
    });
    return pending;
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

interface StreamingWorkflowState {
  context?: WorkflowContext;
  transport?: StreamingTransport;
  coordinator?: StreamingCoordinator;
  ticket?: ReturnType<WorkflowContext['workspace']['beginRun']>;
  segments: TranscriptSegment[];
  words?: TranscriptWord[];
  phase: SessionPhase;
  cleanups: Array<() => void>;
}

interface StreamingControls {
  language: HTMLSelectElement;
  expiresIn: HTMLSelectElement;
  dictation: HTMLInputElement;
  wordDebug: HTMLInputElement;
  stopButton: HTMLButtonElement;
  persist(): void;
}

function updateControls(state: StreamingWorkflowState, nextPhase: SessionPhase): void {
  const context = state.context;
  if (!context) return;
  state.phase = nextPhase;
  const active = !['idle', 'error'].includes(nextPhase);
  requireControl<HTMLButtonElement>(context.form, '[data-stream-start]').disabled = active;
  requireControl<HTMLButtonElement>(context.form, '[data-stream-stop]').disabled = !active;
  for (const control of context.form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    'select, input',
  )) {
    control.disabled = active;
  }
  if (nextPhase === 'preparing') context.result.setLoading('Preparing');
}

function renderTranscript(state: StreamingWorkflowState): void {
  const { context, ticket } = state;
  if (!context || !ticket || ticket.signal.aborted) return;
  const text = joinTranscriptSegments(state.segments);
  const debug = requireControl<HTMLInputElement>(context.form, 'input[name="wordDebug"]');
  context.workspace.setOutput('streaming', { text });
  context.result.setLive({
    formatted: text || 'Listening…',
    copyText: text,
    raw: debug.checked ? { segments: state.segments, words: state.words } : { segments: state.segments },
  });
}

function createTransportConfig(state: StreamingWorkflowState): StreamingConfig {
  return {
    createStreamingToken: (seconds, signal) =>
      state.context?.api.createStreamingToken(seconds, signal) ??
      Promise.reject(new Error('Streaming context unavailable')),
    onPhaseChange: (phase) => updateControls(state, phase),
    onTranscription(update) {
      state.segments = update.segments;
      state.words = update.words;
      renderTranscript(state);
    },
    onReconnectAttempt: ({ attempt, maxAttempts }) =>
      state.context?.showError(`Connection interrupted. Reconnecting (${attempt}/${maxAttempts})…`),
    onStreamError: ({ message }) => state.context?.showError(message),
    onError(error) {
      const { context, ticket } = state;
      if (context && ticket && context.workspace.failRun(ticket, errorToApiError(error))) {
        context.result.setError(error.message);
        context.showError(error.message);
      }
    },
    onComplete() {
      const { context, ticket } = state;
      if (!context || !ticket) return;
      const text = joinTranscriptSegments(state.segments);
      if (!context.workspace.completeRun(ticket, { text })) return;
      if (text) context.result.setResult({ formatted: text, raw: { segments: state.segments, words: state.words } });
      else context.result.clear('Start recording to see live transcript text.');
    },
  };
}

function loadControls(context: WorkflowContext): StreamingControls {
  const language = requireControl<HTMLSelectElement>(context.form, 'select[name="language"]');
  const expiresIn = requireControl<HTMLSelectElement>(context.form, 'select[name="expiresIn"]');
  const dictation = requireControl<HTMLInputElement>(context.form, 'input[name="dictation"]');
  const wordDebug = requireControl<HTMLInputElement>(context.form, 'input[name="wordDebug"]');
  const stopButton = requireControl<HTMLButtonElement>(context.form, '[data-stream-stop]');
  const preferences = loadStreamingPreferences();
  if ([...language.options].some((option) => option.value === preferences.language)) {
    language.value = preferences.language;
  }
  expiresIn.value = String(preferences.tokenExpiresIn);
  dictation.checked = preferences.dictation;
  wordDebug.checked = preferences.wordDebug;
  return {
    language,
    expiresIn,
    dictation,
    wordDebug,
    stopButton,
    persist: () =>
      saveStreamingPreferences({
        language: language.value,
        tokenExpiresIn: Number(expiresIn.value),
        dictation: dictation.checked,
        wordDebug: wordDebug.checked,
      }),
  };
}

function bindControls(state: StreamingWorkflowState, controls: StreamingControls): void {
  const context = state.context;
  const transport = state.transport;
  const coordinator = state.coordinator;
  if (!context || !transport || !coordinator) throw new Error('Streaming workflow is not mounted');
  const requestStop = (reason: StreamEndReason) => {
    void coordinator.stop(reason).catch(() => {
      context.showError('Streaming cleanup could not finish. Reload before starting again.');
    });
  };
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    context.showError('');
    controls.persist();
    state.segments = [];
    state.words = undefined;
    state.ticket = context.workspace.beginRun('streaming');
    transport.setLanguage(controls.language.value);
    transport.setDictation(controls.dictation.checked);
    transport.setTokenExpiresIn(Number(controls.expiresIn.value));
    await coordinator.start().catch(() => {
      context.showError('Streaming could not start. Check microphone access and retry.');
    });
  };
  const stop = () => requestStop('manual');
  const updateWordDebug = () => {
    controls.persist();
    renderTranscript(state);
  };
  const keydown = (event: KeyboardEvent) => {
    if (context.panel.hidden || event.code !== 'Space' || isEditableTarget(event.target)) return;
    event.preventDefault();
    if (state.phase === 'idle' || state.phase === 'error') context.form.requestSubmit();
    else requestStop('manual');
  };
  context.form.addEventListener('submit', submit);
  controls.stopButton.addEventListener('click', stop);
  controls.wordDebug.addEventListener('change', updateWordDebug);
  for (const control of [controls.language, controls.expiresIn, controls.dictation]) {
    control.addEventListener('change', controls.persist);
  }
  document.addEventListener('keydown', keydown);
  state.cleanups.push(
    () => context.form.removeEventListener('submit', submit),
    () => controls.stopButton.removeEventListener('click', stop),
    () => controls.wordDebug.removeEventListener('change', updateWordDebug),
    ...[controls.language, controls.expiresIn, controls.dictation].map(
      (control) => () => control.removeEventListener('change', controls.persist),
    ),
    () => document.removeEventListener('keydown', keydown),
  );
}

export function createStreamingWorkflow(
  options: CreateStreamingWorkflowOptions = {},
): WorkflowController {
  const state: StreamingWorkflowState = { segments: [], phase: 'idle', cleanups: [] };
  return {
    id: 'streaming',
    mount(context) {
      state.context = context;
      const factory = options.createTransport ?? ((config) => new SullyStreamingDemo(config));
      state.transport = factory(createTransportConfig(state));
      state.coordinator = createStreamingCoordinator({
        transport: state.transport,
        confirmStop: options.confirmStop ?? createDialogConfirmation(),
      });
      bindControls(state, loadControls(context));
      updateControls(state, 'idle');
    },
    canDeactivate: () => state.coordinator?.canDeactivate() ?? Promise.resolve(true),
    deactivate: () => state.coordinator?.deactivate() ?? Promise.resolve(),
    async dispose() {
      state.cleanups.splice(0).forEach((cleanup) => cleanup());
      await state.coordinator?.dispose();
    },
  };
}

function errorToApiError(error: Error): PlaygroundApiError {
  return new PlaygroundApiError('STREAMING_ERROR', error.message);
}
