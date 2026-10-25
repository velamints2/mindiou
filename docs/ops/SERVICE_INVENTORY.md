# MindIOU 后端资产清单（Service Inventory）

> **服务器状态：** `114.67.169.78` 已弃用。本文中的该地址仅保留作历史资产记录；当前公网入口为 `https://demo.mindiou.top`。

生成日期：2026-07-30
生成方式：逐项仓库核验（git grep / 文件审读 / 本地命令），不依赖历史叙述。
事实标记：已验证 / 推断 / 待确认 / 无法确认。

适用代码基线：

- 父仓库 personal_os 分支 `refactor/backend-ops-boundaries`（基线标签 `overnight-baseline-2026-07-30` 之后）。
- 子模块 evenhub-g2-learning 基线 `d3321e2`（main，"fix(nginx): 添加缺失的 API 路由反代"）。

---

## 1. 服务清单

| 服务 | 入口 | 启动命令 | 监听 | 已验证依据 |
|---|---|---|---|---|
| 主 API（MindIOU learning API） | `server.js`（Node 原生 `http.createServer`，无框架） | `npm run api`（`node --use-env-proxy --env-file-if-exists=.env.local server.js`）；生产 `node server.js`（systemd） | `HOST:PORT`，默认 `0.0.0.0:8793` | `server.js:54-55,2370`；`package.json:10` |
| Mentra TPA（眼镜桥接） | `platforms/mentra/src/index.ts` → 构建后 `dist/index.js` | `node dist/index.js` | 默认 `7010`（`.env.example`） | `platforms/mentra/.env.example`、`mindiou-mentra.service` |
| 前端静态（SPA + MVP-1 + training） | `web/`（Vite SPA）与根 `dist/`（mvp1.html/training.html/report.html） | 构建：`npm run build` + `cd web && npm run build`；由 Nginx 直接服务 | 不监听端口 | `scripts/deploy-web.sh`、`deploy/sync-web.sh` |

推断（待用户确认）：

- 生产主 API 实际监听 `127.0.0.1:8794`。依据：所有 Nginx 反代目标为 `127.0.0.1:8794`（`deploy/nginx-mindiou-locations.conf` 全文），`platforms/mentra/.env.example` 注释"本地开发：`http://127.0.0.1:8794`"。推断生产在 `/etc/mindiou.env` 中设置 `PORT=8794`，但 `/etc/mindiou.env` 不在仓库内，**无法确认**。
- Mentra TPA 的生产部署状态 **待确认**：仓库内有 `mindiou-mentra.service`，但 Nginx 配置中没有 7010 端口的反代，公网入口未见 webhook 路由。

## 2. 构建与质量命令（evenhub-g2-learning，已验证 `package.json`）

| 用途 | 命令 |
|---|---|
| 类型检查 | `npm run check`（`tsc --noEmit`） |
| 单元/API 测试 | `npm test`（`vitest run`，基线 476 通过） |
| 构建 | `npm run build`（`tsc && vite build`，产出根 `dist/`） |
| Web SPA 检查/测试/构建 | `cd web && npm run check && npm test && npm run build` |
| 发布检查 | `npm run check:release`（版本一致性 + dist 存在性） |
| 领域冒烟 | `test:mvp1` / `test:voice` / `test:spiral` / `test:rokid` / `test:simulator` |
| Mentra TPA | `cd platforms/mentra && npm run check && npm test && npm run build` |

## 3. 反向代理与公网入口

> **实际生产域名（已验证 2026-07-30）**：`http://demo.mindiou.top/mindiou/`（解析 `156.225.23.88`，Nginx 1.18.0）。
> 仓库 `deploy/` 配置以 `114.67.169.78`（Nginx 1.24.0）为示例——两者是不同服务器，
> `deploy/` 配置需按实际生产服务器调整后使用【待确认：demo.mindiou.top 服务器的 Nginx/systemd 实际配置】。

