# MBAI 统计持久化修复

## 变更

- 新增 `assessment_completions` SQLite 表，使用现有数据数据库和 WAL 模式。
- MBAI 完成记录按 `completionId` 去重，后台累计数不再依赖内存中的最近200条事件。
- “今日测试”按 `Asia/Shanghai` 的自然日统计。
- 前端用版本、角色和测试开始时间组成稳定 `completionId`，避免刷新/重试重复计数。
- 启动时保留旧事件流统计作为兼容回退；生产部署前从旧内存事件中回填了仍可读取的2条 MBAI 记录。

## 验证

- Web 类型检查、构建、62项测试通过。
- 根工程类型检查通过；运营/鉴权相关27项测试通过。
- 生产服务 `mindiou.service` active。
- 生产统计接口返回累计2条，角色分布为 developer 1、research 1；截至部署时北京时间当日为0。

## 生产回滚点

- 后端：`/opt/mindiou/deploy-backups/assessment-stats-20260806001155`
- 前端：`/var/www/mindiou-backup-assessment-stats-20260806002352`

旧的、已被内存事件环形队列淘汰或在更早服务重启中丢失的 MBAI 记录无法从现有数据恢复；之后的新记录会持久保存。
