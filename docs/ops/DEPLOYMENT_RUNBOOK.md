# MindIOU 部署与恢复 Runbook

目标读者：不了解项目历史的接手人。所有路径均来自仓库 `deploy/` 与 `scripts/` 实际内容。
标注：【待确认】= 需要在服务器上人工确认的项目。

## 0. 部署形态总览

```text
公网客户端
  → Nginx（443，Let's Encrypt IP 证书，限流）
    → /mindiou/          静态前端（/var/www/mindiou）
    → /mindiou-api/      反代 127.0.0.1:8794（Node，systemd mindiou.service）
  → cloudflared quick tunnel（仅应急回退，mindiou-quick-tunnel.service）
Node 数据：/var/lib/mindiou/（JSON + SQLite），配置：/etc/mindiou.env
```

## 1. 本地启动

```bash
cd evenhub-g2-learning
npm ci
cp .env.example .env.local   # 按需填写；最少可全空走 fallback
npm run dev                  # 或 node server.js（PORT 默认 8793）
curl http://127.0.0.1:8793/healthz   # liveness
curl http://127.0.0.1:8793/readyz    # readiness（auth store + 配置自检）
```

启动期 env-validation 报错即修正对应变量；警告可继续（本地）。

## 2. 测试（质量门禁）

```bash
npm run check    # tsc --noEmit
npm test         # vitest 全量
npm run build    # vite 构建 dist/
npm run check:release
```

## 3. 首次部署（生产）

前置：Ubuntu 服务器、Nginx、Node ≥ 仓库 package.json engines 版本、certbot ≥5.4（装于 `/opt/certbot-ip-venv`）。

1. 建用户与目录：
   ```bash
   sudo useradd --system --home /opt/mindiou --shell /usr/sbin/nologin mindiou
   sudo mkdir -p /opt/mindiou/current /var/lib/mindiou /var/www/mindiou
   sudo chown -R mindiou:mindiou /var/lib/mindiou
   ```
2. 发布代码到 `/opt/mindiou/releases/<timestamp>/`，软链 `/opt/mindiou/current` 指向它【待确认：具体发布脚本不在本仓库】。
3. 写 `/etc/mindiou.env`（权限 600，属 root；**禁止复制进仓库**）。最少变量：
   `PORT=8794`、`HOST=127.0.0.1`、`NODE_ENV=production`、`MINDIOU_STRICT_ENV=1`、
   `AI_PROVIDER/AI_API_KEY/AI_BASE_URL/AI_MODEL`、`LEARNING_API_TOKEN`、
   `MINDIOU_SESSION_SECRET`、`MINDIOU_COOKIE_SECURE=1`、五个 `*_STORE_PATH=/var/lib/mindiou/...`。
4. 装 systemd 单元：
   ```bash
   sudo cp deploy/mindiou.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now mindiou
   ```
5. 装 Nginx 配置：`nginx-mindiou-ratelimit.conf` → `conf.d/`（或 http 块）；
   `nginx-mindiou-ip-https.conf` → `sites-available/` 并启用；
   `nginx-mindiou-locations.conf` → `/etc/nginx/snippets/mindiou-locations.conf`【待确认：include 路径以服务器实际为准】。
6. 申请 IP 证书并启用续期：
   ```bash
   sudo cp deploy/mindiou-ip-cert-renew.{service,timer} /etc/systemd/system/
   sudo systemctl enable --now mindiou-ip-cert-renew.timer
   ```
7. 同步前端：`npm run build && (cd web && npm run build)` 后在服务器上执行 `deploy/sync-web.sh`。
8. 日志上限：`sudo cp deploy/journald-mindiou-limits.conf /etc/systemd/journald.conf.d/ && sudo systemctl restart systemd-journald`。
9. 验证（见第 7 节）。

## 4. 更新服务（常规发布）

