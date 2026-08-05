# MindIOU 后端安全审查（A2）

- 审查日期：2026-07-30
- 审查范围：`evenhub-g2-learning/` 后端（server.js、auth-store.js、deploy/、scripts/）、Git 历史、依赖
- 审查基线：分支 `refactor/backend-ops-boundaries`，基线标签 `overnight-baseline-2026-07-30`
- 状态标注：【已验证】= 本次在仓库/命令输出中直接确认；【推断】= 基于代码合理推断；【待确认】= 需要生产环境或人工确认

## 一、已确认的良好现状

| 项 | 证据 | 状态 |
| --- | --- | --- |
| Git 历史无常见密钥模式 | 对全部 commit 扫描 `sk-*`、私钥头、`ghp_*`、`xox*`、`AKIA*`、JWT 形态字符串（排除 package-lock.json），零命中 | 【已验证】 |
| 密码哈希 | `auth-store.js` 使用 bcrypt（bcryptjs），注册写入 `password_hash` | 【已验证】 |
| 登录抗时序侧信道 | 用户不存在时仍执行一次 bcrypt 比较（`auth-store.js` L90-93 注释明确说明） | 【已验证】 |
| 设备令牌存储 | device token 仅存 bcrypt 哈希，明文仅在创建时返回一次 | 【已验证】 |
| 管理令牌比较 | `LEARNING_API_TOKEN` 比较使用 `crypto.timingSafeEqual`（server.js L251） | 【已验证】 |
| 会话/报告 ID 抗枚举 | 全部使用 `crypto.randomUUID()`；报告列表端点在公网部署中被 Nginx 阻断（deploy/README.md） | 【已验证】 |
| Cookie 属性 | `HttpOnly; SameSite=Lax`，生产或 HTTPS 下追加 `Secure`（server.js L309-311, L416-433） | 【已验证】 |
| 无调试接口/代码执行 | server.js 中无 `/debug`、`eval`、`child_process` 命中 | 【已验证】 |
| Nginx 限流 | `mindiou_general` 30r/m、`mindiou_ai` 6r/m（按 IP），AI 类端点单独更严（deploy/nginx-mindiou-ratelimit.conf + locations） | 【已验证】 |
| 请求体上限 | Node 侧 8MB，超限返回 413 JSON（本轮改进，前有连接被直接销毁问题） | 【已验证】 |
| 500 不泄露内部 | 未处理异常统一返回 `Internal server error` + requestId，内部消息仅进服务端日志（本轮改进） | 【已验证】 |
| 模型调用超时 | chat 30s / research 45s / STT 30s，均 AbortController 实现 | 【已验证】 |
| 结构化输出 | 主要生成调用带 `response_format: { type: "json_object" }`，解析后字段截断 | 【已验证】 |
| systemd 加固 | `NoNewPrivileges`、`PrivateTmp`、`ProtectSystem=strict`、`ReadWritePaths=/var/lib/mindiou`、`MemoryMax=512M` | 【已验证】 |
| 密钥不落库 | `/etc/mindiou.env` 通过 EnvironmentFile 注入；deploy/README 明确禁止复制进仓库 | 【已验证】 |

## 二、风险清单

### P1-1 CORS 配置矛盾：`Access-Control-Allow-Origin: *` 与 `Allow-Credentials: true` 并存

- 位置：server.js L209-224（普通响应与 OPTIONS 预检）
- 现状：浏览器规范下 `*` 与 credentials 组合无效，预检会失败；对非浏览器客户端（G2/Rokid）无影响；`SameSite=Lax` 使跨站 POST 不带 Cookie，CSRF 风险有限
- 风险：配置意图不清；一旦未来有人把 ACAO 改为反射 Origin，凭证跨域立即放开
- 建议（未实施，属行为变更）：新增 `MINDIOU_ALLOWED_ORIGINS`（逗号分隔），仅在白名单内回显 Origin；默认保持 `*` 以兼容现状。已在 BACKEND_DEBT_BACKLOG 立项
- 状态：【已验证】

### P1-2 Node 默认绑定 `0.0.0.0`，绕开 Nginx 即失去限流

- 位置：server.js L61 `const host = process.env.HOST || "0.0.0.0"`
- 现状：生产经 Nginx 反代 `127.0.0.1:8794`；若云安全组/防火墙未封 8794，直连即绕过全部 `limit_req`
- 建议（配置级，无需改码）：生产 `/etc/mindiou.env` 设置 `HOST=127.0.0.1`；并确认云安全组仅放行 80/443
- 状态：代码【已验证】；生产安全组配置【待确认】

### P2-1 postcss ≤8.5.17 高危漏洞（GHSA-r28c-9q8g-f849）

