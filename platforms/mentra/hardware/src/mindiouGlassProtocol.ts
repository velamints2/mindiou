/**
 * MindIOU Glasses BLE Protocol v1 · TypeScript 参考编解码。
 *
 * 用途：自有硬件（MindIOU Clip 类夹片/单色屏眼镜）与 MentraOS 手机端 SGC
 * 之间的最小协议。只覆盖清偿场景需要的三件事：
 *   1. 手机 → 眼镜：整屏文本页（标题+正文）、清屏、短确认条；
 *   2. 眼镜 → 手机：按键/触控手势/电量/应答事件；
 *   3. 大包分片与重组（单色屏一页 UTF-8 中文很容易超过单帧）。
 *
 * 帧格式见 hardware/mindiou-ble-protocol.md。本文件是唯一事实来源的
 * 可执行部分，测试即协议行为规格。
 */

export const PROTOCOL_VERSION = 0x01;
/** 单帧最大负载（字节）。按 ATT MTU 185（有效 182）留 6 字节帧头/CRC 余量。 */
export const CHUNK_PAYLOAD_MAX = 176;

export const FLAG_MORE = 0x01;
export const FLAG_CONTINUATION = 0x02;

/** 手机 → 眼镜 */
export const MSG_DISPLAY_CLEAR = 0x01;
export const MSG_DISPLAY_PAGE = 0x02;
export const MSG_DISPLAY_TOAST = 0x03;
export const MSG_PING = 0x10;

/** 眼镜 → 手机 */
export const MSG_EVENT_BUTTON = 0x81;
export const MSG_EVENT_TOUCH = 0x82;
export const MSG_EVENT_BATTERY = 0x83;
export const MSG_ACK = 0x84;
export const MSG_HELLO = 0x85;

export enum Gesture {
  TAP = 1,
  DOUBLE_TAP = 2,
  TRIPLE_TAP = 3,
  PRESS_HOLD = 4,
  SWIPE_UP = 5,
  SWIPE_DOWN = 6
}

export enum PressType {
  SHORT = 0,
  LONG = 1
}

export interface Frame {
  type: number;
  seq: number;
  payload: Uint8Array;
}

/* ---------- CRC8 (poly 0x07, init 0x00) ---------- */

