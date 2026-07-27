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

### 1.1 设备发现与配对

- **广播**：眼镜上电后以 100ms 间隔主动广播，广播名前缀 `MindIOU-`，
  广播包附带 Service UUID `6d696e64-696f-7500-8000-00805f9b34fb`，
  便于 iOS/Android 后台扫描过滤。
- **扫描方**：SGC 启动时按「名称前缀 + Service UUID」双过滤扫描；发现后即发起连接，
  不要求用户在系统蓝牙界面手动选择（已配对绑定时直连，见下）。
- **配对策略**：v1 不实现应用层配对码，依赖系统级蓝牙配对
  （LE Just Works 或由 OS 在系统蓝牙设置中弹 PIN，具体由 OS 与设备能力决定）。
  系统级配对失败时，SGC 不重试应用层连接，提示用户在系统蓝牙界面完成配对。
- **绑定**：配对成功后 SGC 记录设备地址解析标识（iOS 用 `identifier`，
  Android 用 `MAC`/`address`），下次直接走直连，不再重新扫描。
- **多用户/多设备**：v1 不支持；一台手机同时只连一副 MindIOU 眼镜。
- **配对码策略明确不做**：本协议不在帧内传输 PIN/配对码，也不实现应用层
  多用户身份绑定——身份与多用户隔离在 TPA 与 MindIOU 后端完成，与眼镜无关。

### 1.2 重连策略

- **触发**：连接断开（无论主动断开还是链路丢失）后 SGC 进入重连流程。
- **退避**：指数退避，初始 1s，每次失败后乘 2，上限 30s；达到上限后保持
  30s 周期重试。
- **最大重试次数**：无限重试直到用户主动取消或 App 退出；每次重试在 UI 上
  显示「重新连接中（第 N 次）」。
- **重连成功后状态恢复**（按序执行）：
  1. 重新订阅 RX 特征值通知；
  2. 等待眼镜发送 HELLO（连接建立后眼镜立即发送一次）；
  3. HELLO 到达后，SGC 重发当前会话的「入口页」（当前欠条标题页或主菜单），
     **不**自动恢复断开前最后一屏（避免用户错过中间反馈）；
  4. 清除本地待 ACK 队列中已超时的条目（见 §7），未超时的条目可继续等待。
- **重连失败可见**：连续失败 5 次后 SGC 向 TPA 上报 `connection_degraded`，
  TPA 可在 Web 端提示用户「眼镜连接不稳定」。
- **真机验证边界**：上述退避参数与状态恢复时序未在真机验证，标记 `UNVERIFIED`；
  参考实现 `src/mindiouGlassProtocol.ts` 只覆盖帧编解码，不含重连状态机。

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
| 0x84 | ACK | `[ackedSeq][status]` status：0 成功 / 非 0 = NACK，错误码见 §9 |
| 0x85 | HELLO | `[fwMajor][fwMinor][capabilities]` capabilities bit0=有触控条 bit1=有按键 bit2=有单色屏 |

## 4. 显示语义（与 TPA 对齐）

- 一屏 = 一条 DISPLAY_PAGE：title ≤ 18 字符，body ≤ 92 字符（UTF-8 分片后重组）。
- 大字号问题页与小字号反馈页由 SGC 按 TPA 的 referenceCard/title 映射渲染；
  本协议不传输字号，由眼镜固件按「title 大 / body 小」固定渲染。
- 无滚动：长内容由手机端分页为多屏，靠 SWIPE_UP/DOWN 或 TAP 翻页。
- 每收到一屏，眼镜回 ACK；SGC 未收到 ACK 可重发同 seq。

### 4.1 显示能力假设

v1 面向「MindIOU Clip 类」单色屏眼镜，固定如下能力基线，TPA 与 SGC 按此分页：

| 项 | 数值 | 说明 |
| --- | --- | --- |
| 屏幕类型 | 单色 OLED，无背光 | 不传图片/位图 |
| 可见行数 | 4 行 | title 占第 1 行，body 占第 2-4 行 |
| title 行字符数 | ≤ 18 字节 UTF-8（≈ 9 中文字符） | 与 §3 DISPLAY_PAGE 一致 |
| body 行字符数 | ≤ 23 字节 UTF-8（≈ 11 中文字符） × 3 行 | body 合计 ≤ 92 字节 |
| title 长度 | ≤ 18 字节 UTF-8 | 协议层硬上限 |
| body 长度 | ≤ 92 字节 UTF-8 | 协议层硬上限 |
| 刷新方式 | 整屏替换，无部分刷新 | 仅 DISPLAY_CLEAR + DISPLAY_PAGE |
| 最短翻页间隔 | 300ms | 防止抖动；SGC 控制下发节奏 |
| 分页方式 | 手机端按 body 行宽硬折行，溢出部分拆为后续 DISPLAY_PAGE；SGC 用 SWIPE_UP/DOWN 翻页 | 无横向滚动 |
| 字号 | title 大字号固定，body 小字号固定 | 协议不传字号，由固件固定渲染 |
| 反色/闪烁 | 不支持 | 仅清屏 + 整屏替换 |
| 显示缓冲 | 1 屏（无后台缓冲） | 新页到达即覆盖旧页 |