### 仓库 deploy/ 中的配置（以 114.67.169.78 为示例）

- TLS 站点：`deploy/nginx-mindiou-ip-https.conf`，`server_name 114.67.169.78`，Let's Encrypt IP 短证书（约 6 天），TLS1.2/1.3。
- 路径映射（`deploy/nginx-mindiou-locations.conf`）：
  - `/mindiou/` → 静态目录 `/var/www/mindiou`（SPA `index.html` 为主入口；`/mindiou/mvp1/` → `mvp1.html`）。
  - `/mindiou-api/<path>` → `http://127.0.0.1:8794/<path>`，按路由逐条 `proxy_pass`；未列出的路径由末尾 `location /mindiou-api/ { return 404; }` 拒绝。
  - 公网屏蔽：`/mindiou-api/api/mvp0/reports`（列表防枚举）、`/mindiou-api/api/rokid/clearance-entry`、`/mindiou-api/health?live=1` 均返回 404。
- 限流（`deploy/nginx-mindiou-ratelimit.conf`）：`mindiou_general` 30 次/分/IP；`mindiou_ai` 6 次/分/IP（所有触发模型调用的路由用 ai 档）。
- 请求体上限：Nginx 站点级 `client_max_body_size 100M`，逐 location 覆盖（登录 8k、AI 路由 512k/64k）；Node `readBody` 硬上限 8MB（`server.js:297`）。两层不一致：Nginx 允许的大于 8MB 的 body 会在 Node 层失败（记录为债务，见 BACKEND_DEBT_BACKLOG）。
- 已知死配置（已验证）：Nginx 反代了 `/api/admin/stats`、`/api/admin/events`，但 `admin-backend-patch.js` **未在 server.js 中挂载**（无 import），这两个端点当前返回 404。

## 4. systemd 单元（已验证 deploy/）

| 单元 | 作用 | 关键配置 |
|---|---|---|
| `mindiou.service` | 主 API | `User=mindiou`，`WorkingDirectory=/opt/mindiou/current`，`EnvironmentFile=/etc/mindiou.env`，`ExecStart=/usr/bin/node server.js`，`Restart=always`，`MemoryMax=512M`，`ReadWritePaths=/var/lib/mindiou`，`NoNewPrivileges/PrivateTmp/ProtectSystem=strict/ProtectHome` |
| `mindiou-quick-tunnel.service` | 应急公网入口（Cloudflare Quick Tunnel） | `cloudflared tunnel --url http://127.0.0.1:80 --http-host-header 114.67.169.78`；README 明确"仅应急 fallback，进程级主机名不得写入发布包" |
| `mindiou-ip-cert-renew.service` + `.timer` | IP 证书续期 | `/opt/certbot-ip-venv/bin/certbot renew --cert-name 114.67.169.78`，每日两检，deploy-hook 校验并 reload Nginx |
| `mindiou-mentra.service` | Mentra TPA（部署状态待确认） | `WorkingDirectory=.../platforms/mentra`，`ExecStart=/usr/bin/node dist/index.js`，`EnvironmentFile=/etc/mindiou.env` |
| `journald-mindiou-limits.conf` | 日志磁盘限额 | `SystemMaxUse=500M`，保留 14 天 |

## 5. 数据存储（已验证代码）