export function crc8(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

/* ---------- 编码 ---------- */

function encodeSingleFrame(type: number, seq: number, flags: number, payload: Uint8Array): Uint8Array {
  if (payload.length > 250) throw new Error("单帧负载超过 250 字节");
  const frame = new Uint8Array(5 + payload.length + 1);
  frame[0] = PROTOCOL_VERSION;
  frame[1] = type;
  frame[2] = seq & 0xff;
  frame[3] = flags;
  frame[4] = payload.length;
  frame.set(payload, 5);
  frame[frame.length - 1] = crc8(frame.subarray(0, frame.length - 1));
  return frame;
}

/**
 * 把一条消息编码为一串 BLE 写包。负载超过 CHUNK_PAYLOAD_MAX 时自动分片：
 * 首帧不带 CONTINUATION，后续帧带；除最后一帧外都带 MORE。全部分片共享
 * 同一 seq，接收方按 seq 重组。
 */
export function encodeMessage(type: number, seq: number, payload: Uint8Array): Uint8Array[] {
  if (payload.length <= CHUNK_PAYLOAD_MAX) {
    return [encodeSingleFrame(type, seq, 0, payload)];
  }
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let first = true;
  while (offset < payload.length) {
    const slice = payload.subarray(offset, offset + CHUNK_PAYLOAD_MAX);
    offset += slice.length;
    const more = offset < payload.length;
    const flags = (more ? FLAG_MORE : 0) | (first ? 0 : FLAG_CONTINUATION);
    chunks.push(encodeSingleFrame(type, seq, flags, slice));
    first = false;
  }
  return chunks;
}

/* ---------- 解码 ---------- */

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

/**
 * 流式重组器。push() 接收一次 BLE 通知的原始字节，
 * 返回本次凑齐的完整消息（通常 0 或 1 条）。
 */
export class FrameDecoder {
  private buffer: { type: number; seq: number; parts: Uint8Array[] } | null = null;

  push(bytes: Uint8Array): Frame[] {
    if (bytes.length < 6) throw new ProtocolError("帧过短");
    const [version, type, seq, flags, length] = bytes;
    if (version !== PROTOCOL_VERSION) throw new ProtocolError(`不支持的协议版本 ${version}`);
    if (bytes.length !== 6 + Number(length)) throw new ProtocolError("帧长度不一致");
    const expectCrc = bytes[bytes.length - 1]!;
    if (crc8(bytes.subarray(0, bytes.length - 1)) !== expectCrc) {
      throw new ProtocolError("CRC 校验失败");
    }
    const payload = bytes.subarray(5, 5 + Number(length));
    const more = (Number(flags) & FLAG_MORE) !== 0;
    const continuation = (Number(flags) & FLAG_CONTINUATION) !== 0;

    if (!continuation) {
      if (this.buffer) {
        // 协议规定「上一组作废」：丢弃残留分片再报错，
        // 下一个首帧即可重新同步（丢包/重复包后的恢复路径）。
        this.buffer = null;
        throw new ProtocolError("上一组分片未结束就来了新首帧");
      }
      if (!more) return [{ type: Number(type), seq: Number(seq), payload }];
      this.buffer = { type: Number(type), seq: Number(seq), parts: [payload] };
      return [];
    }
    if (!this.buffer || this.buffer.seq !== Number(seq) || this.buffer.type !== Number(type)) {
      // 乱序/错配的续帧：作废当前组并报错，等待下一个首帧重新同步。
      this.buffer = null;
      throw new ProtocolError("续帧与首帧不匹配");
    }
    this.buffer.parts.push(payload);
    if (more) return [];
    const total = this.buffer.parts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(total);
    let at = 0;
    for (const part of this.buffer.parts) {
      merged.set(part, at);
      at += part.length;
    }
    const frame: Frame = { type: this.buffer.type, seq: this.buffer.seq, payload: merged };
    this.buffer = null;
    return [frame];
  }
}

/* ---------- 负载助手 ---------- */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** DISPLAY_PAGE 负载：[titleLen:1][title UTF-8][body UTF-8]。 */
export function encodeDisplayPage(title: string, body: string): Uint8Array {
  const titleBytes = encoder.encode(title);
  if (titleBytes.length > 250) throw new ProtocolError("标题过长");
  const bodyBytes = encoder.encode(body);
  const payload = new Uint8Array(1 + titleBytes.length + bodyBytes.length);
  payload[0] = titleBytes.length;
  payload.set(titleBytes, 1);
  payload.set(bodyBytes, 1 + titleBytes.length);
  return payload;
}

export function decodeDisplayPage(payload: Uint8Array): { title: string; body: string } {
  if (payload.length < 1) throw new ProtocolError("DISPLAY_PAGE 负载为空");
  const titleLength = payload[0]!;
  if (payload.length < 1 + titleLength) throw new ProtocolError("DISPLAY_PAGE 标题长度越界");
  return {
    title: decoder.decode(payload.subarray(1, 1 + titleLength)),
    body: decoder.decode(payload.subarray(1 + titleLength))
  };
}

export function encodeToast(text: string): Uint8Array {
  return encoder.encode(text);
}

export type GlassesEvent =
  | { kind: "button"; buttonId: number; pressType: "short" | "long" }
  | { kind: "touch"; gesture: keyof typeof Gesture }
  | { kind: "battery"; level: number; charging: boolean }
  | { kind: "ack"; ackedSeq: number; ok: boolean }
  | { kind: "hello"; firmware: string; capabilities: number };

/** 把一条完整的眼镜上行消息解码为结构化事件。 */
export function decodeGlassesEvent(frame: Frame): GlassesEvent {
  const p = frame.payload;
  switch (frame.type) {
    case MSG_EVENT_BUTTON: {
      if (p.length < 2) throw new ProtocolError("BUTTON 事件负载过短");
      return { kind: "button", buttonId: p[0]!, pressType: p[1] === PressType.LONG ? "long" : "short" };
    }
    case MSG_EVENT_TOUCH: {
      if (p.length < 1) throw new ProtocolError("TOUCH 事件负载过短");
      const name = Gesture[p[0]!] as keyof typeof Gesture | undefined;
      if (!name) throw new ProtocolError(`未知手势编码 ${p[0]}`);
      return { kind: "touch", gesture: name };
    }
    case MSG_EVENT_BATTERY: {
      if (p.length < 2) throw new ProtocolError("BATTERY 事件负载过短");
      return { kind: "battery", level: p[0]!, charging: p[1] !== 0 };
    }
    case MSG_ACK: {
      if (p.length < 2) throw new ProtocolError("ACK 负载过短");
      return { kind: "ack", ackedSeq: p[0]!, ok: p[1] === 0 };
    }
    case MSG_HELLO: {
      if (p.length < 3) throw new ProtocolError("HELLO 负载过短");
      return { kind: "hello", firmware: `${p[0]}.${p[1]}`, capabilities: p[2]! };
    }
    default:
      throw new ProtocolError(`非眼镜上行消息类型 0x${frame.type.toString(16)}`);
  }
}

/* ---------- BLE 标识（与协议文档一致） ---------- */

export const BLE_IDS = {
  service: "6d696e64-696f-7500-8000-00805f9b34fb",
  /** 手机 → 眼镜（Write / Write No Response） */
  tx: "6d696e64-696f-7500-8001-00805f9b34fb",
  /** 眼镜 → 手机（Notify） */
  rx: "6d696e64-696f-7500-8002-00805f9b34fb"
} as const;
