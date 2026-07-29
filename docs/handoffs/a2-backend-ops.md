# Handoff：A2 后端与服务器安全梳理

- 日期：2026-07-30
- 分支：`refactor/backend-ops-boundaries`（独立 worktree `mindiou-worktrees/a2-backend`）
- 起点：main @ `d3321e2`（任务书所述基线标签 `overnight-baseline-2026-07-30` 在仓库中不存在【待确认：标签未创建或已删除】）
- 未做任何部署；未 SSH 生产服务器；未修改生产配置

## 1. 完成内容

1. **资产清单与架构**：`docs/ops/SERVICE_INVENTORY.md`、`docs/ops/BACKEND_ARCHITECTURE.md`（含 Mermaid 分层图与当前混乱点）
2. **配置治理**：`env-validation.js` 启动期验证（errors 拒启 / warnings 续行 / `MINDIOU_STRICT_ENV=1` 升级，永不打印值）；`.env.example` 按必填/可选、dev/test/prod、默认值安全性重写；`CONFIGURATION_REFERENCE.md`
3. **健康检查分层**：`/healthz`（liveness）与 `/readyz`（readiness：auth store 探测 + ai/research/stt 配置自检），不调用模型、不含秘密与堆栈；Nginx 两个端点反代 + 限流已加入 `deploy/nginx-mindiou-locations.conf`；旧 `/health` 保持兼容
4. **可观察性与错误语义**：全响应 `x-request-id`；单行 JSON 结构化请求日志（method/path/status/durationMs，敏感字段禁令写入代码注释）；请求体超限 413、JSON 非法 400、未处理异常 500 不泄露内部消息；404/405 负载补 requestId；STT 增加 `STT_TIMEOUT_MS`（默认 30s）超时
5. **安全审查**：`docs/ops/SECURITY_REVIEW.md`（11 项已验证良好现状、8 项风险、模型调用治理 12 维度汇总）
6. **部署/故障文档**：`DEPLOYMENT_RUNBOOK.md`（本地/首部署/更新/日志/回滚/公网验证）、`INCIDENT_RUNBOOK.md`（requestId 定位法、4xx 语义表、模型/存储/证书/滥用排查）
7. **债务清单**：`BACKEND_DEBT_BACKLOG.md` D1-D11（含 server.js 四阶段拆分方案）

补充完成（追加提交 f82d581）：
8. **D6 max_tokens**：chatJson 新增可选 maxTokens 参数（默认 4096），所有文本生成调用获得输出上界
9. **D7 jti 128bit**：early-access jti 从 randomBytes(9) 提到 randomBytes(16)

## 2. 修改文件

| 提交 | 文件 |
| --- | --- |
| ea40932 | docs/ops/SERVICE_INVENTORY.md、docs/ops/BACKEND_ARCHITECTURE.md |
| ac8d10f | env-validation.js（新）、.env.example、server.js（接入验证）、src/env-validation.test.ts（新） |
| 14c1e95 | server.js（/healthz、/readyz）、deploy/nginx-mindiou-locations.conf、src/ops-health.test.ts（新） |
| 69a8e4e | server.js（requestId/日志/413/400/500/STT 超时）、src/ops-api.test.ts（新）、src/ops-health.test.ts（端口冲突修复） |
| d9727de | docs/ops/SECURITY_REVIEW.md、CONFIGURATION_REFERENCE.md、DEPLOYMENT_RUNBOOK.md、INCIDENT_RUNBOOK.md、BACKEND_DEBT_BACKLOG.md（均新） |

## 3. 实际后端架构（核验后）

```text
浏览器/G2/Rokid/手机
  → Nginx 443（IP 证书；mindiou_general 30r/m、mindiou_ai 6r/m 限流）
    → /mindiou/ 静态（/var/www/mindiou，sync-web.sh 发布）
    → /mindiou-api/ → 127.0.0.1:8794 → server.js（单进程原生 HTTP）
        → 路由层（认证：Cookie 会话 / 邀请码 / LEARNING_API_TOKEN Bearer）
        → 领域逻辑（MVP-0 报告、MVP-1 清偿、训练、Spiral/G2）
        → 模型供应商（chat 30s / research 45s / STT 30s 超时，JSON 模式）
        → 存储（/var/lib/mindiou/*.json + auth-store.sqlite）
        → journald（systemd 捕获 stdout 结构化日志）
应急入口：cloudflared quick tunnel（仅证书失效时启用）
```

