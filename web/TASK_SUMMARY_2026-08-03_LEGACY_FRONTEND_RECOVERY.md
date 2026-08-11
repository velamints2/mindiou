# 2026-08-03 旧前端恢复任务总结

> **服务器状态：** `114.67.169.78` 已弃用，本文中的地址仅作历史记录；当前公网入口为 `https://demo.mindiou.top`。

## 问题

2026-07-29 的前端部署脚本会清空 `/var/www/mindiou/`，之后只部署
`web/dist/` SPA，再从服务器上的根 `dist/` 选择性复制 `mvp1` 和
`training` 产物。根项目旧前端中的 Learn Coach 五标签主界面、
`report.html` 和 `desktop.html` 没有被恢复到服务器。

## 修复

- `scripts/deploy-web.sh` 现在同时构建并打包根 `dist/` 和 `web/dist/`。
- 旧 Learn Coach 主界面以 `/mindiou/legacy.html` 恢复，避免覆盖现有 SPA 主入口。
- 恢复 `/mindiou/report.html`、`/mindiou/desktop.html`、`/mindiou/mvp1.html`
  和 `/mindiou/training.html` 及其完整的 hash 资源。
- 远程目录仍在清空前创建带时间戳的完整回滚备份。
- SPA bundle 验证改为直接读取 `index.html`，不再被 `/mindiou/` 的 302 影响。

## 当前验证

- Web SPA: `npm run check` 通过；4 个测试文件 / 42 项测试通过；build 通过。
- 根项目: `npm run check` 通过；31 个测试文件 / 532 项测试通过；build 通过。
- 公网入口 `index.html`、`legacy.html`、`report.html`、`desktop.html`、
  `mvp1.html` 和 `training.html` 均返回 HTTP 200。
- 旧入口引用的 `main-sQMHt6RH.js`、`report-COTAMELp.js` 和
  `desktop-Q_2MUQvP.js` 已在公网 HTML 中确认。
- 新 SPA bundle `index-Cwe1WAFn.js` 保留 training 路由。
- 恢复前服务器快照：`/var/www/mindiou-backup-20260803072251`。

## 范围边界

本次只恢复和共存前端构建产物；没有修改 API key、后端数据、
Nginx 配置、Git 分支，也没有合并或推送代码。

## 用户纠正后的真正问题

用户指出丢失的不是 Learn Coach，而是
`http://demo.mindiou.top/mindiou/#` 的完整 MindIOU 落地页内容。进一步取证确认：

- 完整落地页仍在嵌套仓库 `stash@{0}` 中，可以精确恢复。
- 丢失区块包括研究数据与边界、认知债务定义、知识盲区对比、
  七部分报告、碎片时间清偿流程和完整 CTA。
- 只合并了 `web/src/marketing.ts` 和对应 `web/src/styles.css` 增量；
  没有整体应用 stash，也没有回退训练、复训、账户、后台或 API 功能。
- 真实域名解析到 `156.225.23.88`；原部署脚本默认的 `114.67.169.78`
  是另一台旧服务器，不是此次的最终验收目标。

## 落地页恢复验收

- 正确源站回滚快照：`/var/www/mindiou-backup-20260803075531`。
- `demo.mindiou.top` 已切换到 `index-D7vOEjJ8.js` 和 `index-Ba1HM8uu.css`。
- 公网 bundle 已逐项确认上述五类恢复文案。
- 公网 bundle 仍包含 `training-debt` 和 `repayment` 新功能路由。
- Web 42/42 测试通过；主项目 532/532 测试通过；两者 build 通过。
- `demo.mindiou.top/mindiou/`、新 JS/CSS、health 和 repayment status 均返回 HTTP 200。

## 共享中英文版与登录首页（2026-08-03）

### 已实现

- 同一站点增加固定 `中文 / English` 切换；`?lang=en` 是可分享英文入口，选择写入浏览器并在刷新、路由切换及移除查询参数后保持。
- 英文范围覆盖落地页、注册/登录、工作区、时间线、报告、清偿会话、复训、认知清偿、设备 Token，以及面向用户的错误和降级提示；后台保持原范围，不纳入本次英文版。
- 新建 draft、report、session 持久化创建语言。英文模式的新 AI 请求显式携带 `outputLanguage: English`；分析、卡片、研究整理、反馈、追问和结束建议使用英文，原始输入与证据引用保留原文。
- 切换界面语言不会改写历史报告或会话。
- `#/app` 改为登录后的 Dashboard，并保留“开始新的分析”主入口。Dashboard 从持久化 store 聚合：报告总数、最近报告、尚未清偿欠条、最近会话、可继续会话。
- 新增受账户鉴权和所有权隔离保护的 `GET /api/dashboard`；生产 Nginx 仅为该端点增加精确代理规则。

### 验收结果

- 本地英文落地页 DOM 检查：除语言切换控件中的“中文”外无中文残留。
- 本地注册后 Dashboard 检查：六类核心信息全部显示；英文选择在移除 `?lang=en` 并刷新后仍保持。
- Web：4 个测试文件 / 43 项测试通过，类型检查和生产构建通过。
- 根项目：32 个测试文件 / 534 项测试通过，类型检查和生产构建通过。
- 公网静态入口、旧入口与 health 返回 HTTP 200；匿名访问公网 Dashboard 返回 HTTP 401，证明代理已到达受保护接口而非静态 404。
- 公网 SPA bundle：`index-JrXsJrYW.js`；CSS：`index-H8tD-8WL.css`。

### 发布与回滚

- 静态目录发布前快照：`/var/www/mindiou-backup-20260803203926`。
- 后端文件发布前快照：`/opt/mindiou/deploy-backups/english-dashboard-20260803123829`。
- Nginx 规则快照：`/etc/nginx/snippets/mindiou-locations.conf.backup-20260803124137`。
- 首次后端复制暴露出生产目录缺少五个训练模块；服务日志明确报 `training-store.js` 缺失。已先恢复旧后端使 health 恢复，再补齐完整依赖集、通过语法检查并重启，最终服务在 `127.0.0.1:8794` 正常运行。
