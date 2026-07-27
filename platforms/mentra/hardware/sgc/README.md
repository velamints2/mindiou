# SGC 集成说明（MindIOU 自有硬件 → MentraOS）

> 状态：参考实现与集成说明。**未编译、未真机验证**。本目录不含 MentraOS 源码，
> 只说明按官方 add-new-glasses 流程把 MindIOU 协议眼镜接进 MentraOS 的步骤与映射。

## 前提

- MentraOS mobile 仓库（`Mentra-Community/MentraOS`），其 SGC 层已有
  `G1.swift` / `G2.swift` 两个现成实现可作为蓝本。
- 自有硬件固件已实现 `../mindiou-ble-protocol.md`（广播名前缀 `MindIOU-`，
  GATT 服务与特征值见协议 §1）。

## 职责边界

清偿闭环涉及五个角色，各自职责与不可越界的事如下：

```text
┌─────────────┐     BLE      ┌──────────────┐   WebSocket   ┌───────────────┐
│ MindIOU 眼镜 │ <──────────> │  MentraOS    │ <───────────> │   MindIOU     │
│ (自有硬件)   │   v1 协议    │  手机 App    │  (SGC ↔ TPA)  │   TPA (云端)  │
└─────────────┘              │  + SGC 层    │               └───────┬───────┘
                             └──────┬───────┘                       │
                                    │ 手机麦克风                      │ HTTPS
                                    │ Soniox 转写                     ▼
                                    ▼                         ┌──────────────┐
                             ┌──────────────┐                 │  MindIOU 后端 │
                             │  Soniox ASR  │ ──文本─────────→│  (用户/会话)  │
                             └──────────────┘                 └──────────────┘
```

| 角色 | 职责 | 不可越界 |
| --- | --- | --- |
| MindIOU 眼镜 | 单色文本显示、按键/触控事件上行、电量上报、HELLO 握手 | 不做音频采集（v1）、不做业务逻辑、不存用户身份 |
| MentraOS 手机 App + SGC | BLE 扫描/连接/编解码、文本分页下发、事件转译为 MentraOS TouchEvent/ButtonPress、麦克风采集与 Soniox 转写触发、与 TPA WebSocket 通信 | 不直接连 MindIOU 后端、不存认知欠条业务数据 |
| MentraOS Soniox | 语音转文字 | 不做语义理解、不直接发回答给 TPA |
| MindIOU TPA | 清偿流程编排（卡片下发、回答接收、AI 反馈、结算）、与 SGC 通过 MentraOS WebSocket 通信、与 MindIOU 后端同步 | 不直接连眼镜 BLE、不感知眼镜硬件型号 |
| MindIOU 后端 | 用户账户、报告、欠条、会话状态持久化 | 不直接 BLE 通信、不替 TPA 做清偿编排 |

**关键约束**：
- SGC 是「BLE 适配层 + MentraOS 事件桥」，不做清偿业务决策；
- TPA 是「清偿编排者」，不感知具体眼镜型号，只通过 MentraOS 标准事件接口交互；
- 用户身份只在 MindIOU 后端与 TPA 之间流通，眼镜与 SGC 不持有用户身份。

## 麦克风音频处理路径

v1 协议明确「不传输音频」（见 `../mindiou-ble-protocol.md` §6/§10），因此 v1 唯一可用路径是 **手机麦克风采集**。任务描述提及的「眼镜端采集 → BLE → 手机端」路径在 v1 不可用，需 v2 扩展 BLE 音频特征值；下方两条路径均列出以明确边界。

### 路径 A（v1 可用，UNVERIFIED 待真机验证）

```text
用户开口
  → 手机麦克风采集（MentraOS App，AVAudioEngine）
  → MentraOS Soniox ASR 转写（手机端 SDK）
  → 文本经 SGC → TPA（WebSocket）
  → TPA 提交回答到 MindIOU 后端
  → AI 反馈回流 TPA → SGC → 眼镜显示
```

- 采集与转写在手机端完成，BLE 只走文本下行；
- 与 G2 眼镜同路径，复用 MentraOS 既有 Soniox 集成；
- 真机验证边界：手机麦克风在佩戴眼镜时的实际拾音质量、Soniox 在嘈杂环境下的转写准确率 `UNVERIFIED`。

### 路径 B（v1 不可用，未来 v2 候选，UNVERIFIED）

```text
用户开口
  → 眼镜端麦克风采集
  → 音频流通过 BLE 传输（需新增 Audio Service UUID + 音频特征值）
  → 手机端接收
  → MentraOS Soniox ASR 转写
  → 文本经 SGC → TPA → MindIOU 后端
```