```bash
# 本地：质量门禁全过后推送分支，由有权限的人发布
git checkout <release-commit>
npm ci && npm run build && (cd web && npm ci && npm run build)
# 服务器：
# 1) 代码放入 /opt/mindiou/releases/<new-ts>，切换 current 软链
# 2) sudo systemctl restart mindiou
# 3) deploy/sync-web.sh（前端有变更时）
# 4) 验证（第 7 节），失败则回滚（第 6 节）
```

`scripts/deploy-web.sh` 可从本地经 SSH 推送前端构建产物（支持 `MINDIOU_SSH_HOST` 覆盖目标）。

## 5. 日志与健康检查

```bash
journalctl -u mindiou -f                 # 实时日志（单行 JSON，含 requestId）
journalctl -u mindiou --since "1h ago"   # 回溯
curl -s http://127.0.0.1:8794/healthz    # 本机 liveness
curl -s http://127.0.0.1:8794/readyz     # 本机 readiness
curl -s https://<server>/mindiou-api/healthz   # 经 Nginx 公网 liveness
curl -s https://<server>/mindiou-api/readyz    # 经 Nginx 公网 readiness
```

readiness 返回 `checks.authStore` 与 `checks.config.{ai,research,stt}` 布尔/错误摘要，用于定位依赖类型；**不含密钥与内部堆栈**。健康检查不调用任何模型。

## 6. 回滚

### 回滚代码

```bash
# 服务器：
ls /opt/mindiou/releases/                 # 找到上一个已知良好目录
sudo ln -sfn /opt/mindiou/releases/<prev-ts> /opt/mindiou/current
sudo systemctl restart mindiou
curl -s http://127.0.0.1:8794/readyz      # 确认 ready
# 前端：git checkout <prev-commit> 后重新 deploy/sync-web.sh（或保留的上一版产物回同步）
```

回滚目标与上一个已知良好产物必须在发布记录中预先登记（见 release 规则）。

### 回滚配置

`/etc/mindiou.env` 不在 Git 内。变更前先 `sudo cp /etc/mindiou.env /etc/mindiou.env.bak-<date>`；
回滚即还原备份 + `sudo systemctl restart mindiou`。

### 恢复服务

```bash
sudo systemctl status mindiou            # 看状态与最近日志
journalctl -u mindiou -n 100 --no-pager  # 启动错误（env-validation 会给出变量级原因）
sudo systemctl restart mindiou           # Restart=always，崩溃会自愈；反复崩溃查日志
```

### 恢复数据

- 数据文件：`/var/lib/mindiou/*.json` 与 `auth-store.sqlite`。
- 备份【待确认：仓库内无自动备份脚本】：建议发布前手动 `sudo cp -a /var/lib/mindiou /var/lib/mindiou.bak-<date>`。
- 恢复：停服务 → 还原文件（注意属主 mindiou:mindiou）→ 启服务 → `/readyz` 确认。
- SQLite 损坏：`auth-store.sqlite` 删除后用户需重新注册；JSON 损坏可从 `.bak` 还原或置空重建（报告数据丢失，需告知影响面）。

## 7. 验证公网 Demo

1. `curl -s https://<server>/mindiou-api/healthz` → `{"ok":true,...}`；
2. 浏览器打开 `https://<server>/mindiou/`，走完：导入对话 → 生成报告 → 打开欠条 → 提交答案 → 刷新确认状态恢复；
3. 演示模式：确认响应中 `curated_demo_fallback` 标记按预期出现/不出现；
4. 检查 `journalctl -u mindiou --since "-10m"` 无 error 级日志；
5. 设备通道（G2/Rokid）用各自 Bearer token 验证一个只读端点【待确认：需真实设备或模拟器】。

## 8. 应急公网入口（quick tunnel）

仅当 IP 证书失效且短期无法续期时：`sudo systemctl enable --now mindiou-quick-tunnel`，
从 `journalctl -u mindiou-quick-tunnel` 取临时 trycloudflare URL。
注意：该 URL 进程级临时，**禁止写入发布包或文档**；恢复证书后立即停用回退。
