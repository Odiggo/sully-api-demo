/**
 * Browser-based implementation of Sully AI's WebSocket streaming demo
 */
import { PCMRecorder } from '@speechmatics/browser-audio-input';
import { expandDictationLayoutMarkers } from './dictation-layout.js';
import {
  DEFAULT_STREAMING_LANGUAGE_TAG,
  MULTILINGUAL_LANGUAGE_TAG,
  SUPPORTED_LANGUAGES,
} from './languages.js';
import {
  buildStreamingWebSocketUrl,
  parseStreamingTokenResponse,
  type StreamingToken,
} from './streaming-client.js';

const toError = ({ value }: { value: unknown }): Error =>
  value instanceof Error ? value : new Error(String(value));

export {
  DEFAULT_STREAMING_LANGUAGE_TAG,
  MULTILINGUAL_LANGUAGE_TAG,
  SUPPORTED_LANGUAGES,
};

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
  | 'connection_lost';

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

export interface StreamErrorEvent {
  message: string;
  fatal: boolean;
}

export interface ReconnectAttemptEvent {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}

export interface StreamCompleteEvent {
  reason: StreamEndReason;
}

export interface StreamingConfig {
  duration?: number;
  language?: string;
  dictation?: boolean;
  onPhaseChange?: (phase: SessionPhase) => void;
  onAutoStopTick?: (secondsRemaining: number) => void;
  onTranscription?: (update: TranscriptUpdate) => void;
  onStreamError?: (event: StreamErrorEvent) => void;
  onReconnectAttempt?: (event: ReconnectAttemptEvent) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
  onComplete?: (event: StreamCompleteEvent) => void;
  /** @deprecated Use onPhaseChange */
  onStatusChange?: (
    status: 'starting' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting',
  ) => void;
}

export function friendlyMicError(error: unknown): Error {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new Error(
      'Microphone access was denied. Allow the mic in your browser settings and try again.',
    );
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new Error('No microphone was found. Connect a mic and try again.');
  }
  if (message.includes('16000')) {
    return new Error(
      'This browser could not open a 16 kHz audio stream. Try Chrome or close other apps using the mic.',
    );
  }
  return error instanceof Error ? error : new Error(message);
}

export class SullyStreamingDemo {
  private ws: WebSocket | null = null;
  private pcmRecorder: PCMRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private retryCount = 0;
  private readonly maxRetries = 5;
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private countdownIntervalId: ReturnType<typeof setInterval> | null = null;
  private userStopped = false;
  private isStarting = false;
  private endReason: StreamEndReason = 'manual';
  private phase: SessionPhase = 'idle';
  private streamingToken: { token: string; apiUrl: string; accountId: string } | null = null;
  private config: StreamingConfig;
  private segments: TranscriptSegment[] = [];
  private currentSegmentIndex = 0;
  private lastWords: TranscriptWord[] | undefined;

  constructor(config: StreamingConfig) {
    this.config = {
      language: DEFAULT_STREAMING_LANGUAGE_TAG,
      dictation: false,
      ...config,
    };
  }

  getPhase(): SessionPhase {
    return this.phase;
  }

  setLanguage(language: string): void {
    this.config.language = language;
  }

  setDictation(dictation: boolean): void {
    this.config.dictation = dictation;
  }

  setDuration(durationMs: number): void {
    this.config.duration = durationMs > 0 ? durationMs : undefined;
  }

  private setPhase(phase: SessionPhase): void {
    this.phase = phase;
    this.config.onPhaseChange?.(phase);
    const legacy = phaseToLegacyStatus(phase);
    if (legacy) {
      this.config.onStatusChange?.(legacy);
    }
  }

  private tokenExpiresInSeconds(): number {
    const durationMs = this.config.duration ?? 0;
    if (durationMs > 0) {
      return Math.min(604_800, Math.max(60, Math.ceil(durationMs / 1000) + 120));
    }
    return 3600;
  }

  private async fetchStreamingToken(): Promise<StreamingToken> {
    const tokenResponse = await fetch('/streaming-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: this.tokenExpiresInSeconds() }),
    });

    if (!tokenResponse.ok) {
      throw new Error(
        'Failed to get a streaming token. Check SULLY_API_KEY, SULLY_ACCOUNT_ID, and SULLY_API_URL in .env.',
      );
    }