- v1 BLE 协议**不**含音频特征值，眼镜端麦克风音频无法通过本协议传输；
- 启用此路径需扩展 `../mindiou-ble-protocol.md` 定义 Audio Service（如 A2DP-over-BLE 或自定义 GATT 音频流），并重做 MTU/分片/带宽评估；
- 全程 `UNVERIFIED`：眼镜端麦克风硬件、BLE 音频带宽、延迟均未验证。

### 路径选择约定

- v1 仅实现路径 A；
- 若自有硬件确实有麦克风且需要走路径 B，应作为独立任务，先扩展 BLE 协议 v2，再调整 SGC；
- 两条路径的转写后处理（提交回答、反馈显示）完全相同，差异只在采集与传输段。

## 集成步骤

1. **新建设备类**（iOS 例）：复制 `G2.swift` 为 `MindiouGlasses.swift`，
   因为 MindIOU 眼镜与 G2 同为「单色文本屏 + 触控条 + 无摄像头」，
   差异只在 BLE 服务/特征值与包格式。
2. **设备发现**：按广播名前缀 `MindIOU-` 扫描并连接；订阅 RX 特征值通知。
3. **协议接入**：
   - 下行：把 SGC 的文本显示调用（text wall / reference card）编码为
     DISPLAY_PAGE（`title` = 卡片标题，`body` = 分页后的正文），
     分片逻辑与 `../src/mindiouGlassProtocol.ts` 的 `encodeMessage` 一致。
   - 上行：按 `FrameDecoder` 逻辑重组帧，用 `decodeGlassesEvent`
     的等价实现把事件转为 MentraOS 的 TouchEvent / ButtonPress / 电量状态。
4. **能力声明**：capabilities 按硬件如实上报（无摄像头、无眼镜麦克风 →
   语音采集走手机麦克风，同 G2）。
5. **注册设备型号**：在 MentraOS 设备列表注册 `MindIOU Clip`，关联该 SGC 类。

## SGC Swift 目录结构

下方为不依赖 MentraOS 专有 SDK 即可编译的通用部分骨架；与 MentraOS 事件总线、设备注册表对接的部分以 `// MARK: - MentraOS SDK required` 标注，需在 MentraOS 仓库内编译。

```text
sgc/
├── README.md                          # 本文件
├── MindiouGlasses/
│   ├── MindiouGlasses.swift           # 设备主类（继承 MentraOS GlassesBase，需 SDK）
│   ├── MindiouBleDriver.swift         # BLE 扫描/连接/特征值读写（纯 CoreBluetooth，可独立编译）
│   ├── MindiouFrameCodec.swift        # 帧编解码（CRC8/分片/重组，对应 src/mindiouGlassProtocol.ts）
│   ├── MindiouMessageTypes.swift      # MSG_*/Gesture/PressType 常量与错误码枚举
│   ├── MindiouDisplayPager.swift      # body 文本按 92 字节硬折行分页（纯逻辑，可独立编译）
│   ├── MindiouControlMapping.swift    # 眼镜事件 → MentraOS TouchEvent/ButtonPress 映射
│   ├── MindiouConnectionStateMachine.swift  # 重连指数退避/HELLO 等待/心跳（纯逻辑，可独立编译）
│   └── MindiouErrorCodes.swift        # 协议 §9 错误码表对应的 Swift enum
└── MindiouGlassesTests/
    ├── MindiouFrameCodecTests.swift   # 与 test/mindiouGlassProtocol.test.ts 对齐的等价用例
    ├── MindiouDisplayPagerTests.swift
    └── MindiouConnectionStateMachineTests.swift
```

可独立编译部分（不依赖 MentraOS SDK）的骨架代码如下，仅作起点，非完整实现：

