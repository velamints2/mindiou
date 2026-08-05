/**
 * 单个 Stamp-P4 设备的会话。
 * 负责：WebSocket 收发、messageId 去重、ACK、断线状态、当前页缓存（用于重连恢复）、
 * 把 clearanceFlow 的 ScreenSpec 经 Stamp 协议推给设备，把设备 input_event 转成状态机控制动作。
 */
import type { ScreenSpec } from "../../../mentra/src/clearanceFlow.js";
import { screenToCard } from "./displayMapper.js";
import {
  newMessageId,
  parseDeviceMessage,
  PROTOCOL_VERSION,
  type CapabilitiesMessage,
  type DeviceCapabilities,
  type DeviceMessage,
  type ServerMessage,
  type StampInputEventName
} from "./protocol.js";
import type { GlassesDisplayAdapter } from "./stampAdapter.js";

/** 设备 input_event → clearanceFlow 控制动作。 */
export function inputToControl(event: StampInputEventName): string | null {
  switch (event) {
    case "next":
      return "next";
    case "repeat":
    case "double_tap":
      return "repeat";
    case "finish":
    case "long_press":
      return "end";
    case "known":
    case "tap":
      return "continue";
    default:
      return null;
  }
}

export interface StampTransport {
  send(data: string): void;
  close(): void;
  readyState: number;
}

export interface StampSessionHandlers {
  /** 业务控制动作（next/repeat/end/continue）。 */
  onControl(action: string): void;
  /** 设备首次/重连握手完成。 */
  onReady?(session: StampSession): void;
  onClose?(session: StampSession): void;
}

const WS_OPEN = 1;
const DEDUP_MAX = 200;

export class StampSession implements GlassesDisplayAdapter {
  deviceId: string;
  private capabilities: DeviceCapabilities | null = null;
  private ready = false;
  /** 已收到的设备消息去重（input_event 等带 messageId 时）。 */
  private readonly seenInbound = new Set<string>();
  /** 已发送待 ACK 的显示消息。 */
  private readonly pendingAck = new Map<string, ServerMessage>();
  /** 最近一次成功显示的卡片（用于断线重连恢复）。 */
  private lastCard: ServerMessage | null = null;
  private closed = false;

  constructor(
    private readonly transport: StampTransport,
    private readonly handlers: StampSessionHandlers,
    deviceIdHint = "stamp-p4-unknown"
  ) {
    this.deviceId = deviceIdHint;
  }

  isReady(): boolean {
    return this.ready && !this.closed && this.transport.readyState === WS_OPEN;
  }

  getCapabilities(): DeviceCapabilities | null {
    return this.capabilities;
  }

  /** 处理设备入站原始消息。 */
  handleRaw(raw: string): void {
    const msg = parseDeviceMessage(raw);
    if (!msg) {
      this.send({ type: "error", messageId: newMessageId(), code: "bad_message", message: "无法解析的消息" });
      return;
    }
    this.handleMessage(msg);
  }

  private handleMessage(msg: DeviceMessage): void {
    switch (msg.type) {
      case "device_hello": {
        // 新的握手视为一次（重）连接：复位 closed，使 isReady() 在 capabilities 后重新成立。
        this.closed = false;
        this.deviceId = msg.deviceId;
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          this.send({ type: "error", messageId: newMessageId(), code: "protocol_mismatch", message: `协议版本不支持: ${msg.protocolVersion}` });
        }
        // 等待 capabilities 后视为就绪。
        return;
      }
      case "capabilities": {
        this.capabilities = capabilitiesFromMessage(msg);
        const wasReady = this.ready;
        this.ready = true;
        if (!wasReady) {
          this.handlers.onReady?.(this);
          // 重连恢复：有缓存页则重发。
          if (this.lastCard) this.send(this.lastCard);
        }
        return;
      }
      case "input_event": {
        const action = inputToControl(msg.event);
        if (action) this.handlers.onControl(action);
        return;
      }
      case "ack": {
        this.pendingAck.delete(msg.messageId);
        return;
      }
      case "device_status":
      case "pong":
        return;
      default:
        return;
    }
  }

  /* ---------- GlassesDisplayAdapter ---------- */

  async showText(screen: ScreenSpec): Promise<void> {
    await this.showCard(screen);
  }

  async showCard(screen: ScreenSpec): Promise<void> {
    const card = screenToCard(screen);
    this.lastCard = card;
    this.send(card);
  }

  async clear(): Promise<void> {
    this.lastCard = null;
    this.send({ type: "clear_display", messageId: newMessageId() });
  }

  async setBrightness(value: number): Promise<void> {
    const clamped = Math.max(0, Math.min(255, Math.round(value)));
    this.send({ type: "set_brightness", messageId: newMessageId(), value: clamped });
  }

  /* ---------- 内部 ---------- */

  private send(msg: ServerMessage): void {
    if (this.closed || this.transport.readyState !== WS_OPEN) return;
    if ("messageId" in msg && (msg.type === "display_text" || msg.type === "display_card" || msg.type === "clear_display" || msg.type === "set_brightness")) {
      this.pendingAck.set(msg.messageId, msg);
      if (this.pendingAck.size > DEDUP_MAX) {
        const firstKey = this.pendingAck.keys().next().value;
        if (firstKey) this.pendingAck.delete(firstKey);
      }
    }
    this.transport.send(JSON.stringify(msg));
  }

  /** 设备断开。 */
  markClosed(): void {
    this.closed = true;
    this.ready = false;
    this.handlers.onClose?.(this);
  }

  /** 心跳。 */
  ping(): void {
    this.send({ type: "ping", timestamp: Date.now() });
  }

  /** 当前缓存页（测试与重连恢复用）。 */
  getLastCard(): ServerMessage | null {
    return this.lastCard;
  }

  getPendingAckCount(): number {
    return this.pendingAck.size;
  }
}

function capabilitiesFromMessage(msg: CapabilitiesMessage): DeviceCapabilities {
  return {
    display: msg.display,
    input: msg.input,
    camera: Boolean(msg.camera),
    audio: Boolean(msg.audio)
  };
}