- `npm audit --omit=dev`：1 high，source map 路径穿越导致 `.map` 文件泄露
- 影响面：构建期依赖，运行时 server.js 不加载 postcss；实际可利用性低
- 处置：按任务约束不升级依赖、不动 lock 文件；记录在案，下一轮依赖窗口执行 `npm audit fix`
- 状态：【已验证】

### P2-2 Rokid 客户端默认硬编码生产 IP

- 位置：`platforms/rokid-aiui/config.js` L1、`app.js` L3、`tests/learning.node.mjs` L38
- 风险：非秘密（公网 IP），但环境耦合；未来迁移服务器需发改版客户端
- 建议：构建期注入或首启配置；BACKLOG 立项
- 状态：【已验证】

### P2-3 模型调用未设 `max_tokens`

- 位置：server.js L684、L1487 等 chat 调用
- 风险：单次调用输出成本无上界；配合 P3 无重试，整体成本风险可控但不精确
- 建议：按场景设 `max_tokens`（报告 4000、反馈 800 量级），BACKLOG 立项
- 状态：【已验证】

### P2-4 服务端无应用层限流兜底

- 现状：限流完全依赖 Nginx；Node 进程自身无 429 逻辑
- 缓解：P1-2 修复后（绑定 127.0.0.1）直连路径被封，风险显著下降
- 状态：【已验证】

### P2-5 early-access Cookie `jti` 仅 72 bit

- 位置：server.js L1620 `crypto.randomBytes(9)`
- 风险：爆破空间 2^72，配合 Nginx 限流实际不可行；但低于 128 bit 最佳实践
- 建议：改为 `randomBytes(16)`，BACKLOG 立项
- 状态：【已验证】

### P3-1 模型调用无重试/退避

- 现状：超时/供应商错误直接走降级（cautious fallback），不会放大重复计费
- 建议：如需提高成功率，加 1 次指数退避重试且仅在连接错误时；保持幂等语义不变
- 状态：【已验证】

### P3-2 报告生成/作答提交无幂等键

- 现状：重复提交会产生重复报告/重复模型调用；Nginx AI 限流（6r/m）提供粗粒度保护
- 建议：客户端生成 `Idempotency-Key`，服务端按用户+键去重；BACKLOG 立项
- 状态：【已验证】

## 三、观察项（非风险，记录以避免误报）

1. Nginx `client_max_body_size 100M` 与 Node 8MB 上限不一致：100M 服务于静态/上传类历史需求，API 超限由 Node 413 干净拒绝，语义正确。【已验证】
2. `audioBase64` 无独立长度上限，受 8MB 请求体约束（≈6MB PCM，16kHz 下约 3 分钟）。够用，暂不收紧。【已验证】
3. `deploy/` 与 `scripts/deploy-web.sh` 中的服务器 IP 属部署工件，`deploy-web.sh` 已支持 `MINDIOU_SSH_HOST` 覆盖。【已验证】
4. `/api/mentra/clearance-entry` 等设备通道继续走 `LEARNING_API_TOKEN` Bearer，标注为管理通道（测试 `keeps LEARNING_API_TOKEN as a labelled admin channel` 守护）。【已验证】

## 四、模型调用治理审查汇总

| 维度 | 现状 | 结论 |
| --- | --- | --- |
| 超时 | chat 30s / research 45s / STT 30s，AbortController | 达标 |
| 重试 | 无 | 记录 P3-1 |
| 并发/排队 | 无应用层控制；Nginx `mindiou_ai` 6r/m/IP 粗控 | 记录 P2-4 |
| 最大输入长度 | 各字段 `.slice(0, N)` 截断（如 interaction 30000 字符） | 达标 |
| 最大输出长度 | 未设 `max_tokens` | 记录 P2-3 |
| 成本风险 | 限流 + 超时 + 截断三重约束；无精确上界 | 可接受，见 P2-3 |
| fallback | 研究失败走 `curated_demo_fallback` 并明确标注；启发式评估不宣称清偿 | 达标 |
| 格式校验 | `response_format` JSON 模式 + 解析后字段截断 | 达标 |
| 供应商错误 | 超时/非 2xx 归一为 `{ ok:false, error }`，不暴露密钥 | 达标 |
| 用户取消 | 无显式取消通道；请求级 AbortController 仅管超时 | 记录 P3-1 同项处理 |
| 重复提交/幂等 | 无幂等键 | 记录 P3-2 |

## 五、本审查未做的事

- 未改写 Git 历史（无秘密需要清除，也无授权）；
- 未升级任何依赖、未修改 lock 文件；
- 未变更 CORS、绑定地址等运行行为（仅给出配置建议）；
- 未 SSH 进入生产服务器验证安全组与 `/etc/mindiou.env` 实际值（标记【待确认】项）。