```swift
// MindiouMessageTypes.swift
import Foundation

public enum MindiouMsgType: UInt8 {
    case displayClear = 0x01
    case displayPage  = 0x02
    case displayToast = 0x03
    case ping         = 0x10
    case eventButton  = 0x81
    case eventTouch   = 0x82
    case eventBattery = 0x83
    case ack          = 0x84
    case hello        = 0x85
}

public enum MindiouGesture: UInt8 {
    case tap = 1, doubleTap = 2, tripleTap = 3, pressHold = 4
    case swipeUp = 5, swipeDown = 6
}

public enum MindiouPressType: UInt8 { case short = 0, long = 1 }

public enum MindiouAckStatus: UInt8 {
    case ok                   = 0x00
    case errProtocolVersion   = 0x01
    case errCRC               = 0x02
    case errPayloadTooLong    = 0x03
    case errDisplayPageFormat = 0x04
    case errTitleTooLong      = 0x05
    case errBodyTooLong       = 0x06
    case errBufferFull        = 0x07
    case errUnsupportedMsg    = 0x08
    case errDeviceBusy        = 0x09
    case errInternal          = 0x0A
    case errUnknown           = 0xFF
}

public enum MindiouBleIds {
    public static let service = "6d696e64-696f-7500-8000-00805f9b34fb"
    public static let tx      = "6d696e64-696f-7500-8001-00805f9b34fb"  // 手机 → 眼镜
    public static let rx      = "6d696e64-696f-7500-8002-00805f9b34fb"  // 眼镜 → 手机
}
```

```swift
// MindiouFrameCodec.swift
import Foundation

public let PROTOCOL_VERSION: UInt8 = 0x01
public let CHUNK_PAYLOAD_MAX = 176
public let FLAG_MORE: UInt8 = 0x01
public let FLAG_CONTINUATION: UInt8 = 0x02

public struct MindiouFrame {
    public let type: UInt8
    public let seq: UInt8
    public let payload: Data
}

public enum MindiouCodecError: Error {
    case frameTooShort
    case unsupportedVersion(UInt8)
    case lengthMismatch
    case crcFailed
    case continuationWithoutHead
    case continuationMismatch
    case payloadTooLong
}

public func mindiouCrc8(_ data: Data) -> UInt8 {
    var crc: UInt8 = 0
    for byte in data {
        crc ^= byte
        for _ in 0..<8 {
            crc = (crc & 0x80) != 0 ? ((crc << 1) ^ 0x07) : (crc << 1)
        }
    }
    return crc
}

/// 编码一条消息为若干 BLE 写包。语义与 src/mindiouGlassProtocol.ts 的 encodeMessage 一致。
public func mindiouEncodeMessage(type: UInt8, seq: UInt8, payload: Data) -> [Data] {
    func single(type: UInt8, seq: UInt8, flags: UInt8, payload: Data) -> Data {
        var frame = Data(capacity: 5 + payload.count + 1)
        frame.append(PROTOCOL_VERSION)
        frame.append(type)
        frame.append(seq)
        frame.append(flags)
        frame.append(UInt8(payload.count))
        frame.append(payload)
        frame.append(mindiouCrc8(frame))
        return frame
    }
    if payload.count <= CHUNK_PAYLOAD_MAX {
        return [single(type: type, seq: seq, flags: 0, payload: payload)]
    }
    var chunks: [Data] = []
    var offset = 0
    var first = true
    while offset < payload.count {
        let end = min(offset + CHUNK_PAYLOAD_MAX, payload.count)
        let slice = payload.subdata(in: offset..<end)
        offset = end
        let more: UInt8 = offset < payload.count ? FLAG_MORE : 0
        let cont: UInt8 = first ? 0 : FLAG_CONTINUATION
        chunks.append(single(type: type, seq: seq, flags: more | cont, payload: slice))
        first = false
    }
    return chunks
}

/// 流式重组器。语义与 src/mindiouGlassProtocol.ts 的 FrameDecoder 一致。
public final class MindiouFrameDecoder {
    private struct Buffer { let type: UInt8; let seq: UInt8; var parts: [Data] }
    private var buffer: Buffer?

    public init() {}

    public func push(_ bytes: Data) throws -> [MindiouFrame] {
        guard bytes.count >= 6 else { throw MindiouCodecError.frameTooShort }
        let version = bytes[0]
        guard version == PROTOCOL_VERSION else { throw MindiouCodecError.unsupportedVersion(version) }
        let type = bytes[1]
        let seq = bytes[2]
        let flags = bytes[3]
        let length = Int(bytes[4])
        guard bytes.count == 6 + length else { throw MindiouCodecError.lengthMismatch }
        let expectCrc = bytes[bytes.count - 1]
        let actualCrc = mindiouCrc8(bytes.prefix(bytes.count - 1))
        guard expectCrc == actualCrc else { throw MindiouCodecError.crcFailed }
        let payload = bytes.subdata(in: 5..<(5 + length))
        let more = (flags & FLAG_MORE) != 0
        let continuation = (flags & FLAG_CONTINUATION) != 0
        if !continuation {
            if buffer != nil {
                buffer = nil
                throw MindiouCodecError.continuationWithoutHead
            }
            if !more { return [MindiouFrame(type: type, seq: seq, payload: payload)] }
            buffer = Buffer(type: type, seq: seq, parts: [payload])
            return []
        }
        guard let b = buffer, b.seq == seq, b.type == type else {
            buffer = nil
            throw MindiouCodecError.continuationMismatch
        }
        buffer!.parts.append(payload)
        if more { return [] }
        let merged = buffer!.parts.reduce(into: Data()) { $0.append($1) }
        let frame = MindiouFrame(type: b.type, seq: b.seq, payload: merged)
        buffer = nil
        return [frame]
    }
}
```

