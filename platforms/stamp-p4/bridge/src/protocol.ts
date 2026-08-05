/**
 * Stamp-P4 通信协议类型定义（v1）。
 * 与 platforms/stamp-p4/protocol.md 保持一致。
 * WebSocket + JSON UTF-8；不使用 BLE / CRC8 / MTU 分片。
 */

export const PROTOCOL_VERSION = 1;

/* ---------- 显示布局（与 mentra ScreenSpec 对齐，中立结构） ---------- */
export type StampLayout = "referenceCard" | "doubleTextWall" | "textWall";

export interface StampScreen {
  layout: StampLayout;
  title?: string;
  text?: string;
  top?: string;
  bottom?: string;
}

/* ---------- 设备能力 ---------- */
export interface DisplayCapabilities {
  physicalWidth: number;
  physicalHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  color: boolean;
  scroll: boolean;
}

export interface InputCapabilities {
  buttons: boolean;
  touch: boolean;
  voice: boolean;
}

export interface DeviceCapabilities {
  display: DisplayCapabilities;
  input: InputCapabilities;
  camera: boolean;
  audio: boolean;
}

/* ---------- 输入事件 ---------- */
export type StampInputEventName =
  | "next"
  | "repeat"
  | "finish"
  | "known"
  | "tap"
  | "double_tap"
  | "long_press";

/* ---------- 设备 → 服务端 ---------- */
export interface DeviceHelloMessage {
  type: "device_hello";
  deviceId: string;
  firmwareVersion: string;
  protocolVersion: number;
}

export interface CapabilitiesMessage {
  type: "capabilities";
  display: DisplayCapabilities;
  input: InputCapabilities;
  camera: boolean;
  audio: boolean;
}

export interface InputEventMessage {
  type: "input_event";
  event: StampInputEventName;
  timestamp: number;
}

export interface DeviceStatusMessage {
  type: "device_status";
  battery: number | null;
  wifiRssi: number | null;
  freeHeap: number | null;
}

export interface AckMessage {
  type: "ack";
  messageId: string;
}

export interface PongMessage {
  type: "pong";
  timestamp: number;
}

export type DeviceMessage =
  | DeviceHelloMessage
  | CapabilitiesMessage
  | InputEventMessage
  | DeviceStatusMessage
  | AckMessage
  | PongMessage;

/* ---------- 服务端 → 设备 ---------- */
export type CardType = "question" | "feedback" | "reference" | "status";

export interface DisplayTextMessage {
  type: "display_text";
  messageId: string;
  title: string;
  text: string;
  page: number;
  pageCount: number;
}

export interface DisplayCardMessage {
  type: "display_card";
  messageId: string;
  cardType: CardType;
  title: string;
  body: string;
  footer: string;
}

export interface ClearDisplayMessage {
  type: "clear_display";
  messageId: string;
}

export interface SetBrightnessMessage {
  type: "set_brightness";
  messageId: string;
  value: number;
}

export interface PingMessage {
  type: "ping";
  timestamp: number;
}

export interface ErrorMessage {
  type: "error";
  messageId: string;
  code: string;
  message: string;
}

export type ServerMessage =
  | DisplayTextMessage
  | DisplayCardMessage
  | ClearDisplayMessage
  | SetBrightnessMessage
  | PingMessage
  | ErrorMessage;

/* ---------- 解析与校验 ---------- */

/** 解析设备消息；非法输入返回 null 而不是抛错。 */
export function parseDeviceMessage(raw: string): DeviceMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Record<string, unknown>;
  const type = msg.type;
  switch (type) {
    case "device_hello":
      if (typeof msg.deviceId === "string") return msg as unknown as DeviceHelloMessage;
      return null;
    case "capabilities":
      if (typeof msg.display === "object" && typeof msg.input === "object") {
        return msg as unknown as CapabilitiesMessage;
      }
      return null;
    case "input_event":
      if (typeof msg.event === "string") return msg as unknown as InputEventMessage;
      return null;
    case "device_status":
      return msg as unknown as DeviceStatusMessage;
    case "ack":
      if (typeof msg.messageId === "string") return msg as unknown as AckMessage;
      return null;
    case "pong":
      return msg as unknown as PongMessage;
    default:
      return null;
  }
}

/** 简易 uuid 生成（服务端 messageId）。 */
export function newMessageId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
