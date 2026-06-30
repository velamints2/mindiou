export const PCM_SAMPLE_RATE = 16000;
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * 2;
export const PCM_BATCH_MS = 2200;
export const STT_RETRY_BACKOFF_MS = 5000;
export const MAX_PCM_BUFFER_BYTES = PCM_BYTES_PER_SECOND * 15;

export function pcmDurationMs(byteLength: number): number {
  return Math.round(Math.max(0, byteLength) / (PCM_BYTES_PER_SECOND / 1000));
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
