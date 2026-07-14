import type { CodingResponse } from '../../contracts/index.js';
import {
  NOTE_AND_CODING_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  PollFailedError,
  pollUntilComplete,
  sleep,
} from '../poll-until-complete.js';
import { createFormWorkflow } from './form-workflow.js';
import { buildCodingRequest, formatCodingResult } from './workflow-data.js';

function classify(response: CodingResponse): 'pending' | 'complete' | 'failed' {
  if (response.data.status === 'completed') return 'complete';
  if (response.data.status === 'failed') return 'failed';
  return 'pending';
}

export function createCodingWorkflow() {
  return createFormWorkflow({
    id: 'coding',
    loadingMessage: 'Coding',
    async run(context, signal) {
      const input = context.form.querySelector<HTMLTextAreaElement>('textarea[name="text"]');
      if (!input) throw new Error('Coding form is missing clinical text.');
      const request = buildCodingRequest(input.value);
      context.workspace.setInput('coding', request.text);
      const created = await context.api.createCoding(request, signal);
      const final = classify(created) === 'pending'
        ? await pollUntilComplete({
            operation: (pollSignal) => context.api.getCoding(created.data.id, pollSignal),
            classify,
            intervalMs: POLL_INTERVAL_MS,
            deadlineMs: NOTE_AND_CODING_TIMEOUT_MS,
            signal,
            now: () => performance.now(),
            sleep,
          })
        : created;
      if (final.data.status !== 'completed') throw new PollFailedError(final);
      const formatted = formatCodingResult(final.data.result);
      return {
        output: { text: request.text, raw: final },
        result: { formatted, raw: final },
      };
    },
  });
}