```swift
// MindiouDisplayPager.swift
import Foundation

/// 把 body 按 maxBytesPerPage 字节硬折行分页，返回多页正文。
/// 与协议 §4.1 一致：默认 maxBytesPerPage = 92。
public func mindiouSplitBody(_ body: String, maxBytesPerPage: Int = 92) -> [String] {
    let bytes = Array(body.utf8)
    guard bytes.count > maxBytesPerPage else { return [body] }
    var pages: [String] = []
    var idx = 0
    while idx < bytes.count {
        var cutEnd = min(idx + maxBytesPerPage, bytes.count)
        // 避免在 UTF-8 多字节字符中间切断：向前回退到字符边界
        while cutEnd > idx && cutEnd < bytes.count && (bytes[cutEnd] & 0xC0) == 0x80 {
            cutEnd -= 1
        }
        let slice = Data(bytes[idx..<cutEnd])
        pages.append(String(data: slice, encoding: .utf8) ?? "")
        idx = cutEnd
    }
    return pages
}
```

> 上述骨架代码仅作集成起点，**未在 Xcode 项目中编译**，标记 `UNVERIFIED`；
> 行为规格以 `../src/mindiouGlassProtocol.ts` 与 `../test/mindiouGlassProtocol.test.ts` 为准。

## SGC 接口定义（Swift protocol）

下方接口把「可独立编译的数据/逻辑层」与「需 MentraOS SDK 的集成层」显式分离。
标注 `// MARK: - MentraOS SDK required` 的方法需在 MentraOS 仓库内对接事件总线与设备注册表。

```swift
// MindiouGlasses.swift（接口定义部分）
import Foundation

/// 眼镜上行事件统一类型（纯逻辑，可独立编译）。
public enum MindiouGlassesEvent {
    case button(id: UInt8, press: MindiouPressType)
    case touch(MindiouGesture)
    case battery(level: UInt8, charging: Bool)
    case ack(seq: UInt8, status: MindiouAckStatus)
    case hello(firmwareMajor: UInt8, firmwareMinor: UInt8, capabilities: UInt8)
}

public enum MindiouConnectionState {
    case disconnected
    case scanning
    case connecting
    case awaitingHello    // 连接已建立，等 HELLO（协议 §8：3s 内未到即失败）
    case ready
    case reconnecting(attempt: Int)
    case degraded         // 连续失败 5 次（协议 §1.2）
}

/// SGC 对外暴露给 MentraOS 的事件回调。
public protocol MindiouGlassesDelegate: AnyObject {
    /// 眼镜上行事件解码后回调（纯逻辑，可独立编译）
    func mindiouGlasses(_ glasses: MindiouGlassesProtocol, didReceive event: MindiouGlassesEvent)

    /// 连接状态变化（纯逻辑，可独立编译）
    func mindiouGlasses(_ glasses: MindiouGlassesProtocol, didChangeConnection state: MindiouConnectionState)

    // MARK: - MentraOS SDK required
    // 以下方法需把事件转译为 MentraOS 标准事件并发布到事件总线，签名待对齐 MentraOS GlassesBase
    // func publishTouchEvent(_ event: MentraOS.TouchEvent)   // MentraOS SDK required
    // func publishButtonPress(_ event: MentraOS.ButtonPress) // MentraOS SDK required
    // func reportBattery(level: Int, charging: Bool)          // MentraOS SDK required
}

/// SGC 设备主类接口。
public protocol MindiouGlassesProtocol {
    var delegate: MindiouGlassesDelegate? { get set }
    var connectionState: MindiouConnectionState { get }
    var firmwareVersion: (major: UInt8, minor: UInt8)? { get }
    var capabilities: UInt8? { get }

    /// 启动扫描与连接（纯 CoreBluetooth，可独立编译）
    func start()

    /// 主动断开（纯 CoreBluetooth，可独立编译）
    func disconnect()

    /// 下发整屏文本页（自动分页，纯逻辑 + BLE 写）
    /// - Returns: 分页后的 seq 列表，用于追踪 ACK（协议 §7）
    func displayPage(title: String, body: String) -> [UInt8]

    /// 清屏（纯逻辑 + BLE 写）
    func displayClear()

    /// 短确认条（纯逻辑 + BLE 写）
    func displayToast(_ text: String)

    /// 发送 PING（协议 §6 心跳，纯逻辑 + BLE 写）
    func ping()

    // MARK: - MentraOS SDK required
    // 以下方法需对接 MentraOS 设备注册表与生命周期
    // func registerAsMentraOSDevice()   // MentraOS SDK required
    // func bindToMentraOSEventBus()     // MentraOS SDK required
}
```

