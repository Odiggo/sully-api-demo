/**
 * Browser-based implementation of Sully AI's WebSocket streaming demo
 */
export interface StreamingConfig {
  duration?: number;
  onTranscription?: (text: string) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  onStatusChange?: (
    status: 'starting' | 'connecting' | 'connected' | 'disconnected' | 'error',
  ) => void;
}

interface StreamingToken {
  token: string;
  apiUrl: string;
  accountId: string;
}

export class SullyStreamingDemo {
  private ws: WebSocket | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
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

        const countdownInterval = setInterval(() => {
          remainingTime--;
          console.log(`Recording time remaining: ${remainingTime} seconds`);

          if (remainingTime <= 0) {
            clearInterval(countdownInterval);
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
    console.log('Stopping Sully Streaming Demo...');
    this.config.onStatusChange?.('disconnected');
    if (this.mediaRecorder) {
      console.log('Stopping media recorder');
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      console.log('Stopping audio tracks');
      this.stream.getTracks().forEach((track) => track.stop());
    }
    if (this.ws) {
      console.log('Closing WebSocket connection');
      this.ws.close();
    }
    console.log('Cleanup complete');
    this.config.onComplete?.();
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

    const fullUrl = `${wsUrl}/audio/transcriptions/stream?account_id=${accountId}&api_token=${token}`;
    console.log('Connecting to WebSocket:', wsUrl);

    this.ws = new WebSocket(fullUrl);

    // Wait for connection to be established and confirmed
    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not initialized'));

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'status' && data.status === 'connected') {
            console.log('WebSocket connection confirmed');
            resolve();
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
          reject(new Error('Failed to parse WebSocket message'));
        }
      };

      this.ws.onopen = () => {
        console.log('WebSocket connection established');
      };
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(new Error('WebSocket connection failed'));
      };
    });

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle status messages
        if (data.type === 'status') {
          console.log('Received status message:', data);
          if (data.status === 'disconnected') {
            console.log('Server initiated disconnection');
            this.config.onStatusChange?.('disconnected');
            this.stop();
            return;
          }
        }

        // Handle transcription messages
        if (data.text) {
          console.log('Received transcription:', data);
          this.updateSegments(data.text, data.isFinal);
        }
      } catch (error) {
        console.error('Error parsing transcription message:', error);
        this.handleError(error as Error);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket connection closed');
      this.stop();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private async initializeAudioRecording(): Promise<void> {
    try {
      console.log('Requesting microphone access...');
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      console.log('Microphone access granted');

      this.mediaRecorder = new MediaRecorder(this.stream);
      console.log('MediaRecorder initialized');

      this.mediaRecorder.ondataavailable = async (event) => {
        console.log(
          'Received audio chunk',
          event.data.size,
          this.ws?.readyState,
        );

        if (event.data.size > 0 && this.ws?.readyState === WebSocket.OPEN) {
          console.log(
            `Processing audio chunk of size: ${event.data.size} bytes`,
          );
          // base64 encode the blob
          function blobToBase64(blob: Blob) {
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () =>
                resolve(reader.result?.toString()?.split(',')[1]);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }

          const base64 = await blobToBase64(event.data);
          console.log('Sending audio chunk to server');
          this.ws.send(JSON.stringify({ audio: base64 }));
        }
      };

      // Start recording with small timeslices for real-time streaming
      console.log('Starting MediaRecorder with 1s timeslices');
      this.mediaRecorder.start(1000);
    } catch (error) {
      console.error('Error in initializeAudioRecording:', error);
      this.handleError(error as Error);
    }
  }

  private handleError(error: Error): void {
    console.error('Sully Streaming Demo error:', error);
    this.config.onError?.(error);
    this.stop();
  }
}
