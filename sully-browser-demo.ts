/**
 * Browser-based implementation of Sully AI's WebSocket streaming demo
 */
import { PCMRecorder } from '@speechmatics/browser-audio-input';

export interface StreamingConfig {
  duration?: number;
  onTranscription?: (text: string) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  onStatusChange?: (
    status: 'starting' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting',
  ) => void;
}

interface StreamingToken {
  token: string;
  apiUrl: string;
  accountId: string;
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
  private streamingToken: { token: string; apiUrl: string; accountId: string } | null = null;
  private config: StreamingConfig;
  private segments: { text: string; isFinal: boolean }[] = [];
  private currentSegmentIndex: number = 0;

  constructor(config: StreamingConfig) {
    this.config = {
      duration: 60_000, // Default 1 minute
      ...config,
    };
  }

  /**
   * Starts the streaming demo
   * @returns Promise that resolves when streaming is complete
   */
  async start(): Promise<void> {
    if (this.pcmRecorder?.isRecording) {
      console.warn('start() called while already recording — ignoring');
      return;
    }

    this.userStopped = false;
    this.retryCount = 0;
    this.streamingToken = null;

    try {
      this.segments = []; // Reset segments
      this.currentSegmentIndex = 0;
      console.log('Starting Sully Streaming Demo...');
      this.config.onStatusChange?.('starting');
      // Get streaming token from server
      console.log('Requesting streaming token from server...');
      const tokenResponse = await fetch('/streaming-token', {
        method: 'POST',
      });

      if (!tokenResponse.ok) {
        console.error(
          `Token request failed with status: ${tokenResponse.status}`,
        );
        this.config.onStatusChange?.('error');
        throw new Error('Failed to get streaming token');
      }

      const { token, apiUrl, accountId } =
        (await tokenResponse.json()) as StreamingToken;
      this.streamingToken = { token, apiUrl, accountId };
      console.log('Successfully obtained streaming token');

      // Initialize WebSocket connection
      console.log('Initializing WebSocket connection...');
      this.config.onStatusChange?.('connecting');
      await this.initializeWebSocket(token, apiUrl, accountId);
      this.config.onStatusChange?.('connected');

      // Set up audio recording
      console.log('Setting up audio recording...');
      await this.initializeAudioRecording();

      // Set timeout to stop recording after duration
      if (this.config.duration) {
        console.log(`Setting auto-stop timer for ${this.config.duration}ms`);
        let remainingTime = Math.floor(this.config.duration / 1000);

        this.countdownIntervalId = setInterval(() => {
          remainingTime--;
          console.log(`Recording time remaining: ${remainingTime} seconds`);

          if (remainingTime <= 0) {
            clearInterval(this.countdownIntervalId!);
            this.countdownIntervalId = null;
            console.log('Auto-stop timer triggered');
            this.stop();
          }
        }, 1000);
      }
    } catch (error) {
      console.error('Error in start():', error);
      this.handleError(error as Error);
    }
  }

  /**
   * Stops the streaming demo and cleans up resources
   */
  stop(): void {
    this.userStopped = true;
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
      this.countdownIntervalId = null;
    }
    console.log('Stopping Sully Streaming Demo...');
    this.config.onStatusChange?.('disconnected');

    if (this.pcmRecorder?.isRecording) {
      console.log('Stopping PCMRecorder');
      this.pcmRecorder.stopRecording();
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.ws) {
      console.log('Closing WebSocket connection');
      this.ws.close();
      this.ws = null;
    }

