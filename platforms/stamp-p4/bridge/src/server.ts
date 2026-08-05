/**
 * Stamp-P4 WebSocket bridge 入口。
 * 管理多台 Stamp 设备连接；阶段1仅完成通信与 MockDisplay 验证，
 * 阶段2把 clearanceFlow 的 FlowPorts.show 接到每个会话的 StampDisplayAdapter。
 */
import { WebSocketServer, WebSocket } from "ws";
import { StampSession, type StampTransport } from "./stampSession.js";

export interface BridgeOptions {
  port: number;
  /** 心跳间隔（ms）。 */
  heartbeatMs?: number;
  /** 业务控制动作回调（阶段2接入 clearanceFlow dispatch）。 */
  onControl?(deviceId: string, action: string): void;
}

export class StampBridge {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<string, StampSession>();
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
      onControl: action => this.options.onControl?.(session.deviceId, action),
      onReady: s => {
        this.sessions.set(s.deviceId, s);
        console.error(`[stamp-bridge] 设备就绪: ${s.deviceId}`);
      },
      onClose: s => {
        this.sessions.delete(s.deviceId);
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
