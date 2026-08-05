import { describe, expect, it } from "vitest";
import { newMessageId, parseDeviceMessage } from "../src/protocol.js";

describe("协议解析", () => {
  it("解析 device_hello", () => {
    const msg = parseDeviceMessage(JSON.stringify({ type: "device_hello", deviceId: "d1", firmwareVersion: "0.1.0", protocolVersion: 1 }));
    expect(msg?.type).toBe("device_hello");
  });

  it("解析 capabilities", () => {
    const msg = parseDeviceMessage(JSON.stringify({
      type: "capabilities",
      display: { physicalWidth: 1280, physicalHeight: 720, logicalWidth: 640, logicalHeight: 200, color: true, scroll: false },
      input: { buttons: true, touch: false, voice: false },
      camera: false,
      audio: false
    }));
    expect(msg?.type).toBe("capabilities");
  });

  it("解析 input_event", () => {
    const msg = parseDeviceMessage(JSON.stringify({ type: "input_event", event: "next", timestamp: 0 }));
    expect(msg?.type).toBe("input_event");
  });

  it("解析 ack", () => {
    const msg = parseDeviceMessage(JSON.stringify({ type: "ack", messageId: "m-1" }));
    expect(msg?.type).toBe("ack");
  });

  it("非法 JSON 返回 null（10）", () => {
    expect(parseDeviceMessage("{not json")).toBeNull();
    expect(parseDeviceMessage("")).toBeNull();
  });

  it("未知消息类型返回 null（11）", () => {
    expect(parseDeviceMessage(JSON.stringify({ type: "unknown_type" }))).toBeNull();
  });

  it("缺少必填字段返回 null", () => {
    expect(parseDeviceMessage(JSON.stringify({ type: "device_hello" }))).toBeNull();
    expect(parseDeviceMessage(JSON.stringify({ type: "ack" }))).toBeNull();
  });

  it("newMessageId 唯一", () => {
    expect(newMessageId()).not.toBe(newMessageId());
  });
});
