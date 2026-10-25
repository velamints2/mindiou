# 第二台电脑接入 MindIOU 进度采集

## 前提
- 中心机（ZhouJideMacBook-Air）与第二台电脑在同一网络，或中心机有可达地址
- 中心机 MindIOU 栈已启动（api 8793 + mcp 8795）：`bash scripts/start-mindiou-local.sh start`

## 步骤

1. 复制本目录（progress-collector.mjs + 本说明）到第二台电脑任意路径，例如 `~/mindiou/`

2. 确认有 node（>=18）与 zstd（`brew install zstd`）

3. 手动跑一次验证（把 URL 换成中心机实际 IP）：

```bash
export MINDIOU_PROGRESS_URL="http://10.14.155.244:8793"
export MINDIOU_PROGRESS_TOKEN="80f1119e6acb3059d616b429140379a0b47a94873d426f4d29728d444f13bd8a"
node progress-collector.mjs --push
# 预期输出: push 200: {"ok":true,...}
```

4. 装 LaunchAgent 定时上报（30 分钟一次）：

```bash
mkdir -p ~/Library/LaunchAgents
NODE_BIN=$(which node)
cat > ~/Library/LaunchAgents/com.personalos.progress-collector.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.personalos.progress-collector</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$HOME/mindiou/progress-collector.mjs</string><string>--push</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MINDIOU_PROGRESS_URL</key><string>http://10.14.155.244:8793</string>
    <key>MINDIOU_PROGRESS_TOKEN</key><string>80f1119e6acb3059d616b429140379a0b47a94873d426f4d29728d444f13bd8a</string>
  </dict>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/progress-collector.log</string>
  <key>StandardErrorPath</key><string>/tmp/progress-collector.err</string>
</dict></plist>
EOF
launchctl load ~/Library/LaunchAgents/com.personalos.progress-collector.plist
```

5. 验证聚合：在中心机或眼镜上查看 `/api/progress`，`machines[]` 应出现第二台电脑的 hostname。

## 说明
- hook token 与中心机 personal_os 项目绑定，不要外传
- 跨公网时把 MINDIOU_PROGRESS_URL 换成中心机的 HTTPS 入口（demo 服务器恢复后可用）
- claude 采集适配器自动生效：只要第二台电脑装了 claude code 且有 ~/.claude/projects 就会被扫到

## 端口可达性现状（2026-10-13 实测）

| 端口 | 绑定 | LAN 直连 | 用途 |
|-----|------|---------|------|
| 8793 | `*:8793`（全网卡） | ✓ 可达（IP 访问 200 实测） | 进度采集 / REST API / hook events |
| 8795 | `127.0.0.1:8795` | ✗ 不可达 | MCP（Streamable HTTP，dsh/claude/codex 捕获） |

- 进度采集（本流程）走 8793，**不受影响**。
- 若第二台电脑要跑 **dsh MCP 捕获**：需要中心机把 MCP 服务改绑 `0.0.0.0`
  （remote-server 启动参数/host 配置）。MCP 已有 Bearer token 认证，但 LAN
  暴露面扩大，改绑前与中心机 owner 确认；跨公网请等 demo 服务器恢复走 HTTPS。
- 中心机 IP 以 `ipconfig getifaddr en0` 实时值为准（2026-10-13 为 10.14.155.244）。
