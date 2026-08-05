import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { StampBridge } from "../src/server.js";

const PORT = 7391;

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function waitMessage(ws: WebSocket, predicate: (data: unknown) => boolean, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待消息超时")), timeoutMs);
    const handler = (raw: WebSocket.RawData) => {
      let data: unknown;
      try { data = JSON.parse(String(raw)); } catch { return; }
      if (predicate(data)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(data);
      }
    };
    ws.on("message", handler);
  });
}

function sendHandshake(ws: WebSocket, deviceId: string) {
  ws.send(JSON.stringify({ type: "device_hello", deviceId, firmwareVersion: "0.1.0", protocolVersion: 1 }));
  ws.send(JSON.stringify({
    type: "capabilities",
    display: { physicalWidth: 1280, physicalHeight: 720, logicalWidth: 640, logicalHeight: 200, color: true, scroll: false },
    input: { buttons: true, touch: false, voice: false },
    camera: false,
    audio: false
  }));
}

describe("StampBridge 集成", () => {
  let bridge: StampBridge;
  const controls: Array<{ deviceId: string; action: string }> = [];

  beforeEach(async () => {
    controls.length = 0;
    bridge = new StampBridge({ port: PORT, heartbeatMs: 60000, onControl: (deviceId, action) => controls.push({ deviceId, action }) });
    bridge.start();
    await new Promise(r => setTimeout(r, 100));
  });

  afterEach(async () => {
    await bridge.stop();
  });

  it("设备连接握手后就绪并可接收显示（模拟器链路）", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await waitOpen(ws);
    sendHandshake(ws, "stamp-p4-001");
    await new Promise(r => setTimeout(r, 150));
    const session = bridge.getSession("stamp-p4-001");
    expect(session?.isReady()).toBe(true);
    await session!.showCard({ layout: "referenceCard", title: "欠条 1/1", text: "解释索引" });
    const msg = await waitMessage(ws, (d: any) => d.type === "display_card");
    expect((msg as any).cardType).toBe("question");
    ws.close();
  });

  it("设备 input_event 触发 onControl 回调（5）", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await waitOpen(ws);
    sendHandshake(ws, "stamp-p4-001");
    await new Promise(r => setTimeout(r, 150));
    ws.send(JSON.stringify({ type: "input_event", event: "next", timestamp: 0 }));
    await new Promise(r => setTimeout(r, 150));
    expect(controls.some(c => c.deviceId === "stamp-p4-001" && c.action === "next")).toBe(true);
    ws.close();
  });

  it("多个 Stamp 设备隔离（14）", async () => {
    const wsA = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const wsB = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await Promise.all([waitOpen(wsA), waitOpen(wsB)]);
    sendHandshake(wsA, "stamp-A");
    sendHandshake(wsB, "stamp-B");
    await new Promise(r => setTimeout(r, 150));
    expect(bridge.getDeviceIds().sort()).toEqual(["stamp-A", "stamp-B"]);
    // 只给 A 发显示
    await bridge.getSession("stamp-A")!.showCard({ layout: "textWall", text: "仅A可见" });
    const msgA = await waitMessage(wsA, (d: any) => d.type === "display_card");
    expect((msgA as any).body).toBe("仅A可见");
    // B 不应收到该卡片（短窗口内）
    const bGot = await Promise.race([
      waitMessage(wsB, (d: any) => d.type === "display_card", 300).then(() => true).catch(() => false),
      new Promise<boolean>(r => setTimeout(() => r(false), 350))
    ]);
    expect(bGot).toBe(false);
    wsA.close();
    wsB.close();
  });

  it("WebSocket 客户端异常退出不崩溃（13）", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await waitOpen(ws);
    sendHandshake(ws, "stamp-p4-x");
    await new Promise(r => setTimeout(r, 150));
    ws.terminate();
    await new Promise(r => setTimeout(r, 200));
    expect(bridge.getSession("stamp-p4-x")).toBeUndefined();
  });

  it("Stamp 未连接时业务不会崩溃（15）", async () => {
    expect(bridge.getSession("nonexistent")).toBeUndefined();
    // 对不存在的设备发控制不应抛错
    expect(() => bridge.getDeviceIds()).not.toThrow();
  });
});
