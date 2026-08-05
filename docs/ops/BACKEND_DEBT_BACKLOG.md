# MindIOU 后端债务清单（A2 梳理产出）

来源：2026-07-30 后端与服务器安全梳理。每条含出处与建议验收方式。
优先级沿用仓库惯例：P0 阻断金路径/安全 > P1 可靠性与证据 > P2 健壮性 > P3 长期。

## P1

### D1 CORS 白名单化
- 出处：SECURITY_REVIEW P1-1
- 内容：新增 `MINDIOU_ALLOWED_ORIGINS`（逗号分隔）；白名单内回显 Origin 并保留 credentials；默认维持 `*` 兼容现状
- 验收：配置白名单后，白名单外 Origin 预检失败；不配置时行为与现状一致；现有 web/G2/Rokid 通路回归通过

### D2 生产绑定 127.0.0.1 落地确认
- 出处：SECURITY_REVIEW P1-2
- 内容：`/etc/mindiou.env` 设 `HOST=127.0.0.1`；确认云安全组只放行 80/443
- 验收：服务器上 `ss -tlnp | grep 8794` 仅见 127.0.0.1；外网直连 8794 超时；经 Nginx 通路正常
- 备注：纯配置项，【待确认】需有服务器权限的人执行

### D3 自动备份 /var/lib/mindiou
- 出处：DEPLOYMENT_RUNBOOK 第 6 节【待确认】
- 内容：systemd timer 每日打包 `/var/lib/mindiou`（含 auth-store.sqlite）到异地/对象存储，保留 14 天
- 验收：触发一次备份产物可还原；还原演练走通 RUNBOOK「恢复数据」流程

## P2

### D4 postcss 升级（npm audit fix）
- 出处：SECURITY_REVIEW P2-1（GHSA-r28c-9q8g-f849，1 high，构建期）
- 内容：依赖窗口期执行 `npm audit fix`，更新 lock
- 验收：`npm audit --omit=dev` 无 high；`npm run check && npm test && npm run build` 全过

### D5 Rokid 客户端 API 地址去硬编码
- 出处：SECURITY_REVIEW P2-2
- 内容：`platforms/rokid-aiui/config.js` 默认值改为构建期/首启可配；保留生产默认作 fallback
- 验收：不发改版即可指向新服务器；现有 node 测试更新后通过

### D6 模型调用 max_tokens
- 出处：SECURITY_REVIEW P2-3
- 内容：报告生成、答案反馈分别设 `max_tokens`（建议 4000/800 量级，按提示词实测调整）
- 验收：超长输出被截断且 JSON 解析不炸（有截断容错）；单次调用成本有上界

### D7 early-access jti 提升到 128 bit
- 出处：SECURITY_REVIEW P2-5
- 内容：server.js L1620 `randomBytes(9)` → `randomBytes(16)`
- 验收：旧 Cookie 失效策略明确（建议直接失效强制重登）；登录/登出回归通过

### D8 发布脚本入仓
- 出处：DEPLOYMENT_RUNBOOK 3.2【待确认：发布脚本不在本仓库】
- 内容：把「构建 → releases/<ts> → 切 current 软链 → restart → 验证」固化为 `scripts/release.sh`（含回滚上一软链）
- 验收：干跑模式输出将执行的命令；真实发布/回滚各演练一次并记录产物版本

## P3

### D9 模型调用一次性退避重试
- 出处：SECURITY_REVIEW P3-1
- 内容：仅连接错误时重试 1 次（指数退避），超时/4xx 不重试；保持幂等语义
- 验收：mock 首次断连第二次成功的用例通过；超时用例不放大调用次数

### D10 幂等键
- 出处：SECURITY_REVIEW P3-2
- 内容：报告生成/答案提交接受 `Idempotency-Key`，按用户+键去重
- 验收：同键重复提交返回首次结果且不重复计费

### D11 server.js 分阶段拆分（不一次性重写）
- 出处：BACKEND_ARCHITECTURE「当前混乱点」
- 阶段建议：
  1. 提取纯函数（截断/清洗/JSON 修复）到 `lib/`，行为不变，先补单测；
  2. 提取模型调用层（chat/research/stt 三个 client）到 `providers/`，统一超时/错误规约；
  3. 按域拆路由（auth / mvp0 / mvp1 / training / devices / ops）到 `routes/`，server.js 只剩组装；
  4. 每阶段独立提交，门禁全过再进下一阶段
- 验收（每阶段）：`npm run check && npm test && npm run build` 全过；API 路径与字段语义零变化；diff 不触碰认知分析/校准/评分领域逻辑
