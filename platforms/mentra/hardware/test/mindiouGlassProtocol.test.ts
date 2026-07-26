import { describe, expect, it } from "vitest";
import {
  CHUNK_PAYLOAD_MAX,
  FrameDecoder,
  Gesture,
  MSG_DISPLAY_PAGE,
  MSG_EVENT_BATTERY,
  MSG_EVENT_BUTTON,
  MSG_EVENT_TOUCH,
  MSG_HELLO,
  ProtocolError,
  crc8,
  decodeDisplayPage,
  decodeGlassesEvent,
  encodeDisplayPage,
  encodeMessage
} from "../src/mindiouGlassProtocol.js";

describe("crc8", () => {
  it("空输入为 0", () => {
    expect(crc8(new Uint8Array([]))).toBe(0);
  });

  it("标准校验向量 123456789 → 0xF4", () => {
    expect(crc8(new TextEncoder().encode("123456789"))).toBe(0xf4);
  });
});

describe("encodeMessage / FrameDecoder", () => {
  it("小负载单帧往返", () => {
    const payload = new TextEncoder().encode("已收到");
    const [frameBytes] = encodeMessage(MSG_DISPLAY_PAGE, 7, payload);
    const decoder = new FrameDecoder();
    const frames = decoder.push(frameBytes!);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: MSG_DISPLAY_PAGE, seq: 7 });
    expect(new TextDecoder().decode(frames[0]!.payload)).toBe("已收到");
  });

  it("大负载自动分片并重组", () => {
    const payload = new Uint8Array(CHUNK_PAYLOAD_MAX * 2 + 40).map((_, i) => i % 251);
    const chunks = encodeMessage(MSG_DISPLAY_PAGE, 42, payload);
    expect(chunks.length).toBe(3);
    const decoder = new FrameDecoder();
    const done: ReturnType<FrameDecoder["push"]> = [];
    for (const chunk of chunks) done.push(...decoder.push(chunk));
    expect(done).toHaveLength(1);
    expect(done[0]!.seq).toBe(42);
    expect(Array.from(done[0]!.payload)).toEqual(Array.from(payload));
  });

  it("CRC 损坏被拒", () => {
    const [frameBytes] = encodeMessage(MSG_DISPLAY_PAGE, 1, new Uint8Array([1, 2, 3]));
    const corrupted = frameBytes!.slice();
    corrupted[corrupted.length - 1]! ^= 0xff;
    expect(() => new FrameDecoder().push(corrupted)).toThrow(ProtocolError);
  });

  it("版本不符被拒", () => {
    const [frameBytes] = encodeMessage(MSG_DISPLAY_PAGE, 1, new Uint8Array([9]));
    const wrong = frameBytes!.slice();
    wrong[0] = 0x99;
    expect(() => new FrameDecoder().push(wrong)).toThrow(ProtocolError);
  });

  it("续帧丢失后新首帧报错", () => {
    const payload = new Uint8Array(CHUNK_PAYLOAD_MAX + 10);
    const chunks = encodeMessage(MSG_DISPLAY_PAGE, 5, payload);
    const decoder = new FrameDecoder();
    decoder.push(chunks[0]!); // 首帧，等待续帧
    const [other] = encodeMessage(MSG_DISPLAY_PAGE, 6, new Uint8Array([1]));
    expect(() => decoder.push(other!)).toThrow(ProtocolError);
  });
});

describe("DISPLAY_PAGE 负载", () => {
  it("中文标题与正文往返", () => {
    const payload = encodeDisplayPage("反馈 1/2 · 继续练习", "要把传输层和浏览器读取分开。");
    expect(decodeDisplayPage(payload)).toEqual({
      title: "反馈 1/2 · 继续练习",
      body: "要把传输层和浏览器读取分开。"
    });
  });

  it("空标题可用", () => {
    expect(decodeDisplayPage(encodeDisplayPage("", "只有正文"))).toEqual({ title: "", body: "只有正文" });
  });
});

describe("decodeGlassesEvent", () => {
  function frameOf(type: number, payload: number[]) {
    const decoder = new FrameDecoder();
    const [bytes] = encodeMessage(type, 1, new Uint8Array(payload));
    return decoder.push(bytes!)[0]!;
  }

  it("按键短按/长按", () => {
    expect(decodeGlassesEvent(frameOf(MSG_EVENT_BUTTON, [0, 0]))).toEqual({
      kind: "button",
      buttonId: 0,
      pressType: "short"
    });
    expect(decodeGlassesEvent(frameOf(MSG_EVENT_BUTTON, [0, 1]))).toEqual({
      kind: "button",
      buttonId: 0,
      pressType: "long"
    });
  });

  it("触控手势映射与未知手势拒绝", () => {
    expect(decodeGlassesEvent(frameOf(MSG_EVENT_TOUCH, [Gesture.PRESS_HOLD]))).toEqual({
      kind: "touch",
      gesture: "PRESS_HOLD"
    });
    expect(() => decodeGlassesEvent(frameOf(MSG_EVENT_TOUCH, [99]))).toThrow(ProtocolError);
  });

  it("电量与 HELLO", () => {
    expect(decodeGlassesEvent(frameOf(MSG_EVENT_BATTERY, [80, 1]))).toEqual({
      kind: "battery",
      level: 80,
      charging: true
    });
    expect(decodeGlassesEvent(frameOf(MSG_HELLO, [1, 2, 0b00000001]))).toEqual({
      kind: "hello",
      firmware: "1.2",
      capabilities: 1
    });
  });
});
