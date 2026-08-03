/**
 * Even Hub storage adapter: prefers the SDK's setLocalStorage/getLocalStorage
 * (host-persisted), with browser localStorage as the fallback so the queue
 * also survives WebView restarts in preview. Values written here include the
 * device token; they must never be logged or copied anywhere else.
 */
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import type { GlassesStorageAdapter } from "../glasses-core/adapters";

export class EvenHubStorageAdapter implements GlassesStorageAdapter {
  constructor(private bridge: EvenAppBridge | null = null) {}

  setBridge(bridge: EvenAppBridge | null): void {
    this.bridge = bridge;
  }

  async load(key: string): Promise<string | null> {
    if (this.bridge) {
      try {
        const value = await this.bridge.getLocalStorage(key);
        if (typeof value === "string" && value) return value;
      } catch {
        // Fall through to browser storage.
      }
    }
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async save(key: string, value: string): Promise<void> {
    if (this.bridge) {
      try {
        await this.bridge.setLocalStorage(key, value);
      } catch {
        // Browser fallback below still persists the value.
      }
    }
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private mode or disabled storage: session continues in memory.
    }
  }
}