    console.log('Cleanup complete');
    this.config.onComplete?.();
  }

  private async reconnect(): Promise<void> {
    if (this.userStopped) return;

    if (this.retryCount >= this.maxRetries) {
      this.handleError(new Error(`Lost connection after ${this.maxRetries} reconnect attempts`));
      return;
    }

    const delay = Math.min(1000 * 2 ** this.retryCount, 30_000);
    this.retryCount++;
    console.log(`Reconnecting in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
    this.config.onStatusChange?.('reconnecting');

    this.retryTimeoutId = setTimeout(async () => {
      if (this.userStopped) return;
      try {
        // Always re-fetch token — old one may have expired
        const tokenResponse = await fetch('/streaming-token', { method: 'POST' });
        if (!tokenResponse.ok) throw new Error('Failed to refresh streaming token');
        const data = await tokenResponse.json() as { token?: string; apiUrl?: string; accountId?: string };
        if (!data.token || !data.apiUrl || !data.accountId) {
          throw new Error('Invalid token response: missing required fields');
        }
        const { token, apiUrl, accountId } = data as { token: string; apiUrl: string; accountId: string };
        this.streamingToken = { token, apiUrl, accountId };

        await this.initializeWebSocket(token, apiUrl, accountId);
        this.config.onStatusChange?.('connected');
        console.log('Reconnected successfully');
      } catch (err) {
        console.error('Reconnect attempt failed:', err);
        await this.reconnect();
      }
    }, delay);
  }

  private updateSegments(text: string, isFinal: boolean): void {
    if (isFinal) {
      // For final results, update current segment and move to next
      this.segments[this.currentSegmentIndex] = { text, isFinal: true };
      this.currentSegmentIndex++;
    } else {
      // For interim results, always update the current segment
      this.segments[this.currentSegmentIndex] = { text, isFinal: false };
    }

    // Combine segments into final text
    const displayText = this.segments.map((segment) => segment.text).join(' ');

    // Send the combined text to the UI
    this.config.onTranscription?.(displayText);
  }

  private async initializeWebSocket(
    token: string,
    apiUrl: string,
    accountId: string,
  ): Promise<void> {
    const wsUrl = apiUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');

    // linear32 = Float32Array natively from PCMRecorder, no conversion needed
    const params = new URLSearchParams({
      sample_rate: '16000',
      encoding: 'linear32',
      account_id: accountId,
      api_token: token,
    });
    const fullUrl = `${wsUrl}/audio/transcriptions/stream?${params.toString()}`;
    console.log('Connecting to WebSocket:', wsUrl);

    this.ws = new WebSocket(fullUrl);

    // Wait for connection to be established and confirmed
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket connection timed out')), 10_000);
      if (!this.ws) return reject(new Error('WebSocket not initialized'));

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'status' && data.status === 'connected') {
            clearTimeout(timeout);
            console.log('WebSocket connection confirmed');
            resolve();
          }
        } catch (error) {
          clearTimeout(timeout);
          console.error('Error parsing WebSocket message:', error);
          reject(new Error('Failed to parse WebSocket message'));
        }
      };

      this.ws.onopen = () => {
        console.log('WebSocket connection established');
      };
      this.ws.onerror = (error) => {
        clearTimeout(timeout);
        console.error('WebSocket error:', error);
        reject(new Error('WebSocket connection failed'));
      };
    });

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle status messages
        if (data.type === 'status') {
          console.log('Received status message:', JSON.stringify(data));
          if (data.status === 'disconnected') {
            console.warn('Server initiated disconnection — full payload:', JSON.stringify(data));
            this.stop();
            return;
          }
        }

        // Handle transcription messages
        if (data.text) {
          console.log(`Received transcription [isFinal=${data.isFinal}]:`, JSON.stringify(data));
          this.updateSegments(data.text, data.isFinal);
        }
      } catch (error) {
        console.error('Error parsing transcription message:', error);
        this.handleError(error as Error);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket connection closed');
      if (!this.userStopped) {
        this.reconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private async initializeAudioRecording(): Promise<void> {
    // Served from /audio-worklet/ which maps to node_modules/.../dist/
    const workletUrl = '/audio-worklet/pcm-audio-worklet.min.js';

    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // sampleRate is a hint, not a guarantee — verify it was respected
    if (this.audioContext.sampleRate !== 16000) {
      throw new Error(
        `AudioContext sample rate is ${this.audioContext.sampleRate}Hz, expected 16000Hz. ` +
        `Your browser or hardware does not support this rate.`
      );
    }

    this.pcmRecorder = new PCMRecorder(workletUrl);

    this.pcmRecorder.addEventListener('audio', (event) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      // TypedEventTarget types event as InputAudioEvent for the 'audio' key — data is Float32Array
      const base64 = this.float32ArrayToBase64(event.data);
      this.ws.send(JSON.stringify({ audio: base64 }));
    });

    // If StartRecordingOptions has a different shape than { audioContext }, check Task 1 Step 3 result
    await this.pcmRecorder.startRecording({ audioContext: this.audioContext });
    console.log('PCMRecorder started');
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
    this.stop();           // fires 'disconnected' status first
    this.config.onError?.(error);  // demo.html then sets final 'error' status
  }
}
