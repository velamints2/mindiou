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
npm test        # vitest，47 例（含黄金路径端到端显示序列、异常恢复、协议健壮性）
npm run build   # tsc 产出 dist/
```

## 部署

### 本地开发

```bash
npm install
cp .env.example .env   # 填写下方四个必填项
npm run build
npm start              # 默认端口 7010
```

本地隧道（供 Mentra Cloud webhook 回调）：

```bash
# 方式一：cloudflared（推荐，无需账号）
cloudflared tunnel --url http://localhost:7010

# 方式二：ngrok
ngrok http 7010
```

将隧道公网 URL + `/webhook` 填入 Mentra Console 的 Webhook URL 字段。

### 生产部署（复用 MindIOU 服务器）

TPA 与 MindIOU 主后端共用同一台服务器，但监听不同端口（主后端 8794，TPA 7010）。

```bash
# 1. 克隆代码到服务器
cd /opt/mindiou/evenhub-g2-learning/platforms/mentra
npm ci --production=false && npm run build

# 2. 配置环境变量（写入 /etc/mindiou.env 或 systemd EnvironmentFile）
#    详见 .env.example，不得在代码或 git 中存储真实密钥

# 3. 启动（推荐 systemd 管理进程）
#    见下方 systemd unit 模板

# 4. Nginx 反代（已在 deploy/nginx-mindiou-locations.conf 中配置
#    /mindiou-api/api/mentra/clearance-entry，但 TPA webhook 需单独暴露）
```

systemd unit 模板：

```ini
[Unit]
Description=MindIOU Mentra TPA
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/mindiou/evenhub-g2-learning/platforms/mentra
EnvironmentFile=/etc/mindiou.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### 启动 / 停止 / 日志 / 回滚

```bash
sudo systemctl start mindiou-mentra      # 启动
sudo systemctl stop mindiou-mentra       # 停止
sudo journalctl -u mindiou-mentra -f     # 实时日志
sudo systemctl restart mindiou-mentra    # 重启
# 回滚：git checkout <上一个 commit> && npm ci && npm run build && sudo systemctl restart mindiou-mentra
```

### Mentra Console 注册字段清单

在 https://console.mentra.glass 创建 App 时填写：

| 字段 | 值 | 说明 |
| --- | --- | --- |
| Package Name | `com.mindiou.clearance` | 与 `MENTRA_PACKAGE_NAME` 一致 |
| Webhook URL | `https://<公网域名>/webhook` | 需公网 HTTPS 可达 |
| API Key | （Console 生成） | 填入服务端 `MENTRA_API_KEY` |
| Display Name | MindIOU 认知清偿 | 眼镜 Launcher 显示名 |
| Description | 认知欠条清偿：看问题→语音回答→AI反馈→结算 | |

### 日志安全

- 所有日志仅输出 error.message 和启动信息，**不包含用户语音原文、回答内容或 API 密钥**。
- unhandledRejection / uncaughtException 仅记录错误消息字符串，不 dump 堆栈中的请求体。
- 遵循 MindIOU 规则：不把 API Key 写入代码、日志或前端 bundle。

## 验证边界

- 单测证明状态机、显示序列、错误态、重试与重入逻辑（47 例 VERIFIED）。
- TPA 本地启动 + 健康检查 + webhook POST 返回 200 已在本地验证（VERIFIED）。
- G2 真机配对、麦克风、触控、延迟、伴随手机网络路由与退出行为必须在真机上验证后才能宣称可用（BLOCKED_EXTERNAL）。
