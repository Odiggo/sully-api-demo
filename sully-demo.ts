// Import required dependencies
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';
import FormData from 'form-data';
import * as fs from 'fs/promises';
import { existsSync, statSync } from 'fs';

// Load environment variables from .env file
dotenv.config();

// API configuration
//const SULLY_API_URL = 'https://dev01-copilot-api.np.services.sully.ai/api/v2/ext';
const SULLY_API_URL = 'https://dev01-copilot-chaitanya.np.services.sully.ai/api/v2/ext';
const API_KEY = process.env.SULLY_API_KEY!;
const ACCOUNT_ID = process.env.SULLY_ACCOUNT_ID!;

// Define supported audio file formats
const SUPPORTED_AUDIO_FORMATS = ['.mp3', '.wav', '.m4a', '.ogg'];

// Type definitions for API responses
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

// Logger utility for consistent console output formatting
const logger = {
  step: (message: string) => console.log(`\n🚀 ${message}`),
  info: (message: string) => console.log(`ℹ️  ${message}`),
  success: (message: string) => console.log(`✅ ${message}`),
  warning: (message: string) => console.log(`⚠️  ${message}`),
  error: (message: string) => console.error(`❌ ${message}`),
  json: (label: string, data: any) => {
    // Special handling for SOAP note format
    if (typeof data === 'object' && data.soap) {
      console.log(`📋 ${label}:`);
      console.log(JSON.stringify({
        soap: {
          subjective: {
            chiefComplaint: data.soap.subjective?.chiefComplaint || '',
            hpi: data.soap.subjective?.hpi || {},
            pmh: data.soap.subjective?.pmh || {}
          }
        }
      }, null, 2));
    } else {
      console.log(`📋 ${label}:\n${JSON.stringify(data, null, 2)}`);
    }
  }
};

// Generic API request handler with error handling
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

// Create a new note style template with sample format
async function createNoteStyle(sampleNote: string, instructions: string[] = []): Promise<any> {
  return makeRequest('/note-styles', {
    method: 'POST',
    body: JSON.stringify({ sampleNote, instructions })
  });
}

// Handle audio transcription with progress tracking
async function transcribeAudio(audioPath: string): Promise<string> {
  validateAudioFile(audioPath);
  
  logger.info('Reading audio file...');
  const audioBuffer = await fs.readFile(audioPath);
  
  logger.info('Uploading audio...');
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
  logger.info(`Transcription ID: ${transcriptionId}`);

  // Poll for transcription completion
  let transcriptionResponse: TranscriptionResponse;
  let attempts = 0;
  do {
    if (attempts > 0) {
      logger.info('Waiting for transcription...');
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    transcriptionResponse = await makeRequest(`/audio/transcriptions/${transcriptionId}`);
    attempts++;
  } while (transcriptionResponse.data.status === 'STATUS_PROCESSING');

  if (transcriptionResponse.data.status === 'STATUS_ERROR') {
    throw new Error('Transcription failed');
  }

  return transcriptionResponse.data.payload?.transcription || '';
}

// Create a new clinical note from transcription
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

// Retrieve note content with polling for completion
async function getNote(noteId: string): Promise<any> {
  let response = await makeRequest(`/notes/${noteId}`);
  let attempts = 0;
  
  while (response.data.status === 'STATUS_PROCESSING') {
    if (attempts > 0) {
      logger.info('Note still processing...');
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    response = await makeRequest(`/notes/${noteId}`);
    attempts++;
  }
  
  return response;
}

// Delete a note by ID
async function deleteNote(noteId: string): Promise<void> {
  await makeRequest(`/notes/${noteId}`, { method: 'DELETE' });
}

// Validate audio file format and size
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

// Main execution flow
async function main(audioFilePath: string) {
  try {
    logger.step('Initializing Sully API Demo');
    logger.info(`Using API endpoint: ${SULLY_API_URL}`);
    logger.info(`Processing audio file: ${audioFilePath}`);

    // Step 1: Create note style template
    logger.step('Step 1: Creating Note Style Template');
    logger.info('Configuring note style with sample format and instructions...');
    const noteStyle = await createNoteStyle(
      'CC: Headache\nHPI: Patient reports severe headache...',
      ['Use bullet points', 'Include vital signs']
    );
    logger.success('Note style template created successfully');

    // Step 2: Transcribe audio file
    logger.step('Step 2: Transcribing Audio File');
    logger.info('Starting audio transcription process...');
    const transcription = await transcribeAudio(audioFilePath);
    logger.success('Audio transcription completed');
    logger.json('Transcription Result', {
      text: transcription.length > 200 
        ? transcription.substring(0, 200) + '...'
        : transcription
    });

    // Step 3: Generate clinical note
    logger.step('Step 3: Generating Clinical Note');
    logger.info('Creating clinical note from transcription...');
    const noteId = await createNote(transcription);
    logger.success(`Clinical note created with ID: ${noteId}`);

    // Step 4: Retrieve generated note
    logger.step('Step 4: Retrieving Generated Note');
    logger.info('Fetching the generated clinical note...');
    const note = await getNote(noteId);
    logger.success('Note retrieved successfully');
    logger.json('Generated Note Content', note.data.payload);

    // Step 5: Cleanup
    logger.step('Step 5: Cleanup');
    logger.info(`Deleting note with ID: ${noteId}`);
    await deleteNote(noteId);
    logger.success('Demo completed successfully');

  } catch (error: any) {
    logger.error(`Demo failed: ${error.message}`);
    process.exit(1);
  }
}

// CLI handler
if (require.main === module) {
  const audioPath = process.argv[2];
  if (!audioPath) {
    logger.error('Missing audio file path');
    logger.info('Usage: npx ts-node sully-demo.ts path/to/audio-file.mp3');
    logger.info(`Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`);
    process.exit(1);
  }
  main(audioPath).catch((error: any) => {
    logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}