| 数据 | 介质 | 默认路径 | 生产路径 | 依据 |
|---|---|---|---|---|
| 认证（users/sessions/device_tokens） | SQLite（better-sqlite3，WAL） | `tmp/auth-store.sqlite` | 推断 `/var/lib/mindiou/auth-store.sqlite` | `server.js:92`、`auth-store.js` |
| Spiral 事件/卡片/复习 | JSON 文件 | `tmp/spiral-store.json` | `/var/lib/mindiou/spiral-store.json` | `server.js:89`、`deploy/README.md` |
| MVP-0 报告/草稿 | JSON 文件 | `tmp/mvp0-store.json` | `/var/lib/mindiou/mvp0-store.json` | `server.js:90`、`deploy/README.md` |
| MVP-1 清偿会话 | JSON 文件 | `tmp/mvp1-store.json` | 推断 `/var/lib/mindiou/` | `server.js:91` |
| 训练系统（欠条/尝试/掌握度/复训任务） | JSON 文件 | `tmp/training-store.json` | 推断 `/var/lib/mindiou/` | `server.js:100` |
| 业务事件埋点 | 进程内存环形数组（200 条） | — | —（重启丢失） | `server.js:93,1397-1405` |
| 早期访问会话吊销表 | 进程内存 Map | — | —（重启后吊销失效，文档已自述） | `server.js:226-236`、`docs/engineering/early-access-auth.md` |
| MVP-0 浏览器报告指针 | 浏览器 sessionStorage | — | — | `docs/engineering/early-access-auth.md:81-83` |

备份：**已验证仓库内不存在任何备份脚本/定时任务**。数据恢复依赖服务器层快照（如有，无法确认）。见 INCIDENT_RUNBOOK 的应急建议和 BACKEND_DEBT_BACKLOG。

## 6. 环境变量（已验证 server.js + .env.example + mentra/.env.example）

完整说明见 `docs/ops/CONFIGURATION_REFERENCE.md`。汇总：

- 服务：`PORT`（默认 8793）、`HOST`（默认 0.0.0.0）、`NODE_ENV`。
- 文本模型：`AI_PROVIDER`、`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`；超时 `OPENAI_CHAT_TIMEOUT_MS`（默认 30000）。
- 检索模型：`RESEARCH_PROVIDER`、`RESEARCH_API_KEY`、`RESEARCH_BASE_URL`、`RESEARCH_MODEL`；超时 `OPENAI_RESEARCH_TIMEOUT_MS`（默认 45000）。
- 语音：`STT_API_KEY`、`STT_BASE_URL`、`STT_MODEL`、`OPENAI_STT_PROMPT`（**无超时配置**，本任务新增 `STT_TIMEOUT_MS`）。
- 旧别名（仍生效）：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`、`OPENAI_RESEARCH_MODEL`、`OPENAI_STT_MODEL`。
- 访问控制：`LEARNING_API_TOKEN`、`MINDIOU_EARLY_ACCESS_CODES`、`MINDIOU_SESSION_SECRET`、`MINDIOU_SESSION_TTL_SECONDS`（钳制 300s–30d）、`MINDIOU_COOKIE_SECURE`、`MINDIOU_ADMIN_TOKEN`（仅被未挂载的 admin patch 引用）。
- 行为开关：`SPIRAL_DISABLE_AI`、`MVP1_DEMO_FALLBACK`。
- 存储路径：`LEARNING_STORE_PATH`、`MVP0_STORE_PATH`、`MVP1_STORE_PATH`、`TRAINING_STORE_PATH`、`AUTH_STORE_PATH`。
- .env.example 中存在但 server.js 未读取（已验证）：`SPIRAL_API_URL`、`SPIRAL_PROJECT_ALLOWLIST`（后者被 `agents/codex-collector` 使用，待确认）。
- Mentra TPA 独立变量：`MENTRA_PACKAGE_NAME`、`MENTRA_API_KEY`、`MINDIOU_API_BASE`、`LEARNING_API_TOKEN`、`PORT`。

## 7. 外部模型服务（已验证代码）

| 用途 | 端点 | 超时 | 重试 | 并发控制 |
|---|---|---|---|---|
| 文本生成（chat） | `{AI_BASE_URL}/chat/completions` | 30s（AbortController） | 无 | 无 |
| 联网检索（research） | `{RESEARCH_BASE_URL}/responses`（web_search 工具） | 45s | 无 | 无 |
| 语音转写（STT） | `{STT_BASE_URL}/audio/transcriptions` | **无（本任务修复前）** | 无 | 无 |
| AI 探活（`/health?live=1`） | `{AI_BASE_URL}/models` | 8s | 无 | — |

生产实际供应商：文本 `302ai`（`AI_BASE_URL=https://api.302.ai/v1`、`AI_MODEL=gpt-5.6-sol`，deploy/README 已验证）；RESEARCH 使用公开网页适配器，STT 使用百度，公网演示启用 `MVP1_DEMO_FALLBACK=1`。

