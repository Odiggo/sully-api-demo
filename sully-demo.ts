// Import required dependencies
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import FormData from 'form-data';
import { existsSync, statSync } from 'fs';
import * as fs from 'fs/promises';
import fetch from 'node-fetch';
import mic from 'node-microphone'; // For microphone access
import WebSocket from 'ws'; // For real-time audio streaming

// Load environment variables from .env file
dotenv.config();

// API configuration from environment variables
const SULLY_API_URL = process.env.SULLY_API_URL!;
const API_KEY = process.env.SULLY_API_KEY!;
const ACCOUNT_ID = process.env.SULLY_ACCOUNT_ID!;

// Validate required environment variables are present
if (!SULLY_API_URL || !API_KEY || !ACCOUNT_ID) {
  console.error(
    '❌ Missing required environment variables. Please check your .env file:',
  );
  if (!SULLY_API_URL) console.error('- SULLY_API_URL');
  if (!API_KEY) console.error('- SULLY_API_KEY');
  if (!ACCOUNT_ID) console.error('- SULLY_ACCOUNT_ID');
  process.exit(1);
}

// List of audio formats the prercorded audio transcription API can process
const SUPPORTED_AUDIO_FORMATS = ['.mp3', '.wav', '.m4a', '.ogg'];

// Type definitions for API response structures
interface ApiResponse {
  status: 'ok' | 'error';
  data: any;
}

// Response type for audio transcription endpoints
interface TranscriptionResponse extends ApiResponse {
  data: {
    transcriptionId: string;
    status: 'STATUS_PROCESSING' | 'STATUS_DONE' | 'STATUS_ERROR';
    payload?: {
      transcription?: string;
    };
  };
}

// Response type for clinical note endpoints
interface NoteResponse extends ApiResponse {
  data: {
    noteId: string;
    status: 'STATUS_PROCESSING' | 'STATUS_DONE' | 'STATUS_ERROR';
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
      console.log(
        JSON.stringify(
          {
            soap: {
              subjective: {
                chiefComplaint: data.soap.subjective?.chiefComplaint || '',
                hpi: data.soap.subjective?.hpi || {},
                pmh: data.soap.subjective?.pmh || {},
              },
            },
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`📋 ${label}:\n${JSON.stringify(data, null, 2)}`);
    }
  },
};

// Generic API request handler with authentication and error handling
async function makeRequest(endpoint: string, options: any = {}): Promise<any> {
  const url = `${SULLY_API_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'X-Api-Key': API_KEY,
    'X-Account-Id': ACCOUNT_ID,
  };

  // Only set Content-Type for JSON requests, not FormData
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
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

// Create template for note formatting and structure
async function createNoteStyle(
  sampleNote: string,
  instructions: string[] = [],
): Promise<any> {
  return makeRequest('/note-styles', {
    method: 'POST',
    body: JSON.stringify({ sampleNote, instructions }),
  });
}

// Convert audio file to text with progress tracking
async function transcribeAudio(audioPath: string): Promise<string> {
  validateAudioFile(audioPath);

  logger.info('Reading audio file...');
  const audioBuffer = await fs.readFile(audioPath);

  logger.info('Uploading audio...');
  const formData = new FormData();
  formData.append('audio', audioBuffer, {
    filename: 'audio.mp3',
    contentType: 'audio/mpeg',
  });
  formData.append('language', 'en-US');

  const response = await makeRequest('/audio/transcriptions', {
    method: 'POST',
    body: formData,
  });

  const transcriptionId = response.data.transcriptionId;
  logger.info(`Transcription ID: ${transcriptionId}`);

  // Poll until transcription is complete
  let transcriptionResponse: TranscriptionResponse;
  let attempts = 0;
  do {
    if (attempts > 0) {
      logger.info('Waiting for transcription...');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    transcriptionResponse = await makeRequest(
      `/audio/transcriptions/${transcriptionId}`,
    );
    attempts++;
  } while (transcriptionResponse.data.status === 'STATUS_PROCESSING');

  if (transcriptionResponse.data.status === 'STATUS_ERROR') {
    throw new Error('Transcription failed');
  }

  return transcriptionResponse.data.payload?.transcription || '';
}

// Generate clinical note from transcribed text
async function createNote(transcript: string): Promise<string> {
  const response = await makeRequest('/notes', {
    method: 'POST',
    body: JSON.stringify({
      transcript,
      date: new Date().toISOString().split('T')[0],
      noteType: {
        format: 'json',
        type: 'soap',
      },
    }),
  });
  return response.data.noteId;
}

// Fetch note content with polling for completion
async function getNote(noteId: string): Promise<any> {
  let response = await makeRequest(`/notes/${noteId}`);
  let attempts = 0;

  while (response.data.status === 'STATUS_PROCESSING') {
    if (attempts > 0) {
      logger.info('Note still processing...');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
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
        `Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
    );
  }

  const fileSizeInMB = statSync(filePath).size / (1024 * 1024);
  if (fileSizeInMB > 50) {
    throw new Error(
      `Audio file too large: ${fileSizeInMB.toFixed(1)}MB\n` +
        'Maximum file size: 50MB',
    );
  }
}

