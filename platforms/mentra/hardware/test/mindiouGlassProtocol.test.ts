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

  it("丢包报错后能重新同步：下一条消息正常解码（上一组按协议作废）", () => {
    const payload = new Uint8Array(CHUNK_PAYLOAD_MAX + 10);
    const chunks = encodeMessage(MSG_DISPLAY_PAGE, 5, payload);
    const decoder = new FrameDecoder();
    decoder.push(chunks[0]!); // 首帧，续帧丢失
    const [lost] = encodeMessage(MSG_DISPLAY_PAGE, 6, new Uint8Array([1]));
    expect(() => decoder.push(lost!)).toThrow(ProtocolError);
    // 重发一条全新消息：解码器必须恢复，而不是永久卡死。
    const [fresh] = encodeMessage(MSG_DISPLAY_PAGE, 7, new TextEncoder().encode("重新同步"));
    const frames = decoder.push(fresh!);
    expect(frames).toHaveLength(1);
    expect(new TextDecoder().decode(frames[0]!.payload)).toBe("重新同步");
  });

  it("重复首帧报错且不污染后续重组", () => {
    const payload = new Uint8Array(CHUNK_PAYLOAD_MAX + 10);
    const chunks = encodeMessage(MSG_DISPLAY_PAGE, 5, payload);
    const decoder = new FrameDecoder();
    decoder.push(chunks[0]!);
    expect(() => decoder.push(chunks[0]!)).toThrow(ProtocolError); // 重复首帧
    // 重新发送完整分片序列可正常重组。
    const done: ReturnType<FrameDecoder["push"]> = [];
    for (const chunk of chunks) done.push(...decoder.push(chunk));
    expect(done).toHaveLength(1);
    expect(done[0]!.payload.length).toBe(payload.length);
  });

  it("乱序续帧（seq 不匹配）报错并可恢复", () => {
    const payloadA = new Uint8Array(CHUNK_PAYLOAD_MAX + 10).fill(1);
    const payloadB = new Uint8Array(CHUNK_PAYLOAD_MAX + 10).fill(2);
    const chunksA = encodeMessage(MSG_DISPLAY_PAGE, 5, payloadA);
    const chunksB = encodeMessage(MSG_DISPLAY_PAGE, 6, payloadB);
    const decoder = new FrameDecoder();
    decoder.push(chunksA[0]!);
    expect(() => decoder.push(chunksB[1]!)).toThrow(ProtocolError); // B 的续帧错配
    const [fresh] = encodeMessage(MSG_DISPLAY_PAGE, 7, new Uint8Array([9]));
    expect(decoder.push(fresh!)).toHaveLength(1);
  });

  it("帧过短与长度不一致都被拒绝", () => {
    const decoder = new FrameDecoder();
    expect(() => decoder.push(new Uint8Array([1, 2, 3]))).toThrow(ProtocolError);
    const [frame] = encodeMessage(MSG_DISPLAY_PAGE, 1, new Uint8Array([1, 2, 3]));
    const truncated = frame!.subarray(0, frame!.length - 2); // 少一字节 → 长度不符
    expect(() => decoder.push(truncated)).toThrow(ProtocolError);
  });

  it("恰好 CHUNK_PAYLOAD_MAX 的负载保持单帧", () => {
    const chunks = encodeMessage(MSG_DISPLAY_PAGE, 3, new Uint8Array(CHUNK_PAYLOAD_MAX));
    expect(chunks).toHaveLength(1);
    const decoder = new FrameDecoder();
    expect(decoder.push(chunks[0]!)).toHaveLength(1);
  });

  it("seq 回绕 255 可正常往返", () => {
    const [frame] = encodeMessage(MSG_DISPLAY_PAGE, 255, new Uint8Array([1]));
    const frames = new FrameDecoder().push(frame!);
    expect(frames[0]!.seq).toBe(255);
  });

  it("空负载消息（PING/DISPLAY_CLEAR）往返", () => {
    const decoder = new FrameDecoder();
    for (const type of [0x10, 0x01]) {
      const [frame] = encodeMessage(type, 1, new Uint8Array(0));
      const frames = decoder.push(frame!);
      expect(frames).toHaveLength(1);
      expect(frames[0]!.payload.length).toBe(0);
    }
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

  it("ACK 成功与失败", () => {
    expect(decodeGlassesEvent(frameOf(0x84, [42, 0]))).toEqual({ kind: "ack", ackedSeq: 42, ok: true });
    expect(decodeGlassesEvent(frameOf(0x84, [42, 1]))).toEqual({ kind: "ack", ackedSeq: 42, ok: false });
  });

  it("非法上行消息类型被明确拒绝", () => {
    expect(() => decodeGlassesEvent(frameOf(0x90, [1]))).toThrow(ProtocolError);
    // 手机下行消息不应进入眼镜事件解码器
    expect(() => decodeGlassesEvent(frameOf(MSG_DISPLAY_PAGE, [1]))).toThrow(ProtocolError);
  });

  it("负载过短的事件被明确拒绝", () => {
    expect(() => decodeGlassesEvent(frameOf(MSG_EVENT_BUTTON, [0]))).toThrow(ProtocolError);
    expect(() => decodeGlassesEvent(frameOf(MSG_EVENT_TOUCH, []))).toThrow(ProtocolError);
    expect(() => decodeGlassesEvent(frameOf(MSG_EVENT_BATTERY, [80]))).toThrow(ProtocolError);
    expect(() => decodeGlassesEvent(frameOf(MSG_HELLO, [1, 2]))).toThrow(ProtocolError);
  });
});
