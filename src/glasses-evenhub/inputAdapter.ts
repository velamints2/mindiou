/**
 * Even Hub input adapter: subscribes to onEvenHubEvent and maps touchpad
 * events to glasses-core gestures, then to core actions via the centralized
 * mapGestureToAction. Reducing is synchronous, so every recognized input gets
 * immediate on-lens feedback; frame coalescing for bursts lives in the
 * display adapter's latest-frame write queue.
 *
 * Event codes: CLICK_EVENT(0), SCROLL_TOP_EVENT(1), SCROLL_BOTTOM_EVENT(2),
 * DOUBLE_CLICK_EVENT(3). Zero-valued click types are dropped by JSON round
 * trips, so an untyped sysEvent on the event-capturing container is treated
 * as a click (same observation as the legacy surface).
 */
import { OsEventTypeList, type EvenAppBridge, type EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type { GlassesInputAdapter } from "../glasses-core/adapters";
import { mapGestureToAction } from "../glasses-core/store";
import type { CardLayer, CoreAction, Gesture, GlassesAction } from "../glasses-core/types";

const GESTURE_DEBOUNCE_MS = 120;

export interface EvenHubInputDeps {
  /** Current reveal layer, needed because double_click depends on it. */
  getLayer: () => CardLayer;
  /** Debug hook for the phone console (gesture description, never secrets). */
  onEvent?: (description: string) => void;
}

export function evenHubEventToGesture(event: EvenHubEvent): Gesture | null {
  const textType = event.textEvent?.eventType;
  const sysType = event.sysEvent?.eventType;
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT || sysType === OsEventTypeList.SCROLL_TOP_EVENT) {
    return "swipe_up";
  }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT || sysType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    return "swipe_down";
  }
  if (textType === OsEventTypeList.DOUBLE_CLICK_EVENT || sysType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    return "double_click";
  }
  if (textType === OsEventTypeList.CLICK_EVENT || sysType === OsEventTypeList.CLICK_EVENT) {
    return "click";
  }
  if (event.sysEvent && sysType === undefined && !event.textEvent && !event.listEvent && !event.audioEvent) {
    return "click";
  }
  return null;
}

export class EvenHubInputAdapter implements GlassesInputAdapter {
  private unsubscribe: (() => void) | null = null;
  private lastGestureAt = 0;

  constructor(
    private readonly bridge: EvenAppBridge,
    private readonly deps: EvenHubInputDeps
  ) {}

  start(handler: (action: GlassesAction) => void): void {
    this.stop();
    // The core reducer accepts CoreAction; double_click on deeper layers
    // produces the internal LAYER_BACK, which is still a core-level action.
    const dispatch = handler as (action: CoreAction) => void;
    this.unsubscribe = this.bridge.onEvenHubEvent(event => {
      const gesture = evenHubEventToGesture(event);
      if (!gesture) return;
      const now = Date.now();
      if (now - this.lastGestureAt < GESTURE_DEBOUNCE_MS) {
        this.deps.onEvent?.(`忽略过快的 ${gesture}`);
        return;
      }
      this.lastGestureAt = now;
      const action = mapGestureToAction(gesture, this.deps.getLayer());
      this.deps.onEvent?.(`${gesture} → ${action}`);
      dispatch(action);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