**接口分层约定**：
- `MindiouGlassesEvent` / `MindiouConnectionState` / `MindiouAckStatus` 等数据类型与编解码逻辑可在独立 Swift 包中编译与单测；
- 与 MentraOS 事件总线、设备注册表对接的方法以 `// MARK: - MentraOS SDK required` 标注，**未在 MentraOS 仓库外编译**，标记 `UNVERIFIED`；
- 控制映射（眼镜事件 → MentraOS 事件）见下方「控制映射」一节，勿在 SGC 内随意改动；
- 错误码与 TPA 事件名的对应见 `../mindiou-ble-protocol.md` §9。

## 控制映射（与 TPA 约定一致，勿改）

| 眼镜事件 | MentraOS 事件 | 清偿动作 |
| --- | --- | --- |
| TAP | TouchEvent(TAP) | 继续 |
| DOUBLE_TAP | TouchEvent(DOUBLE_TAP) | 重看当前页 |
| TRIPLE_TAP | TouchEvent(TRIPLE_TAP) | 下一张 |
| PRESS_HOLD | TouchEvent(PRESS_HOLD) | 结束结算 |
| SWIPE_UP/DOWN | TouchEvent(SWIPE_UP/DOWN) | 翻页 |
| 按键短按/长按 | ButtonPress(short/long) | 继续 / 结束 |

## 第一版自有硬件最小能力清单

v1 自有硬件必须满足以下 6 项能力，方可宣称「接入 MindIOU 清偿闭环可用」。
任一项未达成，整体不可用，不得以「其他能力可用」为由部分宣称。

| # | 能力 | 验收信号 | 真机验证状态 |
| --- | --- | --- | --- |
| 1 | 文本显示 | 收到 DISPLAY_PAGE 后整屏渲染 title（大字号）+ body（小字号），无乱码、无截断；长 body 自动分页 | UNVERIFIED |
| 2 | 语音输入 | 手机麦克风采集 → MentraOS Soniox 转写 → 文本提交 TPA；眼镜端麦克风 v1 不要求（路径 A） | UNVERIFIED |
| 3 | 基础导航 | TAP / DOUBLE_TAP / TRIPLE_TAP / PRESS_HOLD / SWIPE_UP / SWIPE_DOWN 100% 触发对应清偿动作 | UNVERIFIED |
| 4 | BLE 连接 | 广播名前缀 `MindIOU-`、GATT Service UUID 正确、HELLO 在连接后 3s 内到达、PING/ACK 心跳稳定、断开后按 §1.2 重连 | UNVERIFIED |
| 5 | 电量状态 | EVENT_BATTERY 上报 level 0-100 与 charging 0/1；SGC 转发 MentraOS | UNVERIFIED |
| 6 | SGC 通信 | SGC 能完成帧编解码（与 `../test/mindiouGlassProtocol.test.ts` 等价用例通过）、分页下发、ACK 重发与去重 | 编解码已单测；真机集成 UNVERIFIED |

**最小能力之外**：摄像头、全彩 AR、复杂手势、空间定位、眼镜端麦克风、OTA 等均**不**在 v1 必备清单内，不得因实现这些而延误清单内能力。

## 验证清单（真机，全过才可宣称可用）

- [ ] 手机能发现并完成配对，收到 HELLO
- [ ] TPA 黄金路径各屏按序到达且整屏替换（问题 → 反馈分页 → 结算）
- [ ] 分片重组无乱码（长中文反馈页）
- [ ] 触控/按键事件 100% 触发对应动作，ACK/重发无重复跳屏
- [ ] 麦克风采集（手机侧）→ 转写 → 回答提交全链路延迟可接受
- [ ] 退出 App 后眼镜清屏，重连后恢复入口欠条

以上任一项未验证，对外只能说明「协议与编解码已单测，真机集成待验证」。
