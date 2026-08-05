# Stamp-P4 浏览器模拟器

在没有 MIPI 转接板时验证完整业务链路。

## 使用

```bash
# 终端1：启动 bridge
cd ../bridge && npm install && npm run build
STAMP_BRIDGE_PORT=7020 node dist/server.js

# 终端2：启动模拟器（任意静态服务器）
cd ../simulator && npx serve . -l 7030
# 打开 http://127.0.0.1:7030
```

> 注：模拟器引用 `simulator.ts`。直接打开需先用 esbuild/tsc 编译为 `simulator.js`，
> 或使用支持 TS 的 dev server（如 `npx vite`）。

## 功能

- 连接同一个 WebSocket bridge
- 显示 640×200 逻辑内容区（居中于 1280×720 物理画布，周围黑色）
- next / repeat / finish 按钮（键盘 n / r / f）
- 显示收到的原始 JSON 与事件日志
- 显示连接状态
- 自动 ACK（含 messageId 去重，重复消息不重复翻页）
- 断线自动重连（指数退避，最大 30s）
