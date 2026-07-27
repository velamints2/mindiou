/**
 * MindIouMentraServer：把清偿状态机接到 MentraOS 事件与显示布局上。
 * 业务逻辑全部在 clearanceFlow（纯状态机）与共享后端；本文件只做接线。
 */
import { AppServer, AppSession } from "@mentra/sdk";
import type { AppServerConfig } from "@mentra/sdk";
import type { BackendClient } from "./backendClient.js";
import { ClearanceRuntime, portsFromBackend, ScreenSpec } from "./clearanceFlow.js";

export interface MindIouMentraOptions {
  config: AppServerConfig;
  backend: BackendClient;
}

export function showOnSession(session: AppSession): (screen: ScreenSpec) => void {
  return screen => {
    if (screen.layout === "referenceCard") {
      session.layouts.showReferenceCard(screen.title || "", screen.text || "");
      return;
    }
    if (screen.layout === "doubleTextWall") {
      session.layouts.showDoubleTextWall(screen.top || "", screen.bottom || "");
      return;
    }
    session.layouts.showTextWall(screen.text || "");
  };
}

export class MindIouMentraServer extends AppServer {
  private readonly backend: BackendClient;

  constructor(options: MindIouMentraOptions) {
    super(options.config);
    this.backend = options.backend;
  }

  protected async onSession(session: AppSession): Promise<void> {
    const runtime = new ClearanceRuntime(portsFromBackend(this.backend, showOnSession(session)));

    // 语音：只处理最终转写；短指令导航，长句作为学习回答。
    session.events.onTranscription(data => {
      if (!data.isFinal || !data.text) return;
      void runtime.handleUtterance(data.text);
    });
    // 触控条手势（G2）。
    session.events.onTouchEvent(event => {
      void runtime.handleGesture(event.gesture_name);
    });
    // 物理按键：短按继续，长按结束。
    session.events.onButtonPress(button => {
      void runtime.handleButton(button.pressType);
    });

    await runtime.dispatch({ type: "start" });
  }
}