超出 body 92 字节的内容，SGC **必须**在发送前分页，每页独立 ACK；
眼镜不负责自动翻页。具体分页算法见 SGC `MindiouGlasses.swift` 的
`splitBodyIntoPages(body:maxBytesPerPage:)`（见 `sgc/README.md`）。

**真机验证边界**：上述行数、字符数为「MindIOU Clip 类」硬件假设，未在真机验证，
标记 `UNVERIFIED`；实际屏参以硬件验收为准，若与之不同，TPA 分页逻辑需同步调整。

## 5. 事件语义（与 TPA 控制映射一致）

| 事件 | 清偿动作 |
| --- | --- |
| TAP / 按键短按 | 继续（翻页 → 追问 → 结算） |
| DOUBLE_TAP | 重看当前页 |
| TRIPLE_TAP | 下一张欠条 |
| PRESS_HOLD / 按键长按 | 结束并结算 |
| SWIPE_UP / SWIPE_DOWN | 反馈/结算翻页 |

## 6. 心跳机制

- **方向**：手机 → 眼镜，MSG_PING（0x10），空负载。
- **间隔**：SGC 每 5 秒发送一次 PING（连接空闲时也发），用于链路保活与探测。
- **响应**：眼镜收到 PING 后立即回 ACK（seq 同 PING 帧），不定义独立 PONG 帧。
- **超时判定**：连续 3 次 PING（即 15 秒）未收到对应 ACK，SGC 判定链路丢失，
  主动断开并触发 §1.2 重连流程。
- **眼镜侧心跳**：眼镜若 30 秒未收到任何下行帧（含 PING），可主动断开以省电；
  断开后由 SGC 重连。
- **降级行为**：
  - 心跳丢失期间，SGC 不再向眼镜下发新页（缓存到本地，重连后按 §1.2 恢复入口页）；
  - TPA/Web 端正常可用，用户可在手机/Web 端继续清偿流程；
  - SGC 上报 `connection_degraded` 给 TPA，Web 端显示「眼镜离线，请检查佩戴与电量」。
- **不传音频/数据**：PING 仅作保活与链路探测，不携带业务数据。
- **真机验证边界**：5s 间隔、15s 超时、30s 眼镜侧断开等参数未在真机验证，
  标记 `UNVERIFIED`；实际值需根据 BLE 功耗与链路稳定性验收调整。

## 7. 消息确认与重发

- **ACK 范围**：眼镜对每条下行消息（DISPLAY_CLEAR / DISPLAY_PAGE / DISPLAY_TOAST / PING）
  回送一条 ACK（0x84），负载 `[ackedSeq][status]`。
- **ACK 超时**：SGC 发送一条下行消息后启动 2 秒 ACK 超时计时器。
- **重发次数**：超时未收到 ACK，重发同一 seq 的同一消息，最多重发 2 次
  （合计发送 3 次）。第 3 次仍无 ACK 视为下发失败，SGC 上报 TPA `display_delivery_failed`。
- **重发约束**：重发必须重发**全部分片**（即使眼镜只缺末帧），因为接收方
  在「上一组未齐」时会作废整组并等下一个首帧（见 §2）。
- **重复去重**：眼镜按 seq 去重——已 ACK 过的 seq 再次到达，眼镜**仍回 ACK**
  但**不重复触发显示**（避免重发导致跳屏）。
- **NACK 处理**：status 非 0 表示 NACK，具体错误码见 §9。NACK 后 SGC **不**自动重发原消息，
  按 §9 错误码决定后续动作（如负载过长则分页重发，如协议错误则上报 TPA）。
- **上行事件无 ACK**：眼镜→手机的事件（BUTTON/TOUCH/BATTERY/HELLO）不要求 SGC 回 ACK，
  事件丢失由下一次 PING 触发的链路探测兜底。
- **真机验证边界**：2s ACK 超时、最多 2 次重发等参数未在真机验证，标记 `UNVERIFIED`。

