import { noteModeSchema, type NoteResponse } from '../../contracts/index.js';
import {
  NOTE_AND_CODING_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  PollFailedError,
  pollUntilComplete,
  sleep,
} from '../poll-until-complete.js';
import { createFormWorkflow } from './form-workflow.js';
import { buildNoteRequest } from './workflow-data.js';
import type { NoteFormInput } from './workflow-data.js';

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

function readNoteType(form: HTMLFormElement): NoteFormInput['noteType'] {
  const mode = noteModeSchema.parse(
    requireControl<HTMLSelectElement>(form, 'select[name="noteMode"]').value,
  );
  if (mode === 'soap') return { type: mode };
  if (mode === 'note_style') {
    return {
      type: mode,
      template: requireControl<HTMLTextAreaElement>(form, 'textarea[name="styleTemplate"]').value,
      includeJson: requireControl<HTMLInputElement>(form, 'input[name="includeJson"]').checked,
    };
  }
  return {
    type: mode,
    templateText: requireControl<HTMLTextAreaElement>(form, 'textarea[name="structuredTemplate"]').value,
  };
}

function mountModeControls(form: HTMLFormElement): () => void {
  const select = requireControl<HTMLSelectElement>(form, 'select[name="noteMode"]');
  const groups = [...form.querySelectorAll<HTMLElement>('[data-note-mode]')];
  const apply = () => {
    for (const group of groups) {
      const active = group.dataset.noteMode === select.value;
      group.hidden = !active;
      for (const control of group.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
        control.disabled = !active;
      }
    }
  };
  select.addEventListener('change', apply);
  apply();
  return () => select.removeEventListener('change', apply);
}

export function createNoteWorkflow() {
  return createFormWorkflow({
    id: 'notes',
    loadingMessage: 'Generating',
    mountExtra(context) {
      return mountModeControls(context.form);
    },
    async run(context, signal) {
      const transcript = requireControl<HTMLTextAreaElement>(context.form, 'textarea[name="transcript"]');
      const date = requireControl<HTMLInputElement>(context.form, 'input[name="date"]');
      const language = requireControl<HTMLSelectElement>(context.form, 'select[name="language"]');
      const request = buildNoteRequest({
        transcript: transcript.value,
        date: date.value,
        language: language.value,
        noteType: readNoteType(context.form),
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
