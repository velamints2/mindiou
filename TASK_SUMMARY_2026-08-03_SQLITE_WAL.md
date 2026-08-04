# MindIOU SQLite WAL 持久化迁移

日期：2026-08-03

## 结果

- 账户、报告、MVP-1 清偿会话、训练状态、认知清偿状态和 Spiral 学习状态统一写入 `DATA_DB_PATH` 指向的 SQLite 数据库。
- 所有连接启用 WAL、`synchronous=NORMAL`、外键和 5000ms busy timeout。
- 原 JSON 文件只作为首次升级的只读迁移源；迁移证据写入 `data_migrations`，后续运行不再读写 JSON。
- 业务 Store 的公开 API 保持不变，避免扩大服务端和前端改动范围。
- 新增每日 03:20（Asia/Shanghai）自动备份的 systemd service/timer。
- 备份通过 SQLite online backup API 生成，对源库和备份库分别执行完整性检查，默认保留 30 天。
- 新增输入与成本保护：普通文本最多 30,000 字符、请求体最多 10 MB、每位用户每天最多 3 次新分析、每日估算 AI Token 预算默认 200,000。
- 每日次数和估算 Token 使用量写入 SQLite `daily_usage`，事务内检查并扣减；由时间线草稿继续生成报告不会重复计次。
- 当前产品仅支持粘贴纯文本。文件拖入/粘贴、非 JSON 请求、超长文本和配额耗尽均返回明确的中英文提示，不再静默截断。

## 迁移规则

- 配置 `DATA_DB_PATH=/var/lib/mindiou/mindiou.sqlite` 后，所有 Store 共用该数据库。
- 为兼容现有生产配置，未配置 `DATA_DB_PATH` 时暂以 `AUTH_STORE_PATH` 作为统一数据库路径。
- `LEARNING_STORE_PATH`、`MVP0_STORE_PATH`、`MVP1_STORE_PATH`、`TRAINING_STORE_PATH`、`COGNITIVE_REPAYMENT_STORE_PATH` 只作为旧 JSON 导入来源。
- 仅当对应 SQLite 命名空间为空且没有迁移记录时导入，避免覆盖已经写入的新数据。

## 验收

- 新增 SQLite 测试覆盖 WAL、命名空间隔离、幂等 JSON 迁移、迁移记录和完整性检查。
- 备份实测：源库为 WAL，源库与备份均 `integrity_check=ok`，备份可读取持久化记录。
- 根工程：33 个测试文件、543 项测试全部通过；TypeScript 检查和生产构建通过。
- Web 工程：4 个测试文件、45 项测试全部通过；生产构建通过。
- 全量根工程测试连续运行两次均为 543/543。

以上测试数是 SQLite 迁移完成时的基线；加入输入限制后的最终测试与构建结果见本任务最终交付说明。

## 输入限制配置

- `MAX_ARTIFACT_CHARS`：默认 `30000`。
- `MAX_REQUEST_BODY_BYTES`：默认 `10485760`（10 MB）。
- `DAILY_ANALYSIS_LIMIT`：默认 `3`。
- `USER_DAILY_AI_TOKEN_BUDGET`：默认 `200000`，按字符数估算输入 Token，并预留输出额度。
- `AI_OUTPUT_TOKEN_RESERVE`：默认 `10000`。

当前没有文件上传功能，因此“单文件 10 MB”落地为请求体硬上限，并在前端明确提示暂不支持文件。未来增加上传端点时仍需对解压后大小、MIME、扩展名和解析器分别校验，不能仅依赖请求体限制。

## 最终验收（SQLite + 输入限制）

- 根工程 `npm run check`：通过。
- 根工程 `npm test`：33 个测试文件、546 项全部通过。
- 根工程 `npm run build`：通过。
- Web `npm run check`：通过。
- Web `npm test`：4 个测试文件、46 项全部通过。
- Web `npm run build`：通过。
- 输入限制专项覆盖：非 JSON 格式 415、30,001 字符 413、每日前三次成功且第四次 429、中英文错误、SQLite 原子次数/Token 预算扣减、前端超长内容保留并禁止提交。

## 生产边界

- 2026-08-04 经用户明确授权部署到 `156.225.23.88`，生产服务继续由 `/opt/mindiou` 的 `mindiou.service` 运行。
- 统一数据库：`/var/lib/mindiou/mindiou.sqlite`；运行进程已确认读取 `DATA_DB_PATH`。
- 迁移前停写并执行 WAL checkpoint，回滚快照：`/opt/mindiou/deploy-backups/sqlite-wal-20260804030116`。
- 迁移后数据库：WAL、`integrity_check=ok`、外键开启、`synchronous=NORMAL`。
- 生产记录核对：12 个账户、22 个账户会话、14 份报告、15 份草稿、8 个清偿会话；认知清偿 gaps/attempts/reviewQueue/capabilityProfiles 各 1。
- 三个旧 JSON 的 SHA-256 与停服快照完全一致，重启后修改时间仍未变化，证明运行时不再写回 JSON。
- 每日备份 timer 已启用；首次在线备份为 `/var/lib/mindiou/backups/mindiou-20260804T030425Z.sqlite`，完整性和全部记录数均与源库一致。
- 正式重启后 `mindiou.service` 为 active/running、`NRestarts=0`；公网 health、Genesis、未登录鉴权保护和全部旧入口验证通过。
- 旧 JSON 暂时保留为回滚证据，不删除；稳定观察后再单独决定归档时间。
