/**
 * Platform adapter contracts. Interfaces only: Even Hub, MentraOS, or future
 * hardware each provide their own implementation.
 */
import type { GlassesAction, QueueState } from "./types";

export interface GlassesDisplayAdapter {
  /** Render the full queue state; implementations replace the whole viewport. */
  render(state: QueueState): void;
  /** Short-lived confirmation message (e.g. "已标记"). */
  showTransient(message: string): void;
  clear(): void;
}

export interface GlassesInputAdapter {
  start(handler: (action: GlassesAction) => void): void;
  stop(): void;
}

export interface GlassesStorageAdapter {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
}

/** Optional capability: voice input/output on platforms that support it. */
export interface GlassesAudioAdapter {
  isAvailable(): boolean;
}

export interface GlassesLifecycleAdapter {
  onForeground(handler: () => void): void;
  onExit(handler: () => void): void;
}
