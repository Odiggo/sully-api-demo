import { PCMRecorder } from '@speechmatics/browser-audio-input';

import type {
  AudioContextPort,
  RecorderPort,
  SocketPort,
  StreamingDependencies,
  StreamingTimers,
} from './streaming-types.js';

function platformTimers(): StreamingTimers {
  return {
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  };
}

function createAudioContext(): AudioContextPort {
  const native = new AudioContext({ sampleRate: 16_000 });
  return { native, sampleRate: native.sampleRate, close: () => native.close() };
}

function createRecorder(): RecorderPort {
  const recorder = new PCMRecorder('/audio-worklet/pcm-audio-worklet.min.js');
  let audioHandler: ((samples: Float32Array) => void) | undefined;
  recorder.addEventListener('audio', (event) => audioHandler?.(event.data));
  return {
    get isRecording() {
      return recorder.isRecording;
    },
    async start(audioContext) {
      if (!(audioContext.native instanceof AudioContext)) {
        throw new Error('Recorder received an invalid audio context');
      }
      await recorder.startRecording({ audioContext: audioContext.native });
    },
    stop: () => recorder.stopRecording(),
    setAudioHandler(handler) {
      audioHandler = handler;
    },
  };
}

function createSocket(url: string): SocketPort {
  const socket = new WebSocket(url);
  let messageHandler: ((message: string) => void) | undefined;
  let closeHandler: (() => void) | undefined;
  let errorHandler: (() => void) | undefined;
  socket.onmessage = (event) => {
    if (typeof event.data === 'string') messageHandler?.(event.data);
  };
  socket.onclose = () => closeHandler?.();
  socket.onerror = () => errorHandler?.();
  return {
    get readyState() {
      return socket.readyState;
    },
    setMessageHandler(handler) {
      messageHandler = handler;
    },
    setCloseHandler(handler) {
      closeHandler = handler;
    },
    setErrorHandler(handler) {
      errorHandler = handler;
    },
    send: (message) => socket.send(message),
    close: () => socket.close(),
  };
}

export function createBrowserStreamingDependencies(): StreamingDependencies {
  return {
    createAudioContext,
    createRecorder,
    createSocket,
    timers: platformTimers(),
  };
}

export function friendlyMicError(error: unknown): Error {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new Error('Microphone access was denied. Allow it in browser settings and retry.');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new Error('No microphone was found. Connect a microphone and retry.');
  }
  if (message.includes('16000')) {
    return new Error('Browser could not open 16 kHz audio. Try Chrome or close other audio apps.');
  }
  return error instanceof Error ? error : new Error(message);
}
