# MindIOU 配置参考

适用：`evenhub-g2-learning/server.js`（Node 原生 HTTP，单进程）。
示例文件：仓库根 `.env.example`（不含真实秘密）。
生产注入：服务器 `/etc/mindiou.env`，由 `deploy/mindiou.service` 的 `EnvironmentFile=` 加载。
启动验证：`env-validation.js` 在启动早期执行；**只打印变量名，永不打印值**。

- `errors`（值非法）→ 拒绝启动；
- `warnings`（缺失/偏弱）→ 继续启动；
- `MINDIOU_STRICT_ENV=1` → warnings 升级为 errors（建议生产开启）。

## 变量总表

### 服务监听

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `PORT` | 生产必填 | `8793` | 生产必须 `8794`（Nginx 反代目标）。验证：正整数 1-65535 |
| `HOST` | 生产建议 | `0.0.0.0` | **生产建议 `127.0.0.1`**，避免绕过 Nginx 限流（见 SECURITY_REVIEW P1-2） |
| `NODE_ENV` | 生产必填 | `development` | `production` 时启用 Cookie Secure 等生产行为 |
| `MINDIOU_STRICT_ENV` | 生产建议 | 空 | `1` 时配置警告升级为启动错误 |

### 文本生成模型（chat）

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `AI_PROVIDER` | 否 | `openai` | 生产当前 `302ai` |
| `AI_API_KEY` | 生产必填[秘密] | 空 | 缺失→内置 fallback；MVP-1 会话创建被拒（除非演示降级）。验证：长度 <16 警告 |
| `AI_BASE_URL` | 否 | `https://api.openai.com` | 验证：合法 http(s) URL |
| `AI_MODEL` | 否 | `gpt-4o-mini` | 生产当前 `gpt-5.6-sol`（经 302.AI） |
| `OPENAI_CHAT_TIMEOUT_MS` | 否 | `30000` | 验证：正数 |

### 联网检索模型（research）

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `RESEARCH_PROVIDER` | 否 | 同 AI_PROVIDER | 非 openai 且缺 KEY 时警告 |
| `RESEARCH_API_KEY` | 可选[秘密] | 空 | 缺失→检索透明降级，**不伪造来源** |
| `RESEARCH_BASE_URL` | 否 | `https://api.openai.com/v1` | 验证：合法 http(s) URL |
| `RESEARCH_MODEL` | 否 | `gpt-5.5` | |
| `OPENAI_RESEARCH_TIMEOUT_MS` | 否 | `45000` | 验证：正数 |

### 语音转写（STT）

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `STT_API_KEY` | 可选[秘密] | 空 | 缺失时转写接口返回错误态 |
| `STT_BASE_URL` | 否 | `https://api.openai.com/v1` | 验证：合法 http(s) URL |
| `STT_MODEL` | 否 | `gpt-4o-mini-transcribe` | |
| `STT_TIMEOUT_MS` | 否 | `30000` | 验证：正数。防止 STT 挂起拖死请求 |

### 旧别名（兼容旧部署，新部署勿用）

`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`、`OPENAI_RESEARCH_MODEL`、`OPENAI_STT_MODEL`、`OPENAI_STT_PROMPT`。
server.js 仍读取；`AI_API_KEY` 未设时回退到 `OPENAI_API_KEY`。

### 访问控制

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `LEARNING_API_TOKEN` | 生产必填[秘密] | 空 | 设备/服务通道 Bearer（G2/Rokid/GPASS）。比较用 timingSafeEqual。长度 <16 警告 |
| `MINDIOU_EARLY_ACCESS_CODES` | 可选[秘密] | 空 | 邀请码，逗号分隔 `label:code`；生成 `openssl rand -hex 12` |
| `MINDIOU_SESSION_SECRET` | 启用邀请码时必填[秘密] | 空 | ≥32 字节，否则邀请码登录 503（**启动 errors**）。生成 `openssl rand -hex 32` |
| `MINDIOU_SESSION_TTL_SECONDS` | 否 | `604800` | 代码钳制 300–2592000 |
| `MINDIOU_COOKIE_SECURE` | 生产必填 | `0` | 生产 HTTPS 必须 `1`；`NODE_ENV=production` 且非 1 时警告 |

### 行为开关

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SPIRAL_DISABLE_AI` | 空 | `1` 完全禁用 AI（测试/固定样本演示） |
| `MVP1_DEMO_FALLBACK` | 空 | `1` 启用策展降级（公开演示）。`NODE_ENV=production` 下开启会警告，需确认有意为之 |

### 数据存储路径

| 变量 | 开发默认 | 生产值 | 内容 |
| --- | --- | --- | --- |
| `LEARNING_STORE_PATH` | `tmp/spiral-store.json` | `/var/lib/mindiou/spiral-store.json` | Spiral/G2 学习态 |
| `MVP0_STORE_PATH` | `tmp/mvp0-store.json` | `/var/lib/mindiou/mvp0-store.json` | MVP-0 草稿/时间线/报告 |
| `MVP1_STORE_PATH` | `tmp/mvp1-store.json` | `/var/lib/mindiou/mvp1-store.json` | MVP-1 清偿会话 |
| `TRAINING_STORE_PATH` | `tmp/training-store.json` | `/var/lib/mindiou/training-store.json` | 训练系统任务 |
| `AUTH_STORE_PATH` | `tmp/auth-store.sqlite` | `/var/lib/mindiou/auth-store.sqlite` | 用户/会话/设备令牌（SQLite） |

生产目录 `/var/lib/mindiou` 由 systemd `ReadWritePaths=` 授权，属 `mindiou:mindiou`。

### 非 server.js 变量（本地工具）

`SPIRAL_PROJECT_ALLOWLIST`（agents/codex-collector 路径白名单）、`SPIRAL_API_URL`（历史遗留）。

## 环境差异速查

| 项 | 开发 | 测试（vitest） | 生产 |
| --- | --- | --- | --- |
| PORT/HOST | 8793 / 0.0.0.0 | 各测试文件独立端口 | 8794 / 建议 127.0.0.1 |
| AI | 可缺（fallback） | `SPIRAL_DISABLE_AI=1` 或 mock | 必填（deepseek） |
| Cookie Secure | 0 | — | 1 |
| 存储 | `tmp/` | 独立临时目录 | `/var/lib/mindiou/` |
| 访问控制 | 可全空（警告） | 显式置空测试降级 | TOKEN + 邀请码 |
| STRICT_ENV | 可不设 | — | 建议 1 |

## 日志与秘密纪律

- env-validation 与结构化日志均不打印变量值；
- 禁止把 `/etc/mindiou.env`、`.env.local` 提交进 Git（`.env.local` 已 gitignore）；
- 请求日志字段白名单：requestId、method、path、status、durationMs；禁止加入对话原文、AI 输入输出全文、密钥、Cookie、Authorization 头。
