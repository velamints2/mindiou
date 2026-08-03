/**
 * Even Hub lifecycle adapter: maps FOREGROUND_ENTER_EVENT(4) to foreground
 * handlers and FOREGROUND_EXIT_EVENT(5) / ABNORMAL_EXIT_EVENT(6) to exit
 * handlers. Exit handlers persist the queue state so a killed or backgrounded
 * WebView restores the same session.
 */
import { OsEventTypeList, type EvenAppBridge } from "@evenrealities/even_hub_sdk";
import type { GlassesLifecycleAdapter } from "../glasses-core/adapters";

export class EvenHubLifecycleAdapter implements GlassesLifecycleAdapter {
  private readonly unsubscribe: () => void;
  private readonly foregroundHandlers: Array<() => void> = [];
  private readonly exitHandlers: Array<() => void> = [];

  constructor(bridge: EvenAppBridge) {
    this.unsubscribe = bridge.onEvenHubEvent(event => {
      const type = event.sysEvent?.eventType;
      if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
        for (const handler of this.foregroundHandlers) handler();
      } else if (
        type === OsEventTypeList.FOREGROUND_EXIT_EVENT ||
        type === OsEventTypeList.ABNORMAL_EXIT_EVENT
      ) {
        for (const handler of this.exitHandlers) handler();
      }
    });
  }

  onForeground(handler: () => void): void {
    this.foregroundHandlers.push(handler);
  }

  onExit(handler: () => void): void {
    this.exitHandlers.push(handler);
  }

  stop(): void {
    this.unsubscribe();
  }
}
