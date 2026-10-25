# Cognitive Loop MVP 任务总结

日期：2026-08-12  
分支：`codex/mindiou-cognitive-loop`

## 目标

依据 `MindIOU_认知循环与AI协作能力_PRD_v0.1.docx` 第 19.1 节，完成第一条可运行的 MVP 垂直切片，并补齐领域能力与 AI 协作能力并轨的第一版：

```text
AI 活动导入 → AI Collaboration Profile → AI Usage Debt
→ Cognitive Briefing → 行为实验 → 下一周验证 → 用户反馈影响下一轮排序
```

## 已实现

- 后端 `cognitive-loop.js`：
  - 近 7 天活动窗口；
  - 7 个 AI 协作一级维度：问题建模、任务拆解与委派、上下文构造、判断与验证、多轮协作与反馈、工作流与委派、AI 能力边界认知；
  - 每轮输出带行为证据摘录、置信度、`missing_evidence` 标记的画像；
  - 选择一个最值得改变的 AI Usage Debt；
  - 生成一个 7 天行为实验和下一周验证入口；
  - 固定候选内容去重、相关性/新颖度/证据强度评分，并限制 attention budget 为 1；
  - 上一轮用户对债务和内容的反馈会改变下一轮债务与内容排序；
  - 只保存活动 hash 与短摘录到分析结果，明确 rule fallback 与证据边界。
- 后端 `cognitive-profile.js` / `cognitive-profile-store.js`：
  - 定义并持久化 `UserCognitiveProfile`，按用户隔离保存；
  - 明确拆分 `domainCapabilityProfiles`、`aiCollaborationProfile`、`knowledgeDebts`、`aiUsageDebts` 四个集合；
  - 同一份规范化 `Activity Event` 同时进入领域能力引擎和 AI 协作引擎；
  - 领域能力沿用认知清偿的概念理解、因果解释、实践复现、边界与风险、迁移应用五个维度，不把未提供领域时的证据不足误写成领域缺口；
  - 领域知识缺口只有在活动中出现明确“不懂/不会/不理解”等信号时生成，并绑定知识、训练、解释、迁移、真实工作验证路径。
- 后端 `priority-engine.js`：
  - 在领域知识缺口、AI 使用缺口和未被过滤的前沿信息之间统一排序；
  - 每轮最多选择 1–3 个干预，并明确来源类别、干预方式、证据和行动；
  - AI 缺口映射到行为实验、委派、验证、上下文、工作流升级等路径。
- 后端 `cognitive-loop-store.js`：
  - SQLite 持久化 Loop run；
  - 按用户隔离项目和运行记录；
  - `clientRunId` 幂等重试；
  - 保存 recommendation、correction、experiment 三类反馈。
- `server.js` API：
  - `GET /api/cognitive-loop/latest?projectId=...`
  - `GET /api/cognitive-loop/runs/:id`
  - `POST /api/cognitive-loop/runs`
  - `POST /api/cognitive-loop/runs/:id/feedback`
  - 复用现有账户、项目和 Project Memory；活动以 `redacted` 方式写入既有 Agent Session，不创建并行项目域。
- Web 页面 `web/src/cognitiveLoop.ts`：
  - 项目选择/新建；
  - 项目背景、AI 活动和固定信息源输入；
  - Demo sample；
  - 领域能力与 AI 协作能力两个并行区域；
  - 七维 AI 协作画像、领域维度、知识欠条、AI 使用欠条和最多三项统一干预；
  - 两类缺口显示不同的干预方式：领域缺口走知识清偿，AI 协作缺口走行为实验。
  - 支持“符合/纠正”“值得看/跳过”“已改变行为/尚未执行”等反馈；
  - 刷新后按项目恢复最新结果。
- 路由和导航：新增 `#/cognitive-loop` 与主导航入口。

## 验收证据

- 根目录类型检查：`npm run check` 通过。
- 根目录完整测试：48 个测试文件、703 个测试通过。
- 新增分析、双引擎、优先级和存储测试：9 个测试通过。
- Web 完整测试：11 个测试文件、83 个测试通过。
- Web 生产构建：`npm run build` 通过。
- Node 语法检查：`cognitive-loop.js`、`cognitive-loop-store.js`、`server.js` 通过。
- 本地 HTTP 闭环已验证：
  - 注册临时账号并创建项目；
  - 提交 AI 活动和可选专业领域，返回双能力画像、两类缺口、统一干预、Briefing 和实验；
  - `GET /latest` 刷新读取成功；
  - 相同 `clientRunId` 重试返回 `idempotent: true`；
  - 提交用户 correction 反馈成功；
  - 未登录访问返回 401；
  - 空活动请求返回 400。
- 代码层验证：双引擎测试确认领域画像证据和 AI 协作画像证据引用同一个规范化活动事件 ID；Profile Store 测试确认同一用户单档案更新以及不同用户隔离。
- 本轮首版验收记录使用临时 SQLite 数据库和临时账号；生产发布记录见下方 2026-08-12 兼容修复。

## 2026-08-12 生产 404 修复

