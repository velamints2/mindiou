# SGC 集成说明（MindIOU 自有硬件 → MentraOS）

> 状态：参考实现与集成说明。**未编译、未真机验证**。本目录不含 MentraOS 源码，
> 只说明按官方 add-new-glasses 流程把 MindIOU 协议眼镜接进 MentraOS 的步骤与映射。

## 前提

- MentraOS mobile 仓库（`Mentra-Community/MentraOS`），其 SGC 层已有
  `G1.swift` / `G2.swift` 两个现成实现可作为蓝本。
- 自有硬件固件已实现 `../mindiou-ble-protocol.md`（广播名前缀 `MindIOU-`，
  GATT 服务与特征值见协议 §1）。

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

## 控制映射（与 TPA 约定一致，勿改）

| 眼镜事件 | MentraOS 事件 | 清偿动作 |
| --- | --- | --- |
| TAP | TouchEvent(TAP) | 继续 |
| DOUBLE_TAP | TouchEvent(DOUBLE_TAP) | 重看当前页 |
| TRIPLE_TAP | TouchEvent(TRIPLE_TAP) | 下一张 |
| PRESS_HOLD | TouchEvent(PRESS_HOLD) | 结束结算 |
| SWIPE_UP/DOWN | TouchEvent(SWIPE_UP/DOWN) | 翻页 |
| 按键短按/长按 | ButtonPress(short/long) | 继续 / 结束 |

## 验证清单（真机，全过才可宣称可用）

- [ ] 手机能发现并完成配对，收到 HELLO
- [ ] TPA 黄金路径各屏按序到达且整屏替换（问题 → 反馈分页 → 结算）
- [ ] 分片重组无乱码（长中文反馈页）
- [ ] 触控/按键事件 100% 触发对应动作，ACK/重发无重复跳屏
- [ ] 麦克风采集（手机侧）→ 转写 → 回答提交全链路延迟可接受
- [ ] 退出 App 后眼镜清屏，重连后恢复入口欠条

以上任一项未验证，对外只能说明「协议与编解码已单测，真机集成待验证」。
