/**
 * MockDisplayBackend：无真实屏幕时把内容输出到日志/内存，验证协议与状态机。
 * 对应固件的串口 Mock 显示后端。
 */
import type { ScreenSpec } from "../../../mentra/src/clearanceFlow.js";
import type { GlassesDisplayAdapter } from "./stampAdapter.js";

export interface MockDisplayFrame {
  kind: "text" | "card" | "clear" | "brightness";
  screen?: ScreenSpec;
  value?: number;
}

export class MockDisplayBackend implements GlassesDisplayAdapter {
  readonly frames: MockDisplayFrame[] = [];

  async showText(screen: ScreenSpec): Promise<void> {
    this.frames.push({ kind: "text", screen });
  }

  async showCard(screen: ScreenSpec): Promise<void> {
    this.frames.push({ kind: "card", screen });
  }

  async clear(): Promise<void> {
    this.frames.push({ kind: "clear" });
  }

  async setBrightness(value: number): Promise<void> {
    this.frames.push({ kind: "brightness", value });
  }

  /** 最近一次显示文本（便于断言）。 */
  lastText(): string {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (f?.screen?.text) return f.screen.text;
    }
    return "";
  }
}
