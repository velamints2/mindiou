# 2026-08-03 旧前端恢复任务总结

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
