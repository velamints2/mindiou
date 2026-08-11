# MindIOU 工作区前端与清偿入口优化

日期：2026-08-08

## 已完成

- 认知报告生成后自动、幂等同步到认知清偿待处理集合；历史报告在打开清偿页时也会补同步。
- 认知清偿页改为摘要指标 + 卡片分区：待清偿、复习队列、清偿记录、历史报告。
- 明确复习队列的逻辑：首次清偿作答后，系统才会根据结果安排复习。
- 项目认知账本列表页保留全局搜索入口，不再在项目加载完成后丢失搜索表单。
- 项目认知账本右上角“项目列表”改为原生 hash 链接，修复点击无跳转问题。
- 项目认知账本统计字段统一显示中文：Agent 会话、功能任务、关联产出物、关键决策、认知欠条、已具备人类所有权。
- 找回“用户画像”路由、工作区入口和全站导航入口，新增能力领域、维度分数、证据等级和空状态卡片。
- 今日复训页、复训作答页取消浏览器 `alert`，改为卡片化错误和页内反馈。
- 训练/清偿请求统一使用请求错误封装，429/503 会展示限流保护说明并暂时禁用重试按钮。

## 验证

- `node --check server.js`：通过。
- `npm --prefix web test`：8 个测试文件、65 项通过。
- `npm --prefix web run build`：通过。
- 生产健康检查：`cognitiveRepaymentV1: true`，服务 active。
- 生产 HTML 当前引用：`index-CYC70HLs.js`、`index-CeEdd4AO.css`。
- 公共静态资源均返回 HTTP 200。
- 未登录访问 `/mindiou-api/api/repayment/gaps`、`/api/repayment/profile`、`/api/projects` 均返回 401，权限边界正常。

## 生产变更与回滚

- 后端备份：`/opt/mindiou/deploy-backups/frontend-workspace-20260808T000000Z/server.js`
- 前端静态备份：`/opt/mindiou/deploy-backups/frontend-workspace-20260808T000000Z/static/` 与 `static-final/`
- 生产服务：`mindiou.service`，当前服务正常运行。

## 当前限制

- 当前环境的根目录全量测试因本机缺少 `better-sqlite3` Node 原生绑定而无法启动依赖 SQLite 的测试服务；与本次前端测试无关。生产服务自身已通过健康检查。
- 本轮没有伪造已接入 Codex/Trae/Claude Code 历史会话 API；项目记忆仍使用已有手动导入、Hook 和项目记忆 API 能力。
- 本轮 in-app browser 的登录态视觉截图因导航超时未能取得，因此生产视觉确认采用构建产物、公开 HTML/静态资源、接口边界和单元测试验证；已登录用户建议强制刷新后按路径复核。

## 2026-08-09 Genesis archive follow-up

- 删除“上线前需补齐”隐私卡片，剩余隐私卡片自动横向铺满。
- `/api/genesis` 从真实 auth 数据中展示最早五个注册账号的 Genesis 编号；未主动公开的用户只显示匿名编号，不返回邮箱。
- 保留其他用户主动选择公开的 Genesis 身份。
- “共创建议已采纳”及 API 数据更新为 4 项已上线改进，并返回对应产品改进说明。
- 本次生产前端入口：`index-CpaSH0wZ.js`、`index-B39Z90ma.css`。
- 本次生产后端备份：`/opt/mindiou/deploy-backups/genesis-20260809T001500Z/`。
- 公开 API 验证：最早五个编号为 `MIOU-001-0001` 至 `MIOU-001-0005`；`actual.adoptedSuggestions` 为 4；用户邮箱未出现在响应中。
