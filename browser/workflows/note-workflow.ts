import type { NoteResponse } from '../../contracts/index.js';
import {
  NOTE_AND_CODING_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  PollFailedError,
  pollUntilComplete,
  sleep,
} from '../poll-until-complete.js';
import { createFormWorkflow } from './form-workflow.js';
import { buildNoteRequest } from './workflow-data.js';

function requireControl<ElementType extends Element>(form: HTMLFormElement, selector: string): ElementType {
  const control = form.querySelector<ElementType>(selector);
  if (!control) throw new Error(`Note form is missing ${selector}`);
  return control;
}

function classify(response: NoteResponse): 'pending' | 'complete' | 'failed' {
  if (response.data.status === 'STATUS_DONE') return 'complete';
  if (response.data.status === 'STATUS_ERROR') return 'failed';
  return 'pending';
}

export function createNoteWorkflow() {
  return createFormWorkflow({
    id: 'notes',
    loadingMessage: 'Generating',
    async run(context, signal) {
      const transcript = requireControl<HTMLTextAreaElement>(context.form, 'textarea[name="transcript"]');
      const date = requireControl<HTMLInputElement>(context.form, 'input[name="date"]');
      const language = requireControl<HTMLSelectElement>(context.form, 'select[name="language"]');
      const template = requireControl<HTMLTextAreaElement>(context.form, 'textarea[name="template"]');
      const includeJson = requireControl<HTMLInputElement>(context.form, 'input[name="includeJson"]');
      const request = buildNoteRequest({
        transcript: transcript.value,
        date: date.value,
        language: language.value,
        template: template.value,
        includeJson: includeJson.checked,
      });
      context.workspace.setInput('notes', request.transcript);
      const created = await context.api.createNote(request, signal);
      const final = await pollUntilComplete({
        operation: (pollSignal) => context.api.getNote(created.data.noteId, pollSignal),
        classify,
        intervalMs: POLL_INTERVAL_MS,
        deadlineMs: NOTE_AND_CODING_TIMEOUT_MS,
        signal,
        now: () => performance.now(),
        sleep,
      });
      if (final.data.status !== 'STATUS_DONE') throw new PollFailedError(final);
      const markdown = final.data.payload.markdown?.trim();
      const formatted = markdown || JSON.stringify(final.data.payload.json, null, 2);
      return {
        output: {
          markdown,
          json: final.data.payload.json,
          raw: final,
        },
        result: { formatted, raw: final },
      };
    },
  });
}
