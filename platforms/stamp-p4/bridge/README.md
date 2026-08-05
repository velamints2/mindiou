# Stamp-P4 Bridge

WebSocket 桥：把 clearanceFlow 的中立屏幕输出转成 Stamp 协议推给设备，把设备输入转成状态机控制动作。

**复用而非复制**：通过相对路径 import `platforms/mentra/src/clearanceFlow.ts`（纯逻辑无 SDK 依赖），
不重写业务状态机、AI 反馈或清偿规则。

## 命令

```bash
npm install
npm run check   # tsc --noEmit
npm test        # vitest（30 测试）
npm run build   # 产出 dist/
STAMP_BRIDGE_PORT=7020 node dist/stamp-p4/bridge/src/server.js
```

## 结构

- `protocol.ts` — 协议类型与解析（device_hello/capabilities/display_*/input_event/ack/ping/pong/error）
- `displayMapper.ts` — ScreenSpec → display_card / display_text（含分页）
- `stampAdapter.ts` — GlassesDisplayAdapter 抽象（Mentra 与 Stamp 各自实现）
- `stampSession.ts` — 单设备会话：去重、ACK、断线状态、当前页缓存（重连恢复）、输入映射
- `mockDisplay.ts` — MockDisplayBackend（无屏幕时输出到内存/日志）
- `server.ts` — WebSocket 桥，多设备管理

## 与 mentra 的关系

| | Mentra | Stamp |
|---|---|---|
| 状态机 | clearanceFlow（共享） | clearanceFlow（共享） |
| 显示 adapter | `showOnSession`（@mentra/sdk layouts） | `StampSession`（WebSocket JSON） |
| 输入 | 语音/触控/按键 | 按键/串口/模拟器 |
| 传输 | BLE + Mentra Cloud | Wi-Fi WebSocket |
