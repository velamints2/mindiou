# MindIOU Stamp-P4 通信协议 v1

轻量显示与交互终端协议。Stamp-P4 只做薄客户端：接收显示指令、渲染文本卡片、
上报按键/导航事件、心跳、ACK、自动重连。业务状态机、AI 反馈、清偿逻辑全部在服务端。

第一版传输：WebSocket + JSON UTF-8。不使用 BLE / CRC8 / MTU 分片。

## 通用规则

- 所有消息为 JSON 对象，UTF-8 编码，字段 `type` 必填。
- 服务端→设备的显示消息必须带 `messageId`（uuid）。
- 设备成功解析并提交到显示队列后，必须回 `ack { messageId }`。
- 设备用 `messageId` 去重；重复消息不重复翻页。
- 设备断线重连后重发 `device_hello` 与 `capabilities`；服务端据此重发当前页。

## 消息目录

### 设备 → 服务端

#### device_hello
连接建立或重连后第一个消息。
```json
{ "type": "device_hello", "deviceId": "stamp-p4-001", "firmwareVersion": "0.1.0", "protocolVersion": 1 }
```

#### capabilities
声明设备能力。Stamp-P4 第一版：1280×720 物理画布，640×200 逻辑内容区，无触摸无语音。
```json
{
  "type": "capabilities",
  "display": { "physicalWidth": 1280, "physicalHeight": 720, "logicalWidth": 640, "logicalHeight": 200, "color": true, "scroll": false },
  "input": { "buttons": true, "touch": false, "voice": false },
  "camera": false,
  "audio": false
}
```

#### input_event
用户输入。event 至少为 next / repeat / finish；其余可选。
```json
{ "type": "input_event", "event": "next", "timestamp": 0 }
```

#### device_status
周期性状态上报。
```json
{ "type": "device_status", "battery": null, "wifiRssi": -50, "freeHeap": 1000000 }
```

#### ack
对某条服务端显示消息的确认。
```json
{ "type": "ack", "messageId": "uuid" }
```

#### pong
对 ping 的应答。
```json
{ "type": "pong", "timestamp": 0 }
```

### 服务端 → 设备

#### display_text
纯文本页（整屏替换）。
```json
{ "type": "display_text", "messageId": "uuid", "title": "认知欠条", "text": "内容", "page": 1, "pageCount": 2 }
```

#### display_card
卡片页。cardType 决定渲染样式：question 大字 / feedback、reference 小字 / status 状态条。
```json
{ "type": "display_card", "messageId": "uuid", "cardType": "question|feedback|reference|status", "title": "标题", "body": "正文", "footer": "下一张" }
```

#### clear_display
清屏。
```json
{ "type": "clear_display", "messageId": "uuid" }
```

#### set_brightness
亮度 0-255。
```json
{ "type": "set_brightness", "messageId": "uuid", "value": 200 }
```

#### ping
心跳。
```json
{ "type": "ping", "timestamp": 0 }
```

#### error
服务端错误提示。
```json
{ "type": "error", "messageId": "uuid", "code": "bad_message", "message": "无法解析" }
```

## 显示映射（640×200 逻辑 → 1280×720 物理）

- 逻辑内容区 640×200 居中于物理画布，周围黑色。
- 保留约 5 行文本限制；长文本分页，不滚动。
- 第一版白字黑底，无动画、无图标、无 HTML 渲染。

## 输入映射到状态机

| input_event.event | clearanceFlow 动作 |
| --- | --- |
| next | control: next |
| repeat | control: repeat |
| finish | control: end |
| known | control: continue |
| tap | control: continue |
| double_tap | control: repeat |
| long_press | control: end |
