# Cognitive Loop MVP 任务总结

日期：2026-08-12  
分支：`codex/mindiou-cognitive-loop`

## 目标

依据 `MindIOU_认知循环与AI协作能力_PRD_v0.1.docx` 第 19.1 节，完成第一条可运行的 MVP 垂直切片：

```text
AI 活动导入 → AI Collaboration Profile → AI Usage Debt
→ Cognitive Briefing → 行为实验 → 下一周验证 → 用户反馈影响下一轮排序
```

## 已实现

- 后端 `cognitive-loop.js`：
  - 近 7 天活动窗口；
  - 4 个 MVP 维度：问题建模、Context Engineering、判断与验证、工作流与委派；
  - 每轮输出带行为证据摘录、置信度、`missing_evidence` 标记的画像；
  - 选择一个最值得改变的 AI Usage Debt；
  - 生成一个 7 天行为实验和下一周验证入口；
  - 固定候选内容去重、相关性/新颖度/证据强度评分，并限制 attention budget 为 1；
  - 上一轮用户对债务和内容的反馈会改变下一轮债务与内容排序；
  - 只保存活动 hash 与短摘录到分析结果，明确 rule fallback 与证据边界。
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
  - 四维画像、证据、AI Usage Debt、Briefing、行为实验和下一周验证；
  - 支持“符合/纠正”“值得看/跳过”“已改变行为/尚未执行”等反馈；
  - 刷新后按项目恢复最新结果。
- 路由和导航：新增 `#/cognitive-loop` 与主导航入口。

## 验收证据

- 根目录类型检查：`npm run check` 通过。
- 根目录完整测试：48 个测试文件、703 个测试通过。
- 新增分析/存储测试：6 个测试通过。
- Web 完整测试：10 个测试文件、79 个测试通过。
- Web 生产构建：`npm run build` 通过。
- Node 语法检查：`cognitive-loop.js`、`cognitive-loop-store.js`、`server.js` 通过。
- 本地 HTTP 闭环已验证：
  - 注册临时账号并创建项目；
  - 提交 2 条 AI 活动，返回四维画像、AI Usage Debt、Briefing 和实验；
  - `GET /latest` 刷新读取成功；
  - 相同 `clientRunId` 重试返回 `idempotent: true`；
  - 提交用户 correction 反馈成功；
  - 未登录访问返回 401；
  - 空活动请求返回 400。
- 未执行生产部署；本地验证使用临时 SQLite 数据库和临时账号。

## 明确边界 / 后续工作

- 当前分析来源是可审计的结构化规则 fallback，不是 LLM 评估；后续可在不改变 schema 的前提下接入服务端结构化模型输出。
- 当前固定内容候选支持摘要、来源和可选分段；尚未实现全网抓取、字幕/视频 VLM、OCR、Whisper 或真实内容平台 connector。
- 当前实现 4 个 MVP 维度；PRD 中更完整的 7 维长期成长画像、跨周趋势和长期能力认证尚未声称完成。
- 当前“下一周验证”记录为反馈事件，尚未接入自动周任务调度和跨轮统计报表。