## 8. 版本协商

- **协议版本**：帧头 `[0] VERSION`（当前 `0x01`）。每帧必带，接收方必须校验。
  - 眼镜收到的帧 `VERSION ≠ 0x01`：眼镜回 NACK `ERR_PROTOCOL_VERSION`（见 §9）并丢弃该帧。
  - SGC 收到的帧 `VERSION ≠ 0x01`：SGC 丢弃该帧并上报 TPA `protocol_mismatch`。
- **固件版本**：HELLO（0x85）负载 `[fwMajor][fwMinor][capabilities]`，
  其中 `fwMajor`/`fwMinor` 是**固件版本**（不是协议版本）。
  - SGC 在 HELLO 到达后记录固件版本，并上报 TPA（用于兼容性判断）。
  - 固件主版本与 SGC 期望主版本不符时（如 SGC 期望 `fwMajor=1`，实际 `fwMajor=2`），
    SGC **不断开连接**，但向 TPA 上报 `firmware_unsupported`，TPA 可在 Web 端提示
    「眼镜固件版本不兼容，请升级」；SGC 仍按 v1 协议尽力下发文本，不保证新功能可用。
- **HELLO 缺失**：连接建立后 3 秒内未收到 HELLO，SGC 视为协议握手失败，
  主动断开并重连（重连后仍等 HELLO）。
- **不降级协商**：v1 不支持「协商到更低版本」，版本不兼容即明确失败，
  不做能力位掩码协商。

## 9. 错误码表

ACK status 字段（0x84 第二字节）与 NACK 错误码统一定义如下。
`0x00` = 成功，非 0 = NACK。新增错误码必须在此表登记，不得复用既有码。
参考实现 `src/mindiouGlassProtocol.ts` 的 `decodeGlassesEvent` 对 ACK 仅判断
`ok: p[1] === 0`（0 成功 / 非 0 失败），下表是**非 0 值的细分约定**，与现有代码兼容。

| 码 | 名称 | 含义 | SGC 后续动作 |
| --- | --- | --- | --- |
| 0x00 | OK | 成功 | 正常流程 |
| 0x01 | ERR_PROTOCOL_VERSION | 帧头 VERSION 不被支持 | 丢弃该帧，上报 TPA `protocol_mismatch`，不重发 |
| 0x02 | ERR_CRC | 帧校验失败（眼镜侧） | 帧已被丢弃，SGC 超时后按 §7 重发 |
| 0x03 | ERR_PAYLOAD_TOO_LONG | 单帧负载 > 250 字节 | SGC 检查分片逻辑，按 §7 分页重发 |
| 0x04 | ERR_DISPLAY_PAGE_FORMAT | DISPLAY_PAGE 负载格式错（如 titleLen 越界） | SGC 记录日志，上报 TPA `display_format_error`，不重发 |
| 0x05 | ERR_TITLE_TOO_LONG | title UTF-8 > 18 字节 | SGC 截断或上报 TPA 重新生成短标题 |
| 0x06 | ERR_BODY_TOO_LONG | body UTF-8 > 92 字节 | SGC 按 §4.1 分页后重发 |
| 0x07 | ERR_BUFFER_FULL | 眼镜显示缓冲未就绪（如上一页未渲染完） | SGC 等待 500ms 后重发同一 seq |
| 0x08 | ERR_UNSUPPORTED_MSG | 眼镜不识别该 MSG_TYPE | SGC 上报 TPA `unsupported_message`，不再发该类型 |
| 0x09 | ERR_DEVICE_BUSY | 眼镜忙（如正在处理长按结算） | SGC 等待 500ms 后重发，最多重试 2 次 |
| 0x0A | ERR_INTERNAL | 眼镜内部异常 | SGC 上报 TPA `glass_internal_error`，提示用户重启眼镜 |
| 0xFF | ERR_UNKNOWN | 未分类错误 | SGC 上报 TPA `unknown_error`，记录固件版本与 seq |

未在表中登记的非 0 值统一按 `ERR_UNKNOWN` 处理。
错误码与 TPA 事件名的映射在 `sgc/README.md` 的 SGC 接口定义中体现。

## 10. 明确不做

- 不传输音频（麦克风走手机，同 G2）；不传图片/位图（v1 单色文本足够）。
- 不做应用层配对码/多用户身份绑定（见 §1.1）；复用 MentraOS 既有蓝牙配对。
- 不做 OTA；固件升级另行定义。
- 不做能力位协商降级（见 §8）；版本不兼容即失败。
- 不做摄像头、全彩 AR、复杂手势、空间定位等非清偿必要能力。