    return parseStreamingTokenResponse({
      value: await tokenResponse.json(),
    });
  }

  async start(): Promise<void> {
    if (this.isStarting || this.pcmRecorder?.isRecording) {
      console.warn('start() ignored — session already starting or live');
      return;
    }

    this.isStarting = true;
    this.userStopped = false;
    this.retryCount = 0;
    this.streamingToken = null;
    this.endReason = 'manual';
    this.lastWords = undefined;

    try {
      this.segments = [];
      this.currentSegmentIndex = 0;
      this.emitTranscript();

      this.setPhase('preparing');
      const { token, apiUrl, accountId } = await this.fetchStreamingToken();
      this.streamingToken = { token, apiUrl, accountId };

      this.setPhase('connecting');
      await this.initializeWebSocket(token, apiUrl, accountId);
      await this.initializeAudioRecording();

      this.setPhase('live');
      this.startAutoStopTimer();
    } catch (error) {
      this.endReason = 'error';
      this.handleError(friendlyMicError(error));
    } finally {
      this.isStarting = false;
    }
  }

  stop(reason: StreamEndReason = 'manual'): void {
    if (this.phase === 'idle' || this.phase === 'stopping') {
      return;
    }

    this.userStopped = true;
    this.endReason = reason;
    this.setPhase('stopping');
    this.clearTimers();

    if (this.pcmRecorder?.isRecording) {
      this.pcmRecorder.stopRecording();
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.pcmRecorder = null;
    this.setPhase('idle');
    this.config.onComplete?.({ reason: this.endReason });
  }

  private startAutoStopTimer(): void {
    if (!this.config.duration) return;

    let remainingTime = Math.ceil(this.config.duration / 1000);
    this.config.onAutoStopTick?.(remainingTime);

    this.countdownIntervalId = setInterval(() => {
      remainingTime--;
      if (remainingTime > 0) {
        this.config.onAutoStopTick?.(remainingTime);
      }
      if (remainingTime <= 0) {
        this.clearAutoStopTimer();
        this.endReason = 'timer';
        this.stop('timer');
      }
    }, 1000);
  }

  private clearAutoStopTimer(): void {
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
      this.countdownIntervalId = null;
    }
  }

  private clearTimers(): void {
    this.clearAutoStopTimer();
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }
  }

  private clearInterimSegments(): void {
    this.segments = this.segments.filter((segment) => segment.isFinal);
    this.currentSegmentIndex = this.segments.length;
    this.emitTranscript();
  }

  private async reconnect(): Promise<void> {
    if (this.userStopped) return;

    if (this.retryCount >= this.maxRetries) {
      this.endReason = 'connection_lost';
      this.handleError(
        new Error(`Lost connection after ${this.maxRetries} reconnect attempts`),
      );
      return;
    }

    const delay = Math.min(1000 * 2 ** this.retryCount, 30_000);
    this.retryCount++;
    this.setPhase('reconnecting');
    this.clearInterimSegments();
    this.config.onReconnectAttempt?.({
      attempt: this.retryCount,
      maxAttempts: this.maxRetries,
      delayMs: delay,
    });

    this.retryTimeoutId = setTimeout(async () => {
      if (this.userStopped) return;
      try {
        const { token, apiUrl, accountId } = await this.fetchStreamingToken();
        this.streamingToken = { token, apiUrl, accountId };
        await this.initializeWebSocket(token, apiUrl, accountId);
        this.setPhase('live');
      } catch (err) {
        console.error('Reconnect attempt failed:', err);
        await this.reconnect();
      }
    }, delay);
  }

  private emitTranscript(): void {
    this.config.onTranscription?.({
      segments: this.segments.map((segment) => ({ ...segment })),
      words: this.lastWords,
    });
  }

  private updateSegments(text: string, isFinal: boolean, words?: TranscriptWord[]): void {
    if (words?.length) {
      this.lastWords = words;
    }

    const normalizedText = expandDictationLayoutMarkers(text);

    if (isFinal) {
      this.segments[this.currentSegmentIndex] = {
        text: normalizedText,
        isFinal: true,
      };
      this.currentSegmentIndex++;
    } else {
      this.segments[this.currentSegmentIndex] = {
        text: normalizedText,
        isFinal: false,
      };
    }

    this.emitTranscript();
  }

  private isTranscriptFinal(data: { is_final?: boolean; isFinal?: boolean }): boolean {
    return data.is_final ?? data.isFinal ?? false;
  }

  private handleStreamErrorMessage(message: string): void {
    const fatal = false;
    this.config.onStreamError?.({ message, fatal });
    if (fatal) {
      this.endReason = 'error';
      this.handleError(new Error(message));
    }
  }

  private async initializeWebSocket(
    token: string,
    apiUrl: string,
    accountId: string,
  ): Promise<void> {
    const fullUrl = buildStreamingWebSocketUrl({
      apiUrl,
      sampleRate: 16000,
      encoding: 'linear32',
      dictation: this.config.dictation ?? false,
      language: this.config.language,
      accountId,
      apiToken: token,
    });
    console.log(
      'Connecting to WebSocket:',
      buildStreamingWebSocketUrl({
        apiUrl,
        sampleRate: 16000,
        encoding: 'linear32',
        dictation: this.config.dictation ?? false,
        language: this.config.language,
      }),
    );
    this.ws = new WebSocket(fullUrl);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('WebSocket connection timed out after 10s')),
        10_000,
      );
      if (!this.ws) return reject(new Error('WebSocket not initialized'));

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'status' && data.status === 'connected') {
            clearTimeout(timeout);
            resolve();
          }
        } catch {
          clearTimeout(timeout);
          reject(new Error('Failed to parse WebSocket handshake message'));
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket connection failed'));
      };
    });

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'error') {
          const raw =
            typeof data.error === 'string'
              ? data.error
              : typeof data.message === 'string'
                ? data.message
                : '';
          const trimmed = raw.trim();
          if (trimmed) {
            this.handleStreamErrorMessage(trimmed);
          }
          return;
        }

        if (data.type === 'status' && data.status === 'disconnected') {
          this.endReason = 'server';
          this.stop('server');
          return;
        }

        if (data.text) {
          const isFinal = this.isTranscriptFinal(data);
          const words = Array.isArray(data.words) ? (data.words as TranscriptWord[]) : undefined;
          this.updateSegments(data.text, isFinal, words);
        }
      } catch (error) {
        this.handleError(toError({ value: error }));
      }
    };

    this.ws.onclose = () => {
      if (!this.userStopped && this.phase === 'live') {
        this.reconnect();
      }
    };
  }

  private async initializeAudioRecording(): Promise<void> {
    const workletUrl = '/audio-worklet/pcm-audio-worklet.min.js';
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    if (this.audioContext.sampleRate !== 16000) {
      throw new Error(
        `AudioContext sample rate is ${this.audioContext.sampleRate}Hz, expected 16000Hz.`,
      );
    }

    this.pcmRecorder = new PCMRecorder(workletUrl);

    this.pcmRecorder.addEventListener('audio', (event) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const samples = event.data;
      this.reportAudioLevel(samples);
      const base64 = this.float32ArrayToBase64(samples);
      this.ws.send(JSON.stringify({ audio: base64 }));
    });

    await this.pcmRecorder.startRecording({ audioContext: this.audioContext });
  }

  private reportAudioLevel(samples: Float32Array): void {
    if (!this.config.onAudioLevel) return;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    this.config.onAudioLevel(Math.min(1, rms * 8));
  }

  private float32ArrayToBase64(samples: Float32Array): string {
    const bytes = new Uint8Array(samples.buffer);
    let binary = '';
    const chunkSize = 4096;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  private handleError(error: Error): void {
    console.error('Sully Streaming Demo error:', error);
    this.config.onError?.(error);
    if (this.phase !== 'idle') {
      this.userStopped = true;
      this.clearTimers();
      if (this.pcmRecorder?.isRecording) {
        this.pcmRecorder.stopRecording();
      }
      if (this.audioContext) {
        this.audioContext.close().catch(() => {});
        this.audioContext = null;
      }
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.pcmRecorder = null;
      if (this.endReason === 'manual') {
        this.endReason = 'error';
      }
      this.setPhase('error');
      this.config.onComplete?.({ reason: this.endReason });
    }
  }
}

function phaseToLegacyStatus(
  phase: SessionPhase,
):
  | 'starting'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'reconnecting'
  | undefined {
  switch (phase) {
    case 'preparing':
      return 'starting';
    case 'connecting':
      return 'connecting';
    case 'live':
      return 'connected';
    case 'reconnecting':
      return 'reconnecting';
    case 'stopping':
    case 'idle':
      return 'disconnected';
    case 'error':
      return 'error';
    default:
      return undefined;
  }
}
