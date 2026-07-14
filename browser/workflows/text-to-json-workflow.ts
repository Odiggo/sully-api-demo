import { createFormWorkflow } from './form-workflow.js';
import { buildTextToJsonRequest } from './workflow-data.js';

function requireTextArea(form: HTMLFormElement, name: string): HTMLTextAreaElement {
  const input = form.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`);
  if (!input) throw new Error(`Text-to-JSON form is missing ${name}.`);
  return input;
}

export function createTextToJsonWorkflow() {
  return createFormWorkflow({
    id: 'text-to-json',
    loadingMessage: 'Converting',
    async run(context, signal) {
      const request = buildTextToJsonRequest({
        text: requireTextArea(context.form, 'text').value,
        schemaText: requireTextArea(context.form, 'schema').value,
      });
      context.workspace.setInput('text-to-json', request.text);
      const response = await context.api.textToJson(request, signal);
      const formatted = JSON.stringify(response.data, null, 2);
      return {
        output: { json: response.data, raw: response },
        result: { formatted, raw: response },
      };
    },
  });
}
