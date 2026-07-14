import { expandDictationLayoutMarkers } from './dictation-layout.js';
import { encodeStreamingAudio, streamingAudioLevel } from './streaming-audio.js';
import {
  DEFAULT_STREAMING_LANGUAGE_TAG,
  MULTILINGUAL_LANGUAGE_TAG,
  SUPPORTED_LANGUAGES,
} from './languages.js';
import {
  buildStreamingWebSocketUrl,
  type StreamingToken,
} from './streaming-client.js';
import {
  createBrowserStreamingDependencies,
  friendlyMicError,
} from './streaming-browser-adapters.js';
import { parseStreamingMessage, parseTranscriptWords } from './streaming-message.js';
import type { StreamingGenerationResources } from './streaming-resources.js';
import type {
  SessionPhase,
  SocketPort,
  StreamEndReason,
  StreamingConfig,
  StreamingDependencies,
  StreamingTransport,
  TranscriptSegment,
  TranscriptWord,
} from './streaming-types.js';

export * from './streaming-types.js';
export { friendlyMicError } from './streaming-browser-adapters.js';

export {
  DEFAULT_STREAMING_LANGUAGE_TAG,
  MULTILINGUAL_LANGUAGE_TAG,
  SUPPORTED_LANGUAGES,
};

const SOCKET_OPEN = 1;
const MAX_RECONNECT_ATTEMPTS = 5;
const HANDSHAKE_TIMEOUT_MS = 10_000;

