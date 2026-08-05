# MindIOU Stamp-P4 轻量运行端

让 M5Stack Stamp-P4（ESP32-P4 + Stamp AddOn C6 Wi-Fi）成为 MindIOU 的轻量显示与交互终端。

**这不是**移植完整 MentraOS，也不是在 ESP32-P4 上运行 Node.js / Android / Mentra SDK。
Stamp-P4 只做薄客户端：接收显示指令、渲染文本卡片、上报按键/导航、心跳、ACK、自动重连。
业务状态机（clearanceFlow）、AI 反馈、清偿逻辑全部在服务端 / 现有 Node.js 服务中运行。

## 架构

```
手机/Web（业务逻辑、语音、AI）
   ↓ HTTP
MindIOU 后端（server.js，/api/mentra/clearance-entry、/api/mvp1/*）
   ↑ 复用
clearanceFlow 状态机（platforms/mentra/src/clearanceFlow.ts，纯逻辑，无 SDK 依赖）
   ↓ FlowPorts.show(screen: ScreenSpec)
StampDisplayAdapter（bridge/src/stampSession.ts）
   ↓ WebSocket + JSON（protocol.md）
Stamp-P4（薄客户端：渲染 + 输入 + 心跳 + ACK + 重连）
```

## 目录

- `protocol.md` — 通信协议 v1（WebSocket + JSON，无 BLE/CRC8/MTU）
- `bridge/` — TypeScript WebSocket 桥（复用 mentra clearanceFlow，不重写状态机）
- `firmware/` — ESP-IDF 固件（阶段3起；第一版仅 Wi-Fi + Mock 串口显示）
- `simulator/` — 浏览器模拟器（无 MIPI 转接板时验证完整链路）

## 显示

- 逻辑内容区 640×200，居中于 1280×720 物理画布，周围黑色
- 约 5 行文本，长内容分页不滚动，白字黑底
- 与 platforms/mentra/displayText.ts 约束一致（复用其分页/截断常量）

## 输入

- 第一版无眼镜端语音；最少 next / repeat / finish
- 无物理按键时：串口命令 n/r/f + 模拟器网页按钮
- 语音回答仍由 Web / 手机端完成

## 硬件（阶段3起，资料不全前不启用真实显示）

- M5Stack Stamp-P4（ESP32-P4）+ Stamp AddOn C6（Wi-Fi）
- 目标显示：1280×720，2-Lane MIPI DSI，OVP0921 控制器 + OVP2200 LCOS
- **禁止猜测 MIPI Pin 定义 / 时序 / OVP0921 参数**；资料不足时停在 Mock 显示

## 阶段

- 阶段1：软件通信（WebSocket + JSON + Mock 显示）✅ 当前
- 阶段2：接入 clearanceFlow（Mentra/Stamp 双 adapter）
- 阶段3：固件网络层（Wi-Fi/WS/JSON/ACK/重连/串口输入/Mock 显示）
- 阶段4：真实 MIPI 显示（需完整资料，否则停止并列出缺失信息）
