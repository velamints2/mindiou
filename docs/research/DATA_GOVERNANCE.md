# MindIOU 研究数据管理制度（DMP）

> 学校伦理审查 / 数据管理计划用途。所有"现状"描述基于 2026-10-13 代码与数据库实测，
> 改进项单独列出并注明状态。版本 v0.1。

## 1. 数据清单

| 数据类 | 内容 | 存储位置 | 敏感级 |
|-------|------|---------|-------|
| D1 AI 会话捕获 | AI 工具交互痕迹（工具调用、产出摘要、改动文件） | SQLite `pm_agent_sessions` + `pm_hook_events` | 中（含代码路径与工作内容） |
| D2 认知欠条 | gap 文本、证据等级 E0-E5、来源、生命周期状态 | SQLite training namespace + legacy JSON | 低（学习诊断信息） |
| D3 清偿行为 | quiz 作答、语音复述转写、阅读时长 | SQLite training/assessment namespace | 中（能力自评相关） |
| D4 实验数据 | EXP-1 标注、EXP-2 分组/暴露/盲测作答 | SQLite `experiment-*` namespace | 中（研究主数据） |
| D5 账户 | 邮箱、密码哈希、会话 cookie | SQLite `auth`（bcrypt） | 高（身份） |
| D6 第三方凭据 | B 站 SESSDATA（用户级 cookie） | SQLite `bilibili-digests-${userId}` namespace | **高（会话凭据）** |
| D7 消化产物 | 视频元数据、字幕摘要、卡片 | 同 D6 namespace | 低（公开内容衍生） |

## 2. 敏感数据处理现状（实测）

### D6 SESSDATA（最高风险项）
- 存储：AES-256-GCM 加密（密钥 `MINDIOU_SECRET_KEY` env 注入；2026-10-13 实施，
  实测 at-rest 为 `{v:1,iv,tag,data}` 密文结构，明文零泄漏；未设密钥时兼容明文并
  在首次写入时自动采用可用模式）。
- 读取面：仅 `POST /api/bilibili/digest` 单点使用；`GET /api/bilibili/settings`
  **只返回布尔** `sessdataConfigured`，不回显值（已实测）。
- 出网：仅随请求头发往 `api.bilibili.com`，不进日志、不进任何导出接口。
- 改进项 P1：字段级加密（AES-256-GCM，密钥 env 注入）——**未实施**，列入改进计划。

### D5 账户
- 密码 bcrypt 哈希；会话 cookie `HttpOnly`；登录接口限速。生产部署走 HTTPS 反代。

### D1 会话捕获
- 原始内容可选 `rawContentStorage: "redacted"`（B 站导入路径已默认 redacted）。
- MCP 捕获需 Bearer hook token，token 与项目绑定、按用户隔离。

## 3. 被试与知情同意

- **现阶段**：单被试设计，被试=开发者本人（YG）。知情同意以"研究者即被试"形式
  在研究纲领 §3.3 声明，无第三方被试数据。
- **复制阶段（P4 计划）**：扩展至 2-3 名用户前必须完成——
  a) 书面知情同意书（数据范围、退出权、销毁权）；
  b) 学校伦理审查备案（材料：本 DMP + 研究纲领 + 同意书模板）；
  c) 被试账号走邀请制，数据按 userId 隔离（现有机制已满足）。

## 4. 去标识与导出规范

- 研究导出统一经 `/api/experiments/exp1/export` 等接口或专用脚本
  （`scripts/exp1-*.js`），**不得直接拷贝库文件出研究环境**。
- 导出字段白名单：欠条文本、标注、时间戳、来源类型。**排除**：邮箱、
  userId 原值（以序号替代）、SESSDATA、raw_content。
- legacy 69 用户语料（208 条）为历史演示数据：导出分析时 userId 已按
  "跨用户 gap 类型库"聚合（R4 更正后口径），不含身份字段。
- 公开数据集（论文附录）采用双段去标识：userId 哈希截断 + 会话标题截断。

## 5. 保留与销毁

| 数据 | 保留期 | 销毁方式 |
|-----|-------|---------|
| 研究主数据（D2/D3/D4） | 论文发表后 5 年 | SQLite 行删除 + WAL checkpoint |
| D1 会话捕获 | 项目存续期；退出研究时 | 同上 |
| D6 SESSDATA | 被试要求或研究结束即删 | namespace 整体清除 |
| 账户（D5） | 账户注销即删 | 现有 delete 路径 |

## 6. 访问控制

- 数据不出本机（当前阶段）：SQLite 位于项目 `tmp/`，随仓库目录权限隔离。
- 服务暴露面：本地 8793（API）+ 8795（MCP，Bearer token）。公网部署
  （demo.mindiou.top）仅 HTTPS 反代白名单路由。
- 备份：SQLite WAL 快照进 Time Machine；研究里程碑节点手动冷备
  （命名 `mindiou-snapshot-YYYYMMDD.sqlite`）。

## 7. 开放科学承诺

- 预注册文档（EXP-2-PREREG）与研究纲领在实验启动前版本固化（git commit 哈希）。
- 论文发表时公开：匿名化数据集 + 分析脚本（exp1-analyze 等）+ 预注册偏离声明。
- 否定结果同样报告（R2 误判→R4 证伪的完整链条已留痕于 DECISIONS.md）。

## 8. 改进计划（按优先级）

| # | 项 | 状态 |
|---|----|------|
| P1 | SESSDATA 字段加密存储 | **已实施**（2026-10-13，AES-256-GCM + 向后兼容迁移，实测验证） |
| P2 | 导出接口字段白名单服务器端强制 | 部分实现（export 接口白名单；直读库文件无技术拦截，靠规范） |
| P3 | 研究数据导出审计日志 | **已实施**（2026-10-13，export/read 双写审计，500 条环形缓冲，/api/experiments/audit 查询） |
| P4 | 复制阶段知情同意书模板 | **已起草** v0.1（INFORMED_CONSENT_TEMPLATE.md，含主试使用备忘） |
