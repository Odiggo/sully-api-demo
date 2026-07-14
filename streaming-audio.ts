export function streamingAudioLevel(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.min(1, Math.sqrt(sum / samples.length) * 8);
}

export function encodeStreamingAudio(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 4_096) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 4_096));
  }
  return btoa(binary);
}