混乱点（未动，见 BACKLOG D11）：server.js 2400+ 行单文件，路由/领域/供应商调用混合。

## 4. 执行命令（复现路径）

```bash
cd evenhub-g2-learning
npm run check        # tsc --noEmit ✅
npm test             # 31 文件 496 通过 0 失败 ✅
npm run build        # vite ✅
npm run check:release # 版本/产物一致性 ✅
# 安全扫描：git 历史密钥模式（零命中）、硬编码 IP 盘点、npm audit（1 high：postcss，构建期）
```

## 5. 测试结果

- `npm run check` 通过；`npm test` 496/496（新增 env-validation 9 例、ops-health 4 例、ops-api 7 例）；`npm run build`、`check:release` 通过
- 期间修复：新增测试端口与 device-token-api.test.ts 冲突（8805/8806 → 8812/8813/8814）；该问题仅在全量并行跑时暴露

## 6. 未完成事项

- CORS 白名单化（D1，需产品确认 Origin 清单，属行为变更未擅自实施）
- 生产 `HOST=127.0.0.1` 与安全组确认（D2，需服务器权限【待确认】）
- `/var/lib/mindiou` 自动备份（D3）
- postcss 升级（D4，受「不动 lock」约束暂缓）
- max_tokens、jti 128bit、发布脚本入仓、幂等键、重试、server.js 拆分（D6-D11）

## 7. 风险

- **P0**：无。金路径未触碰，公网 Demo 行为未变。
- **P1**：CORS `*`+credentials 组合（D1）；Node 默认 0.0.0.0 可被直连绕开限流（D2，配置可解）。
- **P2**：postcss 高危（构建期）；Rokid 硬编码生产 IP；模型调用无 max_tokens；无应用层限流兜底；jti 72bit。详见 SECURITY_REVIEW 与 BACKLOG。

## 8. 回滚方式

- 代码：分支未合入 main，main 停在 d3321e2；如需丢弃，`git reset --hard d3321e2`（本分支独有提交，不影响他人）。
- 单提交回退：按 cherry-pick 逆序 `git revert <sha>`；五个提交相互低耦合，文档提交（ea40932、d9727de）可随时独立 revert。
- 生产：未部署，无生产回滚事项。将来部署回滚见 DEPLOYMENT_RUNBOOK 第 6 节。

## 9. 是否改变运行行为

**是，有限的向后兼容增强**：

- 所有响应新增 `x-request-id` 头；404/405/400/500 错误负载新增 `requestId` 字段（新增字段，向后兼容）
- 请求体超限：连接被销毁 → 返回 413 JSON（此前客户端只见断连）
- JSON 解析失败：500 → 400（修正错误语义）
- 未处理异常：响应体从内部错误消息 → `Internal server error`（收窄泄露面）
- STT 调用新增 30s 超时（此前无超时，可永久挂起）
- 启动期新增 env 验证：值非法时拒启（此前静默）；warnings 不阻断
- API 路径、既有字段含义、认证流程、领域逻辑、持久化格式：零变化

## 10. Commit SHA（分支HEAD → 起点）

```
d9727de docs(ops): 安全审查、配置参考、部署与故障 Runbook、债务清单
69a8e4e feat(ops): 请求 ID、结构化日志、错误语义与 STT 超时
14c1e95 feat(health): 新增 liveness/readiness 分层健康检查
ac8d10f feat(config): 新增启动期环境变量验证并重构 .env.example
ea40932 docs(ops): 新增后端资产清单与架构文档
```

## 11. 推荐 cherry-pick 顺序

按提交顺序正序应用（后者依赖前者的代码存在，如 ops-health 测试依赖 /healthz；ops-api 测试依赖 requestId 与错误语义；env-validation 接入依赖模块本身）：

```bash
git cherry-pick ea40932   # 1 文档：清单+架构（零代码，最安全）
git cherry-pick ac8d10f   # 2 配置：env-validation + .env.example
git cherry-pick 14c1e95   # 3 健康检查：/healthz /readyz + nginx
git cherry-pick 69a8e4e   # 4 可观察性：requestId/日志/错误语义/STT 超时
git cherry-pick d9727de   # 5 文档：安全审查+Runbook+债务清单
```

每个 cherry-pick 后执行 `npm run check && npm test && npm run build`；若只能选部分，2+3+4 是代码核心，1+5 可随时补。
