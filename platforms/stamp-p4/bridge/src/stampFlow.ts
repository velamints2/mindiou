/**
 * 把 clearanceFlow 状态机接到 Stamp 设备。
 * 每台就绪的 Stamp 设备一个 ClearanceRuntime：
 * - FlowPorts.show → StampSession（GlassesDisplayAdapter）
 * - 设备 input_event → runtime.dispatch(control)
 * 业务逻辑全部在 mentra 的 clearanceFlow 与共享后端，本文件只做接线。
 */
import type { BackendClient } from "../../../mentra/src/backendClient.js";
import { ClearanceRuntime, portsFromBackend } from "../../../mentra/src/clearanceFlow.js";
import type { GlassesDisplayAdapter } from "./stampAdapter.js";
import { showScreen } from "./stampAdapter.js";

/** 把 GlassesDisplayAdapter 包装成 clearanceFlow 的 show 端口。 */
export function showViaAdapter(adapter: GlassesDisplayAdapter): (screen: import("../../../mentra/src/clearanceFlow.js").ScreenSpec) => void {
  return screen => {
    // show 端口是同步签名；异步发送在后台进行，错误只记录不抛出（避免拖垮状态机）。
    void showScreen(adapter, screen).catch(() => {});
  };
}

export interface StampFlowOptions {
  backend: BackendClient;
  adapter: GlassesDisplayAdapter;
  /** 状态机派发的控制动作日志（可选）。 */
  onDispatch?(action: string): void;
}

/** 为一台 Stamp 设备创建清偿运行时。 */
export function createStampRuntime(options: StampFlowOptions): ClearanceRuntime {
  const runtime = new ClearanceRuntime(portsFromBackend(options.backend, showViaAdapter(options.adapter)));
  return runtime;
}

/** 把设备控制动作喂给运行时。action 来自 inputToControl。 */
export async function dispatchControl(runtime: ClearanceRuntime, action: string): Promise<void> {
  await runtime.dispatch({ type: "control", action });
}

/** 启动一台设备的清偿流程（拉取入口欠条并显示第一张卡）。 */
export async function startStampFlow(runtime: ClearanceRuntime): Promise<void> {
  await runtime.dispatch({ type: "start" });
}
