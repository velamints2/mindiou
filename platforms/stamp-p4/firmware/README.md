# MindIOU Stamp-P4 固件（ESP-IDF）

阶段3：Wi-Fi + WebSocket + JSON + ACK + 重连 + 串口输入 + Mock 显示。
薄客户端：业务状态机 / AI / 清偿逻辑全部在服务端，固件只做显示与输入转发。

## 构建前提

- ESP-IDF v5.x（支持 ESP32-P4）
- 目标芯片 ESP32-P4 + Stamp AddOn C6（Wi-Fi）

## 配置

```bash
idf.py set-target esp32p4
idf.py menuconfig   # MindIOU Stamp-P4 菜单：Wi-Fi SSID/密码、Bridge URI、设备 ID
```

关键项（sdkconfig.defaults 已给默认值）：
- `CONFIG_MINDIOU_WIFI_SSID` / `CONFIG_MINDIOU_WIFI_PASSWORD`
- `CONFIG_MINDIOU_BRIDGE_URI`（如 `ws://192.168.1.100:7020`）
- `CONFIG_MINDIOU_DEVICE_ID`

## 显示后端编译开关

```bash
CONFIG_MINDIOU_DISPLAY_MOCK=y        # 串口日志显示（当前默认）
CONFIG_MINDIOU_DISPLAY_MIPI_DSI=n    # 真实 MIPI，资料不全前保持 n
```

**禁止**在未获得完整资料前把 `MIPI_DSI` 设为 `y`。缺少资料时 `display_service.c`
会因 `#error` 主动编译失败并列出缺失项，防止填入虚构参数。

真实 MIPI 启用前必须齐全（见 display_service.c TODO）：
- Stamp-P4 完整 DSI Pin 定义
- 驱动板 35Pin 完整 Pin 定义
- OVP0921 MIPI 输入 Pin / 时序 / 电压域 / RESET 与 I2C 要求
- 实际转接 PCB

## 构建与烧录

```bash
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor
```

## 第一版输入

串口监视器按键模拟（无物理按键时）：
- `n` = next
- `r` = repeat
- `f` = finish

## 模块

| 文件 | 职责 |
|---|---|
| `app_main.c` | 启动流程 + 重连主循环 |
| `wifi_client.c` | Wi-Fi 连接与 RSSI |
| `websocket_client.c` | WebSocket 收发、握手、消息分发、ACK |
| `protocol_parser.c` | JSON 解析/构造、messageId 去重（cJSON） |
| `display_service.c` | 统一显示接口 + Mock / MIPI（预留）后端 |
| `input_service.c` | 串口输入模拟（后续接真实按键） |
| `device_state.c` | 连接状态机 + 指数退避 |

## 连接与恢复

- Wi-Fi 自动连接；WebSocket 自动连接
- 指数退避，最大 30s（`CONFIG_MINDIOU_RECONNECT_MAX_MS`）
- 定期 device_status 上报；服务端 ping → 设备 pong
- 断线屏幕显示「连接已断开，正在重连」（Mock 后端打印到串口）
- 重连后重发 device_hello + capabilities；服务端据此重发当前页
- messageId 去重（环形缓冲 32 条）；不在设备端持久化业务状态

## 未验证声明

本固件尚未在真实 Stamp-P4 硬件上编译或烧录验证。
当前仅保证代码结构正确、与 bridge 协议一致（protocol.md）。
真实编译需 ESP-IDF 环境；真实显示需阶段4资料。