// Default duration for streaming demo
const STREAMING_DEMO_DURATION = 10; // 10 seconds

// Real-time audio streaming and transcription demo
async function demonstrateStreaming({
  mode,
  duration,
  language,
}: {
  mode: 'client' | 'server';
  duration: number;
  language?: string;
}): Promise<void> {
  logger.step('Starting Live Audio Streaming Demo');
  logger.info(`Demo will run for ${duration} seconds...`);

  const durationMs = duration * 1000;

  let token: string | undefined;

  if (mode === 'client') {
    const tokenReq = await makeRequest('/audio/transcriptions/stream/token', {
      method: 'POST',
      body: JSON.stringify({ expiresIn: 60 }),
    });

    token = tokenReq.data.token;
  }

  // Convert HTTP/HTTPS URL to WebSocket URL
  const baseWsUrl =
    SULLY_API_URL.replace('https://', 'wss://').replace('http://', 'ws://') +
    '/audio/transcriptions/stream';

  // Build query parameters
  const params = new URLSearchParams({
    sample_rate: '16000',
    encoding: 'linear16',
  });

  // Add language parameter if provided
  if (language) {
    params.append('language', language);
  }

  // Add authentication parameters for client mode
  if (token) {
    params.append('account_id', ACCOUNT_ID);
    params.append('api_token', token);
  }

  const wsUrl = `${baseWsUrl}?${params.toString()}`;

  logger.info(`Connecting to WebSocket: ${wsUrl}`);

  return new Promise((resolve, reject) => {
    try {
      // Initialize WebSocket with authentication
      const ws = new WebSocket(wsUrl, {
        headers: {
          ...(token
            ? {}
            : { 'x-api-key': API_KEY, 'x-account-id': ACCOUNT_ID }),
        },
      });

      // Configure microphone settings
      const microphone = new mic({
        rate: 16000,
        channels: 1,
        bitwidth: 16,
      });

      // Handle WebSocket connection success
      ws.on('open', () => {
        console.log('\n🎤 ==========================================');
        console.log('🎤 LIVE AUDIO STREAMING IS NOW ACTIVE');
        console.log(
          '🎤 Start speaking! Your voice will be transcribed in real-time',
        );
        console.log('🎤 ==========================================\n');

        const micStream = microphone.startRecording();

        // Stream microphone data to WebSocket
        micStream.on('data', (data) => {
          if (ws.readyState === WebSocket.OPEN) {
            const base64 = data.toString('base64');
            ws.send(JSON.stringify({ audio: base64 }));
          }
        });

        // Display countdown timer
        let secondsLeft = duration;
        const countdownInterval = setInterval(() => {
          secondsLeft--;
          if (secondsLeft > 0) {
            process.stdout.write(
              `⏱️  Time remaining: ${secondsLeft} seconds\r`,
            );
          }
        }, 1000);

        // Clean up countdown display
        setTimeout(() => {
          clearInterval(countdownInterval);
          console.log('\n🎤 ==========================================');
          console.log('🎤 STREAMING DEMO COMPLETED');
          console.log('🎤 ==========================================\n');
        }, durationMs);
      });

      // Handle incoming transcription results
      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.text) {
            console.log(`🗣️  ${parsed.text}`);
          }
        } catch (e) {
          logger.error(`Error parsing message: ${e}`);
        }
      });

      // Handle WebSocket errors
      ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error}`);
        microphone.stopRecording();
        reject(error);
      });

      // Handle WebSocket closure
      ws.on('close', (code, reason) => {
        logger.info(`WebSocket closed: ${code} ${reason}`);
        microphone.stopRecording();
        resolve();
      });

      // Clean up resources
      const cleanup = () => {
        logger.info('Cleaning up streaming demo...');
        ws.close();
        microphone.stopRecording();
      };

      // Handle interrupt signal
      process.on('SIGINT', cleanup);

      // End demo after specified duration
      setTimeout(() => {
        cleanup();
        logger.success(`Streaming demo completed after ${duration} seconds`);
        resolve();
      }, durationMs);
    } catch (error) {
      logger.error(`Streaming demo failed: ${error}`);
      reject(error);
    }
  });
}

// Main demo workflow
async function main({ filePath }: { filePath: string }) {
  try {
    logger.step('Initializing Sully API Demo');
    logger.info(`Using API endpoint: ${SULLY_API_URL}`);
    logger.info(`Processing audio file: ${filePath}`);

    // Step 1: Create note style template
    logger.step('Step 1: Creating Note Style Template');
    logger.info(
      'Configuring note style with sample format and instructions...',
    );
    const noteStyle = await createNoteStyle(
      'CC: Headache\nHPI: Patient reports severe headache...',
      ['Use bullet points', 'Include vital signs'],
    );
    logger.success('Note style template created successfully');

    // Step 2: Transcribe audio file
    logger.step('Step 2: Transcribing Audio File');
    logger.info('Starting audio transcription process...');
    const transcription = await transcribeAudio(filePath);
    logger.success('Audio transcription completed');
    logger.json('Transcription Result', {
      text:
        transcription.length > 200
          ? transcription.substring(0, 200) + '...'
          : transcription,
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
    logger.success('Note deleted successfully');
  } catch (error: any) {
    logger.error(`Demo failed: ${error.message}`);
    process.exit(1);
  }
}

const program = new Command();

program
  .name('sully-cli')
  .description('CLI for Sully AI Services')
  .version('0.1.0');

program
  .command('note')
  .description('Create a note style, transcribe audio file, and generate note')
  .argument('[path]', 'Path to the audio file', 'audio/demo_audio.wav')
  .action(async (filePath) => {
    try {
      logger.step('Starting demo...');
      await main({ filePath });
      logger.success('Demo completed.');
      process.exit(0);
    } catch (error) {
      logger.error(`Demo failed: ${error}`);
    }
  });

program
  .command('stream')
  .description('Start a live audio streaming demo')
  .option(
    '-d, --duration <s>',
    'Duration in seconds',
    `${STREAMING_DEMO_DURATION}`,
  )
  .option('-m, --mode <string>', 'Streaming mode (client|server)', 'server')
  .option('-l, --language <string>', 'Language code (e.g., en-US)')
  .action(async (options) => {
    const duration = parseInt(options.duration, 10);
    try {
      logger.step('Starting streaming demo...');
      await demonstrateStreaming({
        duration,
        mode: options.mode,
        language: options.language,
      });
      logger.success('Streaming demo completed.');
      process.exit(0);
    } catch (error) {
      logger.error(`Streaming demo failed: ${error}`);
    }
  });

program.parse(process.argv);
