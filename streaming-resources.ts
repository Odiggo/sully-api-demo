import type {
  AudioContextPort,
  RecorderPort,
  SocketPort,
} from './streaming-types.js';

export interface StreamingGenerationResources {
  id: number;
  controller: AbortController;
  recorder?: RecorderPort;
  recorderStarted: boolean;
  recorderStopped: boolean;
  audioContext?: AudioContextPort;
  audioClosed: boolean;
  socket?: SocketPort;
  socketClosed: boolean;
  handshakeTimeout?: unknown;
  retryTimeout?: unknown;
  countdownInterval?: unknown;
  retryCount: number;
  completionEmitted: boolean;
  stopPromise?: Promise<void>;
}
