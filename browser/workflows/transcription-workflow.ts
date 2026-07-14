import {
  POLL_INTERVAL_MS,
  TRANSCRIPTION_TIMEOUT_MS,
  PollFailedError,
  pollUntilComplete,
  sleep,
} from '../poll-until-complete.js';
import type { TranscriptionResponse } from '../../contracts/index.js';
import { createFormWorkflow } from './form-workflow.js';
import { buildTranscriptionFormData, transcriptText } from './workflow-data.js';

function requireControl<ElementType extends Element>(form: HTMLFormElement, selector: string): ElementType {
  const control = form.querySelector<ElementType>(selector);
  if (!control) throw new Error(`Transcription form is missing ${selector}`);
  return control;
}

function classify(response: TranscriptionResponse): 'pending' | 'complete' | 'failed' {
  if (response.data.status === 'completed') return 'complete';
  if (response.data.status === 'failed') return 'failed';
  return 'pending';
}

export function createTranscriptionWorkflow() {
  let sampleFile: File | undefined;
  let sampleController: AbortController | undefined;
  let sampleButton: HTMLButtonElement | undefined;
  const cancelSampleLoad = () => {
    sampleController?.abort();
    sampleController = undefined;
    if (sampleButton) sampleButton.disabled = false;
  };

  return createFormWorkflow({
    id: 'transcription',
    loadingMessage: 'Transcribing',
    mountExtra(context) {
      const button = requireControl<HTMLButtonElement>(context.form, '[data-use-sample]');
      sampleButton = button;
      const fileInput = requireControl<HTMLInputElement>(context.form, 'input[name="audio"]');
      const useSample = async () => {
        cancelSampleLoad();
        const controller = new AbortController();
        sampleController = controller;
        button.disabled = true;
        try {
          const loaded = await context.api.loadSampleAudio(controller.signal);
          if (controller.signal.aborted || sampleController !== controller) return;
          sampleFile = loaded;
          button.textContent = 'Bundled sample selected';
          context.announce('Bundled sample audio selected');
        } catch (error: unknown) {
          if (!controller.signal.aborted && sampleController === controller) {
            context.showError(error instanceof Error ? error.message : 'Unable to load sample audio.');
          }
        } finally {
          if (sampleController === controller) {
            sampleController = undefined;
            button.disabled = false;
          }
        }
      };
      const useUpload = () => {
        cancelSampleLoad();
        sampleFile = undefined;
        button.textContent = 'Use bundled sample';
      };
      button.addEventListener('click', useSample);
      fileInput.addEventListener('change', useUpload);
      return () => {
        cancelSampleLoad();
        button.removeEventListener('click', useSample);
        fileInput.removeEventListener('change', useUpload);
        sampleButton = undefined;
      };
    },
    deactivateExtra: cancelSampleLoad,
    async run(context, signal) {
      const fileInput = requireControl<HTMLInputElement>(context.form, 'input[name="audio"]');
      const language = requireControl<HTMLSelectElement>(context.form, 'select[name="language"]');
      const dictation = requireControl<HTMLInputElement>(context.form, 'input[name="dictation"]');
      const multichannel = requireControl<HTMLInputElement>(context.form, 'input[name="multichannel"]');
      const file = fileInput.files?.[0] ?? sampleFile;
      if (!file) throw new Error('Choose an audio file or select the bundled sample.');
      context.workspace.setInput('transcription', file.name);
      const created = await context.api.createTranscription(
        buildTranscriptionFormData({
          file,
          language: language.value,
          dictation: dictation.checked,
          multichannel: multichannel.checked,
        }),
        signal,
      );
      const final = classify(created) === 'pending'
        ? await pollUntilComplete({
            operation: (pollSignal) => context.api.getTranscription(created.data.id, pollSignal),
            classify,
            intervalMs: POLL_INTERVAL_MS,
            deadlineMs: TRANSCRIPTION_TIMEOUT_MS,
            signal,
            now: () => performance.now(),
            sleep,
          })
        : created;
      if (final.data.status !== 'completed') throw new PollFailedError(final);
      const text = transcriptText(final.data.result);
      if (!text) throw new Error('Transcription completed without transcript text.');
      return {
        output: { text, raw: final },
        result: { formatted: text, raw: final },
      };
    },
  });
}
