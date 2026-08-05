# Project Memory 交付记录

## 已完成

- 审计现有 Node HTTP、better-sqlite3/WAL、training-store、mastery、认证和原生
  TypeScript/Vite 前端。
- 新增 Project、WorkItem、AgentSession、Artifact、DecisionRecord、关联表、
  EvidenceRecord、DebtRecurrence、Hook Token/Event 关系表。
- 手动导入支持文本、Markdown/TXT、JSON、JSONL；Hook 支持批量事件和事件幂等。
- 规则化结构化归纳：用户意图、Agent 实现、结果、Artifact、Decision、欠条候选。
- WorkItem 自动匹配/创建、Artifact 去重、CognitiveDebt 多对多关联、项目搜索、
  时间线、所有权状态和欠条项目历史。
- 接入既有 TrainingAttempt：不改掌握度状态机，只生成证据记录。
- Web 页面：/projects、/projects/:projectId、
  /projects/:projectId/work-items/:workItemId、/agent-sessions/:sessionId，
  并升级现有欠条详情页。
- 用户权限按现有 HttpOnly Cookie 会话隔离；Hook token 支持一次性明文返回和撤销。
- 默认不保留完整原始对话；路径脱敏；相关内容不写普通日志。

## 验收结果

真实 HTTP 场景已验证：

    导入激活码对话
    -> MindIOU 项目
    -> 激活码兑换与防重复使用 WorkItem
    -> activationCode.ts / redeem.ts / redeemActivationCode / 8f3a2d1
    -> 条件更新和唯一约束 Decision
    -> 并发竞态 CognitiveDebt 候选
    -> 接受候选后关联现有 CognitiveDebt
    -> 搜索激活码和重复导入幂等

本地验证：

- npm test -- --reporter=dot：36 个测试文件、556 个测试通过。
- npm run check：通过。
- npm run build：通过。
- 新增 src/project-memory-analysis.test.ts 和
  src/project-memory-store.test.ts。

## 明确未完成

- 没有读取 Codex、TRAE、Claude Code 等平台私有历史；当前没有伪造自动接入。
- 没有真实 Git 扫描/Commit Diff 导入，只接受手动导入或 Hook payload 中的元数据。
- 原始内容只有不保存或脱敏摘要路径，尚未实现真正加密存储。
- project-memory-store.js 使用启动时幂等 DDL；独立 migration runner 和生产 down
  migration 仍需在有备份/发布窗口时补充。
