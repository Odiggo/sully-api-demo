export function streamingAudioLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.min(1, Math.sqrt(sum / samples.length) * 8);
}

export function encodeStreamingAudio(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const scaled = sample < 0 ? sample * 32_768 : sample * 32_767;
    view.setInt16(index * 2, scaled, true);
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 4_096) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 4_096));
  }
  return btoa(binary);
}