function abortError(): DOMException {
  return new DOMException('Streaming start aborted', 'AbortError');
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class SullyStreamingDemo implements StreamingTransport {
  private phase: SessionPhase = 'idle';
  private generation = 0;
  private resources?: StreamingGenerationResources;
  private startPromise?: Promise<void>;
  private readonly dependencies: StreamingDependencies;
  private readonly config: StreamingConfig;
  private segments: TranscriptSegment[] = [];
  private currentSegmentIndex = 0;
  private lastWords?: TranscriptWord[];

  constructor(
    config: StreamingConfig,
    dependencies: StreamingDependencies = createBrowserStreamingDependencies(),
  ) {
    this.config = { language: DEFAULT_STREAMING_LANGUAGE_TAG, dictation: false, ...config };
    this.dependencies = dependencies;
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

  setTokenExpiresIn(seconds: number): void {
    this.config.tokenExpiresIn = seconds;
  }

  setDuration(durationMs: number): void {
    this.config.duration = durationMs > 0 ? durationMs : undefined;
  }

  private setPhase(phase: SessionPhase): void {
    this.phase = phase;
    this.config.onPhaseChange?.(phase);
  }

  private isCurrent(resources: StreamingGenerationResources): boolean {
    return this.resources === resources && !resources.controller.signal.aborted;
  }

  private tokenExpiresInSeconds(): number {
    if (this.config.tokenExpiresIn !== undefined) return this.config.tokenExpiresIn;
    if (this.config.duration) {
      return Math.min(604_800, Math.max(60, Math.ceil(this.config.duration / 1000) + 120));
    }
    return 3_600;
  }

  start(): Promise<void> {
    if (this.startPromise && this.phase !== 'idle' && this.phase !== 'error') return this.startPromise;
    if (this.phase === 'live' || this.phase === 'reconnecting') return Promise.resolve();
    const resources: StreamingGenerationResources = {
      id: ++this.generation,
      controller: new AbortController(),
      recorderStarted: false,
      recorderStopped: false,
      audioClosed: false,
      socketClosed: false,
      socketDisconnected: false,
      retryCount: 0,
      completionEmitted: false,
    };
    this.resources = resources;
    this.segments = [];
    this.currentSegmentIndex = 0;
    this.lastWords = undefined;
    this.emitTranscript();
    const starting = this.startGeneration(resources).finally(() => {
      if (this.resources === resources) this.startPromise = undefined;
    });
    this.startPromise = starting;
    return starting;
  }

  private async startGeneration(resources: StreamingGenerationResources): Promise<void> {
    try {
      this.setPhase('preparing');
      const token = await this.config.createStreamingToken(
        this.tokenExpiresInSeconds(),
        resources.controller.signal,
      );
      if (!this.isCurrent(resources)) return;
      this.setPhase('connecting');
      await this.openSocket(resources, token);
      if (!this.isCurrent(resources)) return;
      resources.audioContext = this.dependencies.createAudioContext();
      if (resources.audioContext.sampleRate !== 16_000) {
        throw new Error(`AudioContext sample rate is ${resources.audioContext.sampleRate}Hz, expected 16000Hz.`);
      }
      resources.recorder = this.dependencies.createRecorder();
      resources.recorder.setAudioHandler((samples) => this.handleAudio(resources, samples));
      await resources.recorder.start(resources.audioContext);
      resources.recorderStarted = true;
      if (resources.socketDisconnected) {
        throw new Error('WebSocket closed before streaming could start');
      }
      if (!this.isCurrent(resources)) {
        await this.cleanupResources(resources);
        return;
      }
      this.setPhase('live');
      this.startAutoStopTimer(resources);
    } catch (error: unknown) {
      if (isAbort(error) || resources.controller.signal.aborted) return;
      const safe = friendlyMicError(error);
      this.config.onError?.(safe);
      await this.stopResources(resources, 'error');
    }
  }

  stop(reason: StreamEndReason = 'manual'): Promise<void> {
    const resources = this.resources;
    if (!resources) return Promise.resolve();
    return this.stopResources(resources, reason);
  }

  private stopResources(
    resources: StreamingGenerationResources,
    reason: StreamEndReason,
  ): Promise<void> {
    if (resources.stopPromise) return resources.stopPromise;
    resources.controller.abort();
    if (this.resources === resources && this.phase !== 'idle' && this.phase !== 'error') {
      this.setPhase('stopping');
    }
    resources.stopPromise = this.cleanupResources(resources).then((failures) => {
      if (failures.length > 0) {
        this.config.onError?.(new AggregateError(failures, 'Streaming cleanup failed'));
      }
      if (!resources.completionEmitted) {
        resources.completionEmitted = true;
        this.config.onComplete?.({ reason });
      }
      if (this.resources === resources) {
        this.startPromise = undefined;
        this.setPhase(reason === 'error' ? 'error' : 'idle');
      }
    });
    return resources.stopPromise;
  }

  private async cleanupResources(resources: StreamingGenerationResources): Promise<unknown[]> {
    const releases = this.releaseTimers(resources);
    const recorder = resources.recorder;
    if (recorder) {
      releases.push(Promise.resolve().then(() => recorder.setAudioHandler(undefined)));
      releases.push(
        Promise.resolve().then(() => {
          if (!resources.recorderStopped && (recorder.isRecording || resources.recorderStarted)) {
            resources.recorderStopped = true;
            recorder.stop();
          }
        }),
      );
    }
    const audioContext = resources.audioContext;
    if (audioContext && !resources.audioClosed) {
      resources.audioClosed = true;
      releases.push(Promise.resolve().then(() => audioContext.close()));
    }
    releases.push(...this.releaseSocket(resources));
    const results = await Promise.allSettled(releases);
    return results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
  }

  private releaseSocket(resources: StreamingGenerationResources): Promise<void>[] {
    const socket = resources.socket;
    if (!socket || resources.socketClosed) return [];
    resources.socketClosed = true;
    resources.socket = undefined;
    return [
      Promise.resolve().then(() => socket.setMessageHandler(undefined)),
      Promise.resolve().then(() => socket.setCloseHandler(undefined)),
      Promise.resolve().then(() => socket.setErrorHandler(undefined)),
      Promise.resolve().then(() => socket.close()),
    ];
  }

  private releaseTimers(resources: StreamingGenerationResources): Promise<void>[] {
    const releases: Promise<void>[] = [];
    if (resources.handshakeTimeout !== undefined) {
      const handle = resources.handshakeTimeout;
      resources.handshakeTimeout = undefined;
      releases.push(Promise.resolve().then(() => this.dependencies.timers.clearTimeout(handle)));
    }
    if (resources.retryTimeout !== undefined) {
      const handle = resources.retryTimeout;
      resources.retryTimeout = undefined;
      releases.push(Promise.resolve().then(() => this.dependencies.timers.clearTimeout(handle)));
    }
    if (resources.countdownInterval !== undefined) {
      const handle = resources.countdownInterval;
      resources.countdownInterval = undefined;
      releases.push(Promise.resolve().then(() => this.dependencies.timers.clearInterval(handle)));
    }
    return releases;
  }

  private async openSocket(
    resources: StreamingGenerationResources,
    token: StreamingToken,
  ): Promise<void> {
    const url = buildStreamingWebSocketUrl({
      apiUrl: token.apiUrl,
      sampleRate: 16_000,
      encoding: 'linear16',
      dictation: this.config.dictation ?? false,
      language: this.config.language,
      accountId: token.accountId,
      apiToken: token.token,
    });
    const socket = this.dependencies.createSocket(url);
    resources.socket = socket;
    resources.socketClosed = false;
    resources.socketDisconnected = false;
    await this.waitForHandshake(resources, socket);
    if (resources.socketDisconnected) {
      throw new Error('WebSocket closed before streaming could start');
    }
  }

  private waitForHandshake(
    resources: StreamingGenerationResources,
    socket: SocketPort,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (resources.handshakeTimeout !== undefined) {
          this.dependencies.timers.clearTimeout(resources.handshakeTimeout);
          resources.handshakeTimeout = undefined;
        }
        resources.controller.signal.removeEventListener('abort', handleAbort);
        if (error) reject(error);
        else resolve();
      };
      const handleAbort = () => finish(abortError());
      resources.controller.signal.addEventListener('abort', handleAbort, { once: true });
      resources.handshakeTimeout = this.dependencies.timers.setTimeout(
        () => finish(new Error('WebSocket connection timed out after 10 seconds')),
        HANDSHAKE_TIMEOUT_MS,
      );
      socket.setMessageHandler((message) => {
        const value = parseStreamingMessage(message);
        if (!settled && value?.type === 'status' && value.status === 'connected') {
          finish();
          return;
        }
        if (settled) this.handleMessage(resources, message);
      });
      socket.setErrorHandler(() => {
        if (!settled) finish(new Error('WebSocket connection failed'));
        else this.config.onStreamError?.({ message: 'Streaming socket error', fatal: false });
      });
      socket.setCloseHandler(() => {
        resources.socketDisconnected = true;
        if (!settled) finish(new Error('WebSocket closed before connecting'));
        else if (this.phase === 'live') this.scheduleReconnect(resources);
      });
    });
  }

  private handleMessage(resources: StreamingGenerationResources, message: string): void {
    if (!this.isCurrent(resources)) return;
    const data = parseStreamingMessage(message);
    if (!data) {
      this.config.onStreamError?.({ message: 'Invalid streaming response', fatal: false });
      return;
    }
    if (data.type === 'error') {
      const raw = typeof data.error === 'string' ? data.error : data.message;
      if (typeof raw === 'string' && raw.trim()) {
        this.config.onStreamError?.({ message: raw.trim(), fatal: false });
      }
      return;
    }
    if (data.type === 'status' && data.status === 'disconnected') {
      this.requestHandledStop('server');
      return;
    }
    if (typeof data.text === 'string') {
      const isFinal =
        typeof data.is_final === 'boolean'
          ? data.is_final
          : typeof data.isFinal === 'boolean'
            ? data.isFinal
            : false;
      this.updateSegments(data.text, isFinal, parseTranscriptWords(data.words));
    }
  }

  private updateSegments(text: string, isFinal: boolean, words?: TranscriptWord[]): void {
    if (words?.length) this.lastWords = words;
    const segment = { text: expandDictationLayoutMarkers(text), isFinal };
    this.segments[this.currentSegmentIndex] = segment;
    if (isFinal) this.currentSegmentIndex += 1;
    this.emitTranscript();
  }

  private emitTranscript(): void {
    this.config.onTranscription?.({
      segments: this.segments.map((segment) => ({ ...segment })),
      words: this.lastWords?.map((word) => ({ ...word })),
    });
  }

  private handleAudio(resources: StreamingGenerationResources, samples: Float32Array): void {
    if (!this.isCurrent(resources) || resources.socket?.readyState !== SOCKET_OPEN) return;
    if (this.config.onAudioLevel) this.config.onAudioLevel(streamingAudioLevel(samples));
    resources.socket.send(JSON.stringify({ audio: encodeStreamingAudio(samples) }));
  }

  private scheduleReconnect(resources: StreamingGenerationResources): void {
    if (
      !this.isCurrent(resources) ||
      (this.phase !== 'live' && this.phase !== 'reconnecting')
    ) return;
    if (resources.retryCount >= MAX_RECONNECT_ATTEMPTS) {
      this.config.onError?.(new Error('Connection lost after reconnect attempts'));
      this.requestHandledStop('connection_lost');
      return;
    }
    const delayMs = Math.min(1_000 * 2 ** resources.retryCount, 30_000);
    resources.retryCount += 1;
    this.setPhase('reconnecting');
    this.segments = this.segments.filter((segment) => segment.isFinal);
    this.currentSegmentIndex = this.segments.length;
    this.emitTranscript();
    this.config.onReconnectAttempt?.({
      attempt: resources.retryCount,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      delayMs,
    });
    resources.retryTimeout = this.dependencies.timers.setTimeout(() => {
      resources.retryTimeout = undefined;
      void this.reconnect(resources);
    }, delayMs);
  }

  private async reconnect(resources: StreamingGenerationResources): Promise<void> {
    if (!this.isCurrent(resources)) return;
    await Promise.allSettled(this.releaseSocket(resources));
    if (!this.isCurrent(resources)) return;
    try {
      const token = await this.config.createStreamingToken(
        this.tokenExpiresInSeconds(),
        resources.controller.signal,
      );
      if (!this.isCurrent(resources)) return;
      await this.openSocket(resources, token);
      if (this.isCurrent(resources)) this.setPhase('live');
    } catch (error: unknown) {
      await Promise.allSettled(this.releaseSocket(resources));
      if (!isAbort(error) && this.isCurrent(resources)) this.scheduleReconnect(resources);
    }
  }

  private startAutoStopTimer(resources: StreamingGenerationResources): void {
    if (!this.config.duration) return;
    let remaining = Math.ceil(this.config.duration / 1_000);
    this.config.onAutoStopTick?.(remaining);
    resources.countdownInterval = this.dependencies.timers.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) this.config.onAutoStopTick?.(remaining);
      else this.requestHandledStop('timer');
    }, 1_000);
  }

  private requestHandledStop(reason: StreamEndReason): void {
    void this.stop(reason).catch(() => {
      this.config.onError?.(new Error('Streaming stop failed'));
    });
  }
}
