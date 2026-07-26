# MindIOU Glasses BLE Protocol v1

自有硬件（MindIOU Clip 类单色屏眼镜）与 MentraOS 手机端 SGC 之间的最小协议。
范围纪律：只覆盖清偿场景——整屏文本下行、事件上行。麦克风音频沿用 G2 策略
（由手机麦克风采集），不在本协议内。参考编解码见 `src/mindiouGlassProtocol.ts`，
测试即行为规格。

## 1. GATT 布局

| 项 | UUID | 属性 |
| --- | --- | --- |
| Service | `6d696e64-696f-7500-8000-00805f9b34fb` | primary |
| TX（手机→眼镜） | `…-8001-…` | Write / Write Without Response |
| RX（眼镜→手机） | `…-8002-…` | Notify |

- 广播名前缀：`MindIOU-`（SGC 据此识别）。
- 协商 MTU ≥ 185；若协商失败按 20 字节 MTU 退化（分片机制兼容）。
- 连接建立后眼镜立即发送一次 HELLO。

## 2. 帧格式

```text
[0]  VERSION      = 0x01
[1]  MSG_TYPE     消息类型
[2]  SEQ          0-255 递增回绕；同一消息的全部分片共享同一 seq
[3]  FLAGS        bit0 MORE（还有续帧） bit1 CONTINUATION（本帧是续帧）
[4]  PAYLOAD_LEN  0-250
[5…] PAYLOAD
[-1] CRC8         poly 0x07, init 0x00，覆盖 [0..-2]
```

- 单帧 PAYLOAD ≤ 176 字节（`CHUNK_PAYLOAD_MAX`，按 MTU 185 留余量）。
- 超过即分片：首帧不带 CONTINUATION；续帧带；除末帧外都带 MORE。
- 接收方校验 VERSION、长度、CRC；任一失败丢帧。首帧到达时若上一组
  分片未齐，上一组作废并视为协议错误。

## 3. 消息类型

### 手机 → 眼镜

| 类型 | 名称 | 负载 |
| --- | --- | --- |
| 0x01 | DISPLAY_CLEAR | 空；清屏 |
| 0x02 | DISPLAY_PAGE | `[titleLen:1][title UTF-8][body UTF-8]`；整屏替换 |
| 0x03 | DISPLAY_TOAST | UTF-8 短文本；即时确认条（如「已收到」），下一页到来前保持 |
| 0x10 | PING | 空；保活 |

### 眼镜 → 手机

| 类型 | 名称 | 负载 |
| --- | --- | --- |
| 0x81 | EVENT_BUTTON | `[buttonId][pressType]` pressType：0 短按 / 1 长按 |
| 0x82 | EVENT_TOUCH | `[gesture]`：1 TAP 2 DOUBLE_TAP 3 TRIPLE_TAP 4 PRESS_HOLD 5 SWIPE_UP 6 SWIPE_DOWN |
| 0x83 | EVENT_BATTERY | `[level 0-100][charging 0/1]` |
| 0x84 | ACK | `[ackedSeq][status]` status：0 成功 |
| 0x85 | HELLO | `[fwMajor][fwMinor][capabilities]` capabilities bit0=有触控条 bit1=有按键 bit2=有单色屏 |

## 4. 显示语义（与 TPA 对齐）

- 一屏 = 一条 DISPLAY_PAGE：title ≤ 18 字符，body ≤ 92 字符（UTF-8 分片后重组）。
- 大字号问题页与小字号反馈页由 SGC 按 TPA 的 referenceCard/title 映射渲染；
  本协议不传输字号，由眼镜固件按「title 大 / body 小」固定渲染。
- 无滚动：长内容由手机端分页为多屏，靠 SWIPE_UP/DOWN 或 TAP 翻页。
- 每收到一屏，眼镜回 ACK；SGC 未收到 ACK 可重发同 seq。

## 5. 事件语义（与 TPA 控制映射一致）

| 事件 | 清偿动作 |
| --- | --- |
| TAP / 按键短按 | 继续（翻页 → 追问 → 结算） |
| DOUBLE_TAP | 重看当前页 |
| TRIPLE_TAP | 下一张欠条 |
| PRESS_HOLD / 按键长按 | 结束并结算 |
| SWIPE_UP / SWIPE_DOWN | 反馈/结算翻页 |

## 6. 明确不做

- 不传输音频（麦克风走手机，同 G2）；不传图片/位图（v1 单色文本足够）。
- 不做配对码/多用户；复用 MentraOS 既有蓝牙配对。
- 不做 OTA；固件升级另行定义。
