# 运营后台部署指南

## 架构

```
用户端 web/ (#/admin)  ──→  GET /api/admin/stats  ──→  聚合 mvp0-store + spiral-store + eventLog
                          GET /api/admin/events      ──→  返回事件流
                          GET /api/mvp0/reports       ──→  兜底直连（前端也能聚合）
```

运营后台前端在 `web/src/admin.ts`，通过动态 import 加载，**不打包进用户端主 bundle**。
埋点在前端 `web/src/tracker.ts`，发到现有 `POST /api/learn/events`（无需改后端）。

## 前端部分（已完成）

- `/admin` 路由：独立鉴权（`mindiou_admin_token`），不走邀请码
- 看板：概览 / 漏斗 / 停留时长 / 报告质量 / 能力画像 / 事件流
- 埋点：`page_enter` / `page_leave` / `session_end`，发送到 `POST /api/learn/events`
- 访问：`http://localhost:5180/#/admin`

## 后端补丁（需在主仓库应用）

> ⚠️ `server.js` 是 ES module（`package.json` 里 `"type": "module"`），补丁文件已是 ESM 格式，用 `import` 引入。

### 1. 引入补丁模块

在 `server.js` 顶部其他 `import` 之后添加：

```js
import { handleAdminRoute } from './web/admin-backend-patch.js'
```

### 2. 挂载路由

在 `server.js` 的请求处理函数里，**在 `requireToken` 判断之前**插入：

```js
// 运营后台路由（独立鉴权，不走邀请码）
if (handleAdminRoute(req, res, url.pathname, req.method, {
  mvp0Store, spiralStore, eventLog, mvp1Sessions
})) return
```

其中 `mvp0Store`、`spiralStore`、`eventLog`、`mvp1Sessions` 是 server.js 已有的变量（见 server.js 第 56-66 行）。

### 3. 设置 Admin Token

```bash
# .env 或环境变量
MINDIOU_ADMIN_TOKEN=your-secret-admin-token

# 若未设置，则 fallback 到 LEARNING_API_TOKEN
```

## 埋点鉴权（重要）

前端埋点发送到 `POST /api/learn/events`。该接口在 `server.js` 中位于 `requireToken` 判断之后，会校验鉴权头。

- **已登录用户**：`tracker.ts` 用 `fetch + keepalive` 带 `Authorization: Bearer <token>` 头，埋点正常送达。
- **未登录访客（落地页）**：`tracker.ts` 降级用 `sendBeacon`（无法带鉴权头），**会被 `requireToken` 拦截，埋点丢失**。

要完整追踪落地页访客漏斗，需在 `server.js` 中将 `POST /api/learn/events` 处理移到 `requireToken` 之前（约 server.js:1692），或新增一个不鉴权的公开事件端点（如 `POST /api/public/events`，前端改指向）。此改动需在主仓库进行，不在当前 worktree 范围内。

## 验证

```bash
# 1. 启动后端（在主仓库）
cd evenhub-g2-learning && npm run api

# 2. 启动前端
cd web && npm run dev

# 3. 访问运营后台
open http://localhost:5180/#/admin

# 4. 输入 Admin Token（或 LEARNING_API_TOKEN 的值）
```

## 数据来源对照

| 看板模块 | 数据来源 | 持久化 |
|---|---|---|
| 概览 | mvp0-store + spiral-store + eventLog | 持久 |
| 漏斗 | page_enter 埋点 + drafts/reports 计数 | 埋点内存，store 持久 |
| 停留时长 | page_leave 埋点的 durationMs | 内存（需补丁落盘） |
| 报告质量 | mvp0-store clearanceReports | 持久 |
| 能力画像 | mvp0-store analysis.userCapability | 持久 |
| 事件流 | eventLog | 内存 200 条 |

## 后续增强（二期，可选）

1. **eventLog 持久化**：当前 `eventLog` 仅内存 200 条。在 `recordEvent`（server.js:1254）后追加落盘到 `tmp/admin-events.jsonl`，可解锁历史趋势。
2. **MVP-1 会话持久化**：当前 `mvp1Sessions` 是内存 Map，重启丢失。落盘到文件后可解锁清偿漏斗历史。
3. **ownerLabel 字段**：给 reports/drafts 加 owner 字段，解锁单用户维度漏斗。
4. **按天聚合**：新增 `tmp/admin-daily.json`，每天快照 stats，解锁历史趋势折线图。
