import {
  codingRequestSchema,
  noteRequestSchema,
  textToJsonRequestSchema,
  type CodingRequest,
  type NoteRequest,
  type TextToJsonRequest,
} from '../../contracts/index.js';

export interface TranscriptionFormInput {
  file: File;
  language: string;
  dictation: boolean;
  multichannel: boolean;
}

export interface NoteFormInput {
  transcript: string;
  date: string;
  language: string;
  template: string;
  includeJson: boolean;
}

export interface TextToJsonFormInput {
  text: string;
  schemaText: string;
}

export interface TranscriptResult {
  channels: Array<{ transcript: string; confidence: number }>;
}

interface CodingItem {
  system: string;
  code: string | number;
  display: string;
}

interface CodedFinding {
  id: string;
  code: { coding: CodingItem[]; text: string };
  text_span: { start_char: number; end_char: number; text: string };
}

export interface CodingResult {
  diagnoses: CodedFinding[];
  procedures: CodedFinding[];
}

export function buildTranscriptionFormData(input: TranscriptionFormInput): FormData {
  const form = new FormData();
  form.append('audio', input.file);
  form.append('language', input.language);
  form.append('dictation', String(input.dictation));
  form.append('multichannel', String(input.multichannel));
  return form;
}

export function buildNoteRequest(input: NoteFormInput): NoteRequest {
  return noteRequestSchema.parse({
    transcript: input.transcript,
    date: input.date,
    language: input.language,
    noteType: {
      type: 'note_style',
      template: input.template,
      includeJson: input.includeJson,
    },
  });
}

export function buildCodingRequest(text: string): CodingRequest {
  return codingRequestSchema.parse({ text });
}

export function buildTextToJsonRequest(input: TextToJsonFormInput): TextToJsonRequest {
  let schema: unknown;
  try {
    schema = JSON.parse(input.schemaText);
  } catch {
    throw new Error('Schema must be a valid JSON object.');
  }
  const parsed = textToJsonRequestSchema.safeParse({ text: input.text, schema });
  if (!parsed.success) throw new Error('Schema must be a valid JSON object.');
  return parsed.data;
}

export function transcriptText(result: TranscriptResult): string {
  return result.channels
    .map((channel) => channel.transcript.trim())
    .filter((transcript) => transcript.length > 0)
    .join('\n\n');
}

function formatFindings(title: string, findings: CodedFinding[]): string {
  if (findings.length === 0) return `${title}\nNo findings`;
  const lines = findings.map((finding, index) => {
    const codes = finding.code.coding
      .map((coding) => `${coding.display} — ${coding.system} ${coding.code}`)
      .join('; ');
    return `${index + 1}. ${codes}\n   Source: ${finding.text_span.text}`;
  });
  return `${title}\n${lines.join('\n\n')}`;
}

export function formatCodingResult(result: CodingResult): string {
  return [
    formatFindings('Diagnoses', result.diagnoses),
    formatFindings('Procedures', result.procedures),
  ].join('\n\n');
}
