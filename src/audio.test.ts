import { describe, expect, it } from "vitest";
import {
  MAX_PCM_BUFFER_BYTES,
  isFatalSttError,
  nextPcmFlushDelayMs,
  pcmDurationMs
} from "./audio";

describe("G2 PCM scheduling", () => {
  it("matches the real-device 1600-byte 50ms chunk cadence", () => {
    expect(pcmDurationMs(1600)).toBe(50);
    expect(pcmDurationMs(1_176_000)).toBe(36_750);
  });

  it("does not immediately flush audio accumulated during an in-flight request", () => {
    expect(nextPcmFlushDelayMs(10_500, 10_000)).toBe(1700);
    expect(nextPcmFlushDelayMs(12_100, 10_000)).toBe(250);
  });

  it("honors retry backoff and caps the intended buffer at 15 seconds", () => {
    expect(nextPcmFlushDelayMs(10_500, 10_000, 15_000)).toBe(4500);
    expect(pcmDurationMs(MAX_PCM_BUFFER_BYTES)).toBe(15_000);
  });

  it("classifies configuration errors as fatal without blocking transient errors", () => {
    expect(isFatalSttError("OPENAI_API_KEY is not set")).toBe(true);
    expect(isFatalSttError("HTTP 401 Unauthorized")).toBe(true);
    expect(isFatalSttError("Failed to fetch")).toBe(false);
    expect(isFatalSttError("STT HTTP 500")).toBe(false);
  });
});
