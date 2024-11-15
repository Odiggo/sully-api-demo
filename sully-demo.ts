import * as dotenv from 'dotenv';
import fetch from 'node-fetch';
import FormData from 'form-data';
import * as fs from 'fs/promises';
import { existsSync, statSync } from 'fs';

// Load environment variables
dotenv.config();

// API configuration
//const SULLY_API_URL = 'https://dev01-copilot-api.np.services.sully.ai/api/v2/ext';
const SULLY_API_URL = 'https://dev01-copilot-chaitanya.np.services.sully.ai/api/v2/ext';
//const SULLY_API_URL = 'https://371a-66-75-242-172.ngrok-free.app/api/v2/ext';
const API_KEY = process.env.SULLY_API_KEY!;
const ACCOUNT_ID = process.env.SULLY_ACCOUNT_ID!;

// Constants
const SUPPORTED_AUDIO_FORMATS = ['.mp3', '.wav', '.m4a', '.ogg'];

// Type definitions
interface ApiResponse {
  status: "ok" | "error";
  data: any;
}

interface TranscriptionResponse extends ApiResponse {
  data: {
    transcriptionId: string;
    status: "STATUS_PROCESSING" | "STATUS_DONE" | "STATUS_ERROR";
    payload?: {
      transcription?: string;
    };
  };
}

interface NoteResponse extends ApiResponse {
  data: {
    noteId: string;
    status: "STATUS_PROCESSING" | "STATUS_DONE" | "STATUS_ERROR";
    payload?: {
      markdown?: string;
      json?: object;
    };
  };
}

// Helper function for API requests
async function makeRequest(endpoint: string, options: any = {}): Promise<any> {
  const url = `${SULLY_API_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'X-Api-Key': API_KEY,
    'X-Account-Id': ACCOUNT_ID,
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  } catch (error) {
    console.error('Request failed:', error);
    throw error;
  }
}

// API Functions
async function createNoteStyle(sampleNote: string, instructions: string[] = []): Promise<any> {
  return makeRequest('/note-styles', {
    method: 'POST',
    body: JSON.stringify({ sampleNote, instructions })
  });
}

async function transcribeAudio(audioPath: string): Promise<string> {
  validateAudioFile(audioPath);
  
  console.log('Reading audio file...');
  const audioBuffer = await fs.readFile(audioPath);
  
  console.log('Uploading audio...');
  const formData = new FormData();
  formData.append('audio', audioBuffer, { 
    filename: 'audio.mp3',
    contentType: 'audio/mpeg'
  });
  formData.append('language', 'en-US');

  const response = await makeRequest('/audio/transcribe', {
    method: 'POST',
    body: formData
  });

  const transcriptionId = response.data.transcriptionId;
  console.log('Transcription ID:', transcriptionId);

  let transcriptionResponse: TranscriptionResponse;
  do {
    console.log('Waiting for transcription...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    transcriptionResponse = await makeRequest(`/audio/transcriptions/${transcriptionId}`);
  } while (transcriptionResponse.data.status === 'STATUS_PROCESSING');

  if (transcriptionResponse.data.status === 'STATUS_ERROR') {
    throw new Error('Transcription failed');
  }

  return transcriptionResponse.data.payload?.transcription || '';
}

async function createNote(transcript: string): Promise<string> {
  const response = await makeRequest('/notes', {
    method: 'POST',
    body: JSON.stringify({
      transcript,
      date: new Date().toISOString().split('T')[0],
      noteType: {
        format: 'json',
        type: 'soap'
      }
    })
  });
  return response.data.noteId;
}

async function getNote(noteId: string): Promise<any> {
  let response = await makeRequest(`/notes/${noteId}`);
  
  while (response.data.status === 'STATUS_PROCESSING') {
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('Note still processing...');
    response = await makeRequest(`/notes/${noteId}`);
  }
  
  return response;
}

async function deleteNote(noteId: string): Promise<void> {
  await makeRequest(`/notes/${noteId}`, { method: 'DELETE' });
}

function validateAudioFile(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  const extension = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  if (!SUPPORTED_AUDIO_FORMATS.includes(extension)) {
    throw new Error(
      `Unsupported audio format: ${extension}\n` +
      `Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`
    );
  }

  const fileSizeInMB = statSync(filePath).size / (1024 * 1024);
  if (fileSizeInMB > 30) {
    throw new Error(
      `Audio file too large: ${fileSizeInMB.toFixed(1)}MB\n` +
      'Maximum file size: 30MB'
    );
  }
}

async function main(audioFilePath: string) {
  try {
    // Create note style
    console.log('\n=== Creating Note Style ===');
    await createNoteStyle(
      'CC: Headache\nHPI: Patient reports severe headache...',
      ['Use bullet points', 'Include vital signs']
    );
    console.log('Note style created successfully');

    // Transcribe audio
    console.log('\n=== Transcribing Audio ===');
    const transcription = await transcribeAudio(audioFilePath);
    console.log('Transcription complete');
    console.log('Text:', transcription);

    // Create note
    console.log('\n=== Creating Clinical Note ===');
    const noteId = await createNote(transcription);
    console.log('Note created:', noteId);

    // Get note
    console.log('\n=== Retrieving Note ===');
    const note = await getNote(noteId);
    console.log('Note content:', note.data.payload);

    // Clean up
    console.log('\n=== Cleaning Up ===');
    await deleteNote(noteId);
    console.log('Note deleted successfully');

  } catch (error: any) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

// Run the example with command line argument
if (require.main === module) {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error('Please provide the path to an audio file');
    console.error('Usage: npx ts-node sully-demo.ts path/to/audio-file.mp3');
    process.exit(1);
  }
  main(audioPath).catch((error: any) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}
