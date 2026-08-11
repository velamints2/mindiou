# Project Memory 主流程接入（2026-08-08）

## 已完成

- 在生成认知债务报告的输入页增加“归入项目记忆”选择器：可选择已有项目，或只输入项目名称创建项目。
- 选定项目后，报告生成完成会自动调用 `POST /api/mvp0/reports/:reportId/project-memory`，复用本次已提交材料，不要求再次粘贴。
- 报告页保留手动关联入口，未在输入页选择项目时仍可在报告生成后归档。
- 新接口以 `reportId + projectId` 作为稳定幂等指纹，重复点击/刷新不会重复创建 AgentSession、WorkItem 或关联。
- 复用现有 MVP-0 报告、CognitiveDebt、TrainingAttempt 和 Project Memory 存储；接口只建立关系，不创建第二套欠条。
- 默认只保存会话摘要、结构化分析、来源材料哈希和元数据 Artifact，不保存完整原始材料。
- 项目详情页加入项目范围内的“搜索项目记忆”入口；公开顶栏加入“项目记忆”入口；工作区按钮名称修正为“项目记忆”。
- Nginx 部署白名单加入报告到项目记忆的新路径，并同步更新 `deploy/nginx-mindiou-locations.conf`。

## 验证

- 根目录：42 个测试文件，670 个测试通过。
- Web：8 个测试文件，63 个测试通过；TypeScript 检查和 Vite 构建通过。
- 新增后端验收：同一报告归入同一项目两次复用同一会话，项目记忆中只保留一条会话链；未登录请求返回 401。
- 公网：`https://demo.mindiou.top/mindiou/index.html` 已加载 `index-BfMyl8Qw.js`；健康检查正常；新接口不再被 Nginx 返回 404。

## 生产发布

- API 服务：`mindiou.service` 已重启，当前 PID 由发布前进程切换为 370749。
- 前端和后端发布前备份：`/opt/mindiou/deploy-backups/project-memory-20260808T075516Z`。
- Nginx 配置备份：`/opt/mindiou/deploy-backups/project-memory-nginx-20260808T075635Z`。

## 用户操作路径

1. 进入工作区，粘贴一次 AI 协作材料。
2. 在“归入项目记忆”选择已有项目，或输入名称点击“新建项目”。
3. 继续时间线和认知欠条生成；报告生成后自动归档到该项目。
4. 打开项目详情页，在“搜索项目记忆”输入功能名、文件、函数、Commit 或欠条关键词。
5. 如果生成时没有选择项目，可在报告页直接选择项目并点击“归入项目记忆”。

独立的 Agent 会话导入仍保留，用于历史对话、Hook 或本地文件记录；它不再是生成认知欠条主流程的必经步骤。
