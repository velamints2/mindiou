import { describe, expect, it, vi } from "vitest";
import type { ScreenSpec } from "../../../mentra/src/clearanceFlow.js";
import { StampSession, inputToControl, type StampTransport } from "../src/stampSession.js";

function makeTransport() {
  const sent: string[] = [];
  const transport: StampTransport = {
    send: (d: string) => { sent.push(d); },
    close: () => {},
    readyState: 1
  };
  return { transport, sent };
}

function handshake(session: StampSession, deviceId = "d1") {
  session.handleRaw(JSON.stringify({ type: "device_hello", deviceId, firmwareVersion: "0.1.0", protocolVersion: 1 }));
  session.handleRaw(JSON.stringify({
    type: "capabilities",
    display: { physicalWidth: 1280, physicalHeight: 720, logicalWidth: 640, logicalHeight: 200, color: true, scroll: false },
    input: { buttons: true, touch: false, voice: false },
    camera: false,
    audio: false
  }));
}

const questionScreen: ScreenSpec = { layout: "referenceCard", title: "欠条 1/2", text: "解释索引" };

describe("input_event 映射（5）", () => {
  it("next/repeat/finish/known/tap/long_press", () => {
    expect(inputToControl("next")).toBe("next");
    expect(inputToControl("repeat")).toBe("repeat");
    expect(inputToControl("double_tap")).toBe("repeat");
    expect(inputToControl("finish")).toBe("end");
    expect(inputToControl("long_press")).toBe("end");
    expect(inputToControl("known")).toBe("continue");
    expect(inputToControl("tap")).toBe("continue");
  });
});

describe("会话握手与显示", () => {
  it("capabilities 后就绪并触发 onReady", () => {
    const { transport } = makeTransport();
    const onReady = vi.fn();
    const s = new StampSession(transport, { onControl: () => {}, onReady });
    expect(s.isReady()).toBe(false);
    handshake(s, "stamp-p4-001");
    expect(s.isReady()).toBe(true);
    expect(s.deviceId).toBe("stamp-p4-001");
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("showCard 发送 display_card 并缓存当前页", async () => {
    const { transport, sent } = makeTransport();
    const s = new StampSession(transport, { onControl: () => {} });
    handshake(s);
    await s.showCard(questionScreen);
    const msg = JSON.parse(sent[sent.length - 1]!);
    expect(msg.type).toBe("display_card");
    expect(msg.cardType).toBe("question");
    expect(s.getLastCard()?.type).toBe("display_card");
  });

  it("clear 发送 clear_display 并清空缓存", async () => {
    const { transport, sent } = makeTransport();
    const s = new StampSession(transport, { onControl: () => {} });
    handshake(s);
    await s.showCard(questionScreen);
    await s.clear();
    const msg = JSON.parse(sent[sent.length - 1]!);
    expect(msg.type).toBe("clear_display");
    expect(s.getLastCard()).toBeNull();
  });

  it("set_brightness 限制在 0-255", async () => {
    const { transport, sent } = makeTransport();
    const s = new StampSession(transport, { onControl: () => {} });
    handshake(s);
    await s.setBrightness(999);
    const msg = JSON.parse(sent[sent.length - 1]!);
    expect(msg.value).toBe(255);
  });
});

describe("ACK 处理（7）", () => {
  it("显示消息进入待 ACK，收到 ack 后移除", async () => {
    const { transport, sent } = makeTransport();
    const s = new StampSession(transport, { onControl: () => {} });
    handshake(s);
    await s.showCard(questionScreen);
    expect(s.getPendingAckCount()).toBe(1);
    const sentMsg = JSON.parse(sent[sent.length - 1]!);
    s.handleRaw(JSON.stringify({ type: "ack", messageId: sentMsg.messageId }));
    expect(s.getPendingAckCount()).toBe(0);
  });
});

describe("断线与重连恢复（8,9）", () => {
  it("断开后未就绪，重连 capabilities 后重发当前页", async () => {
    const { transport, sent } = makeTransport();
    const s = new StampSession(transport, { onControl: () => {} });
    handshake(s);
    await s.showCard(questionScreen);
    const beforeCount = sent.length;
    s.markClosed();
    expect(s.isReady()).toBe(false);
    // 重连
    transport.readyState = 1;
    const sentBefore = sent.length;
    handshake(s);
    expect(s.isReady()).toBe(true);
    // 重发当前页
    expect(sent.length).toBe(sentBefore + 1);
    const replayed = JSON.parse(sent[sent.length - 1]!);
    expect(replayed.type).toBe("display_card");
    expect(beforeCount).toBeGreaterThan(0);
  });

  it("断开时不发送消息", async () => {
    const { transport, sent } = makeTransport();
    const s = new StampSession(transport, { onControl: () => {} });
    handshake(s);
    s.markClosed();
    transport.readyState = 3; // CLOSED
    const before = sent.length;
    await s.showCard(questionScreen);
    expect(sent.length).toBe(before);
  });
});

describe("输入事件触发控制回调", () => {
  it("input_event 转成 onControl", () => {
    const { transport } = makeTransport();
    const onControl = vi.fn();
    const s = new StampSession(transport, { onControl });
    handshake(s);
    s.handleRaw(JSON.stringify({ type: "input_event", event: "next", timestamp: 0 }));
    expect(onControl).toHaveBeenCalledWith("next");
  });
});

describe("异常输入", () => {
  it("非法 JSON 回 error 不崩溃", () => {
    const { transport, sent } = makeTransport();
    const s = new StampSession(transport, { onControl: () => {} });
    s.handleRaw("{bad json");
    const msg = JSON.parse(sent[sent.length - 1]!);
    expect(msg.type).toBe("error");
    expect(msg.code).toBe("bad_message");
  });
});