- 根因：页面 `/mindiou/index.html#/cognitive-loop` 使用的 `/mindiou-api/api/cognitive-profile` 与 `/mindiou-api/api/cognitive-loop/*` 没有加入生产 Nginx 反代白名单，请求被 `/mindiou-api/` 的通用 404 规则拦截；这不是 hash 页面路由不存在。
- 修复：在生产当前 Nginx 配置中，仅新增上述两组反代规则；Node 端原有登录、用户隔离和项目归属校验保持不变。
- 操作：先恢复并保留生产配置，再创建 `/etc/nginx/snippets/mindiou-locations.conf.backup-cognitive-loop-final-20260812041534`，定点插入规则，`nginx -t` 通过后 reload；未重启 Node、未触碰数据库。
- 回归：公开 `/mindiou/index.html` 200，`/mindiou-api/health` 200；未登录访问 `/api/cognitive-profile` 与 `/api/cognitive-loop/latest` 均由 Node 返回 401，不再返回 Nginx HTML 404；既有 G2 deck 与语音转写接口仍返回 Node 鉴权响应；`mindiou.service` active。
- 回滚：`ssh root@156.225.23.88 'cp -a /etc/nginx/snippets/mindiou-locations.conf.backup-cognitive-loop-final-20260812041534 /etc/nginx/snippets/mindiou-locations.conf && nginx -t && systemctl reload nginx'`。

## 2026-08-12 `Project not found` 兼容修复

- 根因：`GET /api/projects` 为兼容旧版项目所有权数据，会同时返回 `ownership-store` 项目和关系型 `Project Memory` 项目；Loop 的读取和运行接口却只调用 `projectMemoryStore.getProject()`。因此用户选择旧项目（例如 `mindiou-web`）后，运行本周循环会返回 `Project not found`。
- 修复：新增 `ensureCognitiveLoopProject()`。Loop 首次遇到仍存在于旧版所有权存储中的项目时，会以相同项目 ID 创建一个最小的 Project Memory 兼容记录；旧版所有权数据不被删除、不覆盖，后续 Loop 会话和运行记录继续使用原项目 ID。
- 存储层：`projectMemoryStore.ensureProject()` 支持在确认无同 ID 冲突时保留外部项目 ID materialize；新增定向存储测试覆盖首次创建、重复读取和稳定 ID。
- 生产操作：仅上传并执行 `deploy/patch-production-cognitive-loop-project-compat.mjs` 的定点补丁，未上传整份本地 `server.js`；生产备份为：
  - `/opt/mindiou/server.js.bak-cognitive-loop-project-compat-20260812085651`
  - `/opt/mindiou/project-memory-store.js.bak-cognitive-loop-project-compat-20260812085651`
  - `node --check` 两个生产文件均通过；`mindiou.service` 重启后为 `active`。
- 公开回归：`https://demo.mindiou.top/mindiou/index.html` 返回 200；`/mindiou-api/health` 返回 200；未登录 Loop API 返回 Node 的 401 JSON，而不是 Nginx 404。受保护的“旧项目 + 运行”完整成功响应仍需使用有效的已登录演示会话复测。
- 回滚：停止服务后将上述对应 `.bak-cognitive-loop-project-compat-20260812085651` 复制回原文件，再启动 `mindiou.service`；如需回滚，先保留当前文件并检查服务日志。

## 2026-08-12 生产仅发布预告页

- 发布策略调整：生产环境暂不开放可运行的 Cognitive Loop 表单；内部测试继续保留 `VITE_ENABLE_COGNITIVE_LOOP=true` 的显式开启方式。
- Web 行为：生产构建默认关闭 Loop 运行器；`#/fluency-loop-preview` 显示预告页，旧书签 `#/cognitive-loop` 也安全回落到同一预告页；生产导航只显示“Fluency Loop 预告”。
- 部署：先备份 `/var/www/mindiou-backup-fluency-preview-20260812091400`，随后因补充导航安全处理再次备份 `/var/www/mindiou-backup-fluency-preview-v2-20260812091600`；仅替换主 SPA 的 `index.html`、主 JS/CSS 和 admin chunk；保留 `legacy.html`、`report.html`、`desktop.html`、`mvp1.html`、`training.html` 等其他入口。
- 回归：生产 `/mindiou/index.html` 当前指向 `index-DORIK9kL.js`；bundle 已验证 `#/cognitive-loop` 在鉴权前回落到预告渲染，生产导航只出现预告入口；静态入口与 `/mindiou-api/health` 均返回 200。内部构建以 `VITE_ENABLE_COGNITIVE_LOOP=true` 验证仍保留真实 runner 路由。
- 回滚：`rm -rf /var/www/mindiou && cp -a /var/www/mindiou-backup-fluency-preview-v2-20260812091600 /var/www/mindiou && chown -R mindiou:mindiou /var/www/mindiou`。

## 明确边界 / 后续工作

- 当前分析来源是可审计的结构化规则 fallback，不是 LLM 评估；后续可在不改变 schema 的前提下接入服务端结构化模型输出。
- 当前固定内容候选支持摘要、来源和可选分段；尚未实现全网抓取、字幕/视频 VLM、OCR、Whisper 或真实内容平台 connector。
- 当前 7 个 AI 协作维度已完成规则版和持久化并轨；跨周趋势、校准实验和长期能力认证仍未声称完成。
- 当前“下一周验证”记录为反馈事件，尚未接入自动周任务调度和跨轮统计报表。
