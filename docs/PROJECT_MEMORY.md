# Project Memory / 项目认知账本

## 这次交付的边界

Project Memory 是现有 MindIOU 训练系统之上的关系图层。它不复制
CognitiveDebt、TrainingAttempt、MasteryProfile 或训练状态机；它只保存项目、
会话、真实产出物、决策、关联、证据和复发上下文。

数据库仍然使用现有 DATA_DB_PATH SQLite 文件和 WAL。启动时
project-memory-store.js 以幂等 DDL 建立 pm_* 表，因此新表不会改变旧
application_state 命名空间。删除项目会级联删除 Project Memory 关联，但不会
删除训练系统中的 CognitiveDebt 或 TrainingAttempt。

## 表和关系

- pm_projects / pm_work_items
- pm_agent_sessions
- pm_artifacts
- pm_session_work_items
- pm_session_artifacts
- pm_work_item_artifacts
- pm_decisions
- pm_debt_artifact_links
- pm_evidence_records
- pm_debt_recurrences
- pm_hook_tokens / pm_hook_events

Artifact 的唯一键是项目 + 类型 + 仓库相对路径/符号/Commit；如果这三种定位都
没有，才回退到名称。绝对路径只会被存储为仓库相对路径或
[local-path-redacted]/文件名。

## 会话处理

project-memory-analysis.js 提供 AgentSessionAdapter 兼容接口的手动和 Hook
实现。当前支持：

1. JSON body 中的 text、fileContent、messages；
2. Markdown、TXT、JSON、JSONL 的角色归一化；
3. 标准 Hook 事件：session_started、user_prompted、agent_message、
   file_changed、test_executed、commit_created、session_finished。

导入流水线是：

    normalize -> project detect/create -> structured analysis
    -> artifact upsert -> work-item match/create -> decision records
    -> links -> debt candidates -> recurrence check

WorkItem 相似度阈值目前固定为产品约定的三段行为：0.85 以上自动归入，0.55 到
0.85 保留为待确认候选，低于 0.55 不自动合并。第一版的结构化归纳是本地规则
分析器，模型接入不是必要条件；所有结果都可通过 PATCH 或人工关联 API 修正。

## 关键 API

    GET/POST/PATCH/DELETE /api/projects
    GET/PATCH             /api/projects/:projectId
    GET                   /api/projects/:projectId/memory
    GET                   /api/projects/:projectId/timeline
    GET                   /api/projects/:projectId/search
    GET                   /api/projects/:projectId/ownership

    GET/POST              /api/projects/:projectId/work-items
    GET/PATCH             /api/work-items/:workItemId
    POST                  /api/work-items/:workItemId/merge
    POST                  /api/work-items/:workItemId/split

    POST                  /api/agent-sessions/import
    POST                  /api/agent-sessions/events
    GET                   /api/agent-sessions/:sessionId
    POST                  /api/agent-sessions/:sessionId/analyze
    POST                  /api/agent-sessions/:sessionId/reprocess

    GET                   /api/projects/:projectId/artifacts
    GET                   /api/artifacts/:artifactId
    POST                  /api/artifacts/:artifactId/link-debt
    POST                  /api/artifacts/:artifactId/link-session

    GET                   /api/projects/:projectId/decisions
    GET/PATCH             /api/decisions/:decisionId

    GET/POST              /api/debts/:debtId/artifacts
    DELETE                /api/debts/:debtId/artifacts/:linkId
    GET                   /api/debts/:debtId/project-history
    GET                   /api/debts/:debtId/recurrences
    GET/POST              /api/debts/:debtId/evidence

    GET                   /api/search?q=...&projectId=...
    POST/GET/DELETE       /api/projects/:projectId/hook-token[/:tokenId]

Hook token 只返回一次明文，数据库只存 SHA-256 hash，删除/撤销后立即拒绝。
也可以在受控服务器环境通过 PROJECT_MEMORY_HOOK_TOKEN 使用全局 Hook token，
但生产环境应优先使用项目级 token。

## 证据和所有权

训练系统写入 TrainingAttempt 后，服务器按既有训练阶段生成 EvidenceRecord：
初始补偿 E1、延迟回忆 E2、误区/错误检测 E3、场景迁移 E4、真实工作验证 E5。
它不会修改或替代 MasteryProfile。

项目所有权只从 EvidenceRecord 推导，且“测试通过”不会自动生成 E5。手动真实
工作证据可以通过 POST /api/debts/:debtId/evidence 写入，并附带
externalReference。E5 的使用责任仍然需要用户提供可追溯外部证据。

## 仍未接入的能力

- Codex、TRAE、Claude Code、Cursor 的私有历史自动读取；
- 本地平台日志目录的硬编码扫描；
- 真正的端到端加密原始对话保存；
- Git 仓库自动扫描、真实 Diff 解析和 PR webhook；
- 自然语言项目问答；
- 独立的数据库 migration runner/down migration。

这些边界是刻意保留的：当前实现不伪造平台历史 API，也不默认上传整个仓库。