## 8. 健康检查（本任务实施前，已验证）

- 仅 `GET /health`：返回 `{ok, ai, provider, model, stt, sttModel}`；`?live=1` 追加 `providerStatus`（真实出站调用 `/models`，公网已被 Nginx 屏蔽）。
- 无 liveness/readiness 区分；无依赖分项状态。
- 外部监控：父仓库 `.github/workflows/production-health.yml` 每 6 小时探测 `MINDIOU_PUBLIC_URL`（GitHub secret），并检查页面不含 localhost/LAN 地址。
- 本任务新增 `/healthz`、`/readyz`（见 BACKEND_ARCHITECTURE 与代码），旧 `/health` 行为不变。

## 9. 定时任务（已验证）

- 服务器侧：`mindiou-ip-cert-renew.timer`（证书续期，每日两次）。
- CI 侧：父仓库 `nightly.yml`（每日 02:30 北京时间跑 check/test/build/mvp1-eval/release-check）、`production-health.yml`（每 6 小时）。
- 应用内无 cron；复习调度是数据驱动的惰性计算（`review-scheduler.js`）。

## 10. 发布与回滚（已验证脚本）

- 前端发布：`scripts/deploy-web.sh`（本地构建 → scp 到 `114.67.169.78` → 备份 `/var/www/mindiou` → 解压 → 同步 mvp1/training 产物 → 6 项 HTTP 验证；输出回滚命令）。
- 服务器侧静态同步：`deploy/sync-web.sh`（rsync dist/ 与 web/dist/ 到 `/var/www/mindiou`）。
- 后端发布：**无脚本**（已验证）。推断流程为 git pull + npm ci + build + `systemctl restart mindiou`，待确认，已在 DEPLOYMENT_RUNBOOK 中文档化。
- 回滚：前端用 deploy-web.sh 生成的备份目录；后端无既定回滚机制（systemd 无蓝绿），见 BACKEND_DEBT_BACKLOG。

## 11. 开发/生产差异（已验证 + 推断）

| 维度 | 开发 | 生产（推断项已标注） |
|---|---|---|
| 入口 | `npm run api`（加载 `.env.local`） | systemd `node server.js` + `/etc/mindiou.env` |
| 端口 | 8793 | 8794（推断，无法确认） |
| AI | 可缺省（自动 fallback） | deepseek 文本；RESEARCH/STT 未配置；`MVP1_DEMO_FALLBACK=1` |
| 访问控制 | 无 token 时全开放（本地约定） | `LEARNING_API_TOKEN` + 早期访问码 + 账户体系（已验证 deploy/README） |
| Cookie Secure | 关闭 | `MINDIOU_COOKIE_SECURE=1`（已验证文档要求） |
| 数据目录 | `tmp/` | `/var/lib/mindiou/`（已验证 deploy/README） |
| 公网入口 | 无 | Nginx IP 证书 HTTPS；Quick Tunnel 应急 |

## 12. 父仓库其它组件（与后端边界相关，已验证存在）

- `evenhub-g2-dashboard/`、`g2-personal-dashboard/`、`hackathon/mindiou-submission/`、`personal-os/`：独立小前端/记录库，不经主 API。
- 父仓库根存在孤儿 `package-lock.json`（name=personal_os，空 packages，无对应 package.json）——无实际作用，已记入债务清单。
- 父仓库根有多个 `mindiou-health-check-*.md` / `mindiou-nightly-quality-*.md` 定时健康报告（人工/自动任务产物）。
