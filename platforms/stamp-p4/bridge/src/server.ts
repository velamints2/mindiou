/**
 * Stamp-P4 WebSocket bridge 入口。
 * 管理多台 Stamp 设备连接。
 * 若提供 flowBackend，则每台就绪设备接入 clearanceFlow（Mentra/Stamp 共用同一状态机）。
 */
import { WebSocketServer, WebSocket } from "ws";
import type { BackendClient } from "../../../mentra/src/backendClient.js";
import type { ClearanceRuntime } from "../../../mentra/src/clearanceFlow.js";
import { createStampRuntime, dispatchControl, startStampFlow } from "./stampFlow.js";
import { StampSession, type StampTransport } from "./stampSession.js";

export interface BridgeOptions {
  port: number;
  /** 心跳间隔（ms）。 */
  heartbeatMs?: number;
  /** 业务控制动作回调（无 flowBackend 时使用；有 flowBackend 时仅作旁路日志）。 */
  onControl?(deviceId: string, action: string): void;
  /** 共享后端客户端；提供后每台设备接入真实清偿流程。 */
  flowBackend?: BackendClient;
  /** 设备就绪后是否自动开始清偿流程（默认 true，需 flowBackend）。 */
  autoStartFlow?: boolean;
}

export class StampBridge {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<string, StampSession>();
  private readonly runtimes = new Map<string, ClearanceRuntime>();
  private readonly heartbeatMs: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: BridgeOptions) {
    this.heartbeatMs = options.heartbeatMs ?? 15000;
    this.wss = new WebSocketServer({ port: options.port });
    this.wss.on("connection", ws => this.handleConnection(ws));
  }

  private handleConnection(ws: WebSocket): void {
    const transport: StampTransport = {
      send: data => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close: () => ws.close(),
      get readyState() {
        return ws.readyState;
      }
    };

    const session = new StampSession(transport, {
      onControl: action => {
        this.options.onControl?.(session.deviceId, action);
        const runtime = this.runtimes.get(session.deviceId);
        if (runtime) {
          void dispatchControl(runtime, action).catch(error => {
            console.error(`[stamp-bridge] 控制派发失败 ${session.deviceId}:`, error instanceof Error ? error.message : String(error));
          });
        }
      },
      onReady: s => {
        this.sessions.set(s.deviceId, s);
        console.error(`[stamp-bridge] 设备就绪: ${s.deviceId}`);
        // 接入真实清偿流程（复用 clearanceFlow，不复制业务逻辑）。
        if (this.options.flowBackend && !this.runtimes.has(s.deviceId)) {
          const runtime = createStampRuntime({ backend: this.options.flowBackend, adapter: s });
          this.runtimes.set(s.deviceId, runtime);
          if (this.options.autoStartFlow !== false) {
            void startStampFlow(runtime).catch(error => {
              console.error(`[stamp-bridge] 启动清偿失败 ${s.deviceId}:`, error instanceof Error ? error.message : String(error));
            });
          }
        }
      },
      onClose: s => {
        this.sessions.delete(s.deviceId);
        this.runtimes.delete(s.deviceId);
        console.error(`[stamp-bridge] 设备断开: ${s.deviceId}`);
      }
    });

    ws.on("message", raw => {
      try {
        session.handleRaw(String(raw));
      } catch (error) {
        console.error("[stamp-bridge] 消息处理异常:", error instanceof Error ? error.message : String(error));
      }
    });
    ws.on("close", () => session.markClosed());
    ws.on("error", () => session.markClosed());
  }

  getSession(deviceId: string): StampSession | undefined {
    return this.sessions.get(deviceId);
  }

  getRuntime(deviceId: string): ClearanceRuntime | undefined {
    return this.runtimes.get(deviceId);
  }

  getDeviceIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  start(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const session of this.sessions.values()) session.ping();
    }, this.heartbeatMs);
    console.error(`[stamp-bridge] 监听 :${this.options.port}`);
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await new Promise<void>(resolve => this.wss.close(() => resolve()));
  }
}

/* 直接运行时启动。 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.STAMP_BRIDGE_PORT || 7020);
  const bridge = new StampBridge({
    port,
    onControl: (deviceId, action) => {
      console.error(`[stamp-bridge] 控制动作 ${deviceId}: ${action}`);
    }
  });
  bridge.start();
  process.on("SIGINT", () => void bridge.stop().then(() => process.exit(0)));
}
