import type { StreamingToken } from './streaming-client.js';

export type SessionPhase =
  | 'idle'
  | 'preparing'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'stopping'
  | 'error';

export type StreamEndReason =
  | 'manual'
  | 'timer'
  | 'server'
  | 'error'
  | 'connection_lost'
  | 'navigation'
  | 'pagehide';

export interface TranscriptWord {
  word: string;
  start?: number;
  end?: number;
  confidence?: number;
  punctuated_word?: string;
}

export interface TranscriptSegment {
  text: string;
  isFinal: boolean;
}

export interface TranscriptUpdate {
  segments: TranscriptSegment[];
  words?: TranscriptWord[];
}

export interface AudioContextPort {
  readonly sampleRate: number;
  readonly native: unknown;
  close(): Promise<void>;
}

export interface RecorderPort {
  readonly isRecording: boolean;
  start(audioContext: AudioContextPort): Promise<void>;
  stop(): void;
  setAudioHandler(handler: ((samples: Float32Array) => void) | undefined): void;
}

export interface SocketPort {
  readonly readyState: number;
  setMessageHandler(handler: ((message: string) => void) | undefined): void;
  setCloseHandler(handler: (() => void) | undefined): void;
  setErrorHandler(handler: (() => void) | undefined): void;
  send(message: string): void;
  close(): void;
}

export interface StreamingTimers {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface StreamingDependencies {
  createAudioContext(): AudioContextPort;
  createRecorder(): RecorderPort;
  createSocket(url: string): SocketPort;
  timers: StreamingTimers;
}

export interface StreamingTransport {
  getPhase(): SessionPhase;
  setLanguage(language: string): void;
  setDictation(dictation: boolean): void;
  setTokenExpiresIn(seconds: number): void;
  start(): Promise<void>;
  stop(reason?: StreamEndReason): Promise<void>;
}

export interface StreamingConfig {
  duration?: number;
  language?: string;
  dictation?: boolean;
  tokenExpiresIn?: number;
  createStreamingToken: (expiresIn: number, signal: AbortSignal) => Promise<StreamingToken>;
  onPhaseChange?: (phase: SessionPhase) => void;
  onAutoStopTick?: (secondsRemaining: number) => void;
  onTranscription?: (update: TranscriptUpdate) => void;
  onStreamError?: (event: { message: string; fatal: boolean }) => void;
  onReconnectAttempt?: (event: { attempt: number; maxAttempts: number; delayMs: number }) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
  onComplete?: (event: { reason: StreamEndReason }) => void;
}
