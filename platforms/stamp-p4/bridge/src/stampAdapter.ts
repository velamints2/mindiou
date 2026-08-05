/**
 * GlassesDisplayAdapter 抽象：clearanceFlow 与具体显示传输之间的最小接口。
 * Mentra 与 Stamp 各自实现，业务状态机不感知差异。
 */
import type { ScreenSpec } from "../../../mentra/src/clearanceFlow.js";
import type { StampInputEventName } from "./protocol.js";

export type { StampInputEventName };

/** 显示适配器：把中立屏幕描述渲染到具体设备。 */
export interface GlassesDisplayAdapter {
  showText(screen: ScreenSpec): Promise<void>;
  showCard(screen: ScreenSpec): Promise<void>;
  clear(): Promise<void>;
  setBrightness(value: number): Promise<void>;
}

export interface GlassesInputEvent {
  type: StampInputEventName;
}

/** 把 ScreenSpec 按 layout 分发到 showText / showCard。 */
export async function showScreen(adapter: GlassesDisplayAdapter, screen: ScreenSpec): Promise<void> {
  if (screen.layout === "textWall") {
    await adapter.showText(screen);
    return;
  }
  await adapter.showCard(screen);
}
