export const PCM_SAMPLE_RATE = 16000;
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * 2;
export const PCM_BATCH_MS = 2200;
export const STT_RETRY_BACKOFF_MS = 5000;
export const MAX_PCM_BUFFER_BYTES = PCM_BYTES_PER_SECOND * 15;
export const PCM_SPEECH_RMS_THRESHOLD = 320;
export const PCM_END_SILENCE_MS = 650;
export const PCM_MAX_UTTERANCE_MS = 12000;

export function pcmDurationMs(byteLength: number): number {
  return Math.round(Math.max(0, byteLength) / (PCM_BYTES_PER_SECOND / 1000));
}

export function pcmRms(chunk: Uint8Array): number {
  const sampleCount = Math.floor(chunk.byteLength / 2);
  if (!sampleCount) return 0;
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  let sumSquares = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / sampleCount);
}

export function isSpeechPcm(chunk: Uint8Array, threshold = PCM_SPEECH_RMS_THRESHOLD): boolean {
  return pcmRms(chunk) >= threshold;
}

export function shouldFlushUtterance(
  now: number,
  utteranceStartedAt: number,
  lastSpeechAt: number
): boolean {
  if (!utteranceStartedAt || !lastSpeechAt) return false;
  return now - lastSpeechAt >= PCM_END_SILENCE_MS
    || now - utteranceStartedAt >= PCM_MAX_UTTERANCE_MS;
}

export function nextPcmFlushDelayMs(
  now: number,
  lastSentAt: number,
  retryAt = 0,
  minimumDelayMs = 250
): number {
  return Math.max(minimumDelayMs, lastSentAt + PCM_BATCH_MS - now, retryAt - now, 0);
}

export function isFatalSttError(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    "openai_api_key is not set",
    "invalid token",
    "unauthorized",
    "http 401",
    "http 403"
  ].some(marker => normalized.includes(marker));
}
