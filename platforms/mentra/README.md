# MindIOU Mentra TPA

MindIOU 认知欠条清偿的 MentraOS 云端 App（Third-Party App）。
佩戴者在眼镜上一次清偿一笔欠条：看问题 → 语音回答 → AI 反馈 → 追问/结算 → 参考答案 → 下一张。

## 架构

```text
眼镜(G2/自有硬件) ←BLE→ MentraOS 手机 App ←→ Mentra Cloud
                                              ↑ WebSocket/Webhook
                                        本包 (@mentra/sdk AppServer)
                                              ↑ HTTPS + Bearer
                            evenhub-g2-learning server.js (/api/mentra/*, /api/mvp1/*)
```

清偿的研究、分析、谨慎状态判断全部在共享后端；本包只做事件接线与显示适配。
核心状态机在 `src/clearanceFlow.ts`，为纯逻辑模块（不依赖 SDK），测试即黄金路径规格。

## 运行

```bash
npm install
cp .env.example .env   # 填写 MENTRA_PACKAGE_NAME / MENTRA_API_KEY / MINDIOU_API_BASE / LEARNING_API_TOKEN
npm run build
npm start              # 默认端口 7010，webhook 路径 /webhook 需公网可达
```

`MENTRA_PACKAGE_NAME` / `MENTRA_API_KEY` 在 https://console.mentra.glass 创建 App 获得；
webhook 回调地址需指向本服务的公网 URL。

## 交互映射

| 输入 | 动作 |
| --- | --- |
| 长句语音（>12 字） | 学习回答，提交后端分析 |
| 短语音「下一个/重复/结束/会了」 | 导航命令 |
| 触控 TAP / 按键短按 | 继续（翻页 → 追问 → 结算） |
| 触控 DOUBLE_TAP | 重看当前页 |
| 触控 TRIPLE_TAP | 跳到下一张欠条 |
| 触控 PRESS_HOLD / 按键长按 | 结束并结算 |
| 触控 SWIPE_UP / SWIPE_DOWN | 反馈/结算翻页 |

## 显示约定

- 单色 640×200、约 5 行文本屏，无原生滚动：长反馈显式分页，整屏替换。
- 问题用 referenceCard 大标题区展示（≤48 字截断）；反馈/教学分页（每页 ≤92 字）。
- 后端 scaffold 在用户首次回答前绝不进入显示文本；结算时作为参考答案展示。
- 每个识别到的控制都有即时显示反馈；网络等待前先有「已收到」确认。

## 门禁

```bash
npm run check   # tsc --noEmit
npm test        # vitest，38 例（含黄金路径端到端显示序列）
npm run build   # tsc 产出 dist/
```

## 验证边界

- 单测证明状态机、显示序列、错误态、重试与重入逻辑。
- 浏览器/模拟器不在本包范围内；G2 真机配对、麦克风、触控、延迟、
  伴随手机网络路由与退出行为必须在真机上验证后才能宣称可用。
