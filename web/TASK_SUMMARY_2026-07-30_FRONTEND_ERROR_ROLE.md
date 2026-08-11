# MindIOU 新服务器前端错误与角色预设修复总结

> **服务器状态：** `114.67.169.78` 已弃用，本文中的地址仅作历史记录；当前公网入口为 `https://demo.mindiou.top`。

日期：2026-07-30

## 任务范围

1. 修复清偿会话创建失败时直接显示 nginx 503 HTML、重复点击后重复堆叠错误的问题。
2. 修复报告生成提示词默认把用户当作产品经理、创业者或产品负责人的问题。

未修改账户鉴权、旧版 MVP-1 页面或数据兼容逻辑。

## 实现结果

- `web/src/api.ts`
  - 非 JSON 错误响应不再作为用户可见文案。
  - 502/503/504 统一显示“服务暂时不可用，请稍后重试”。
  - 仍保留应用服务器返回的结构化 JSON 错误。
- `web/src/pages.ts`
  - 每张卡片最多显示一个会话创建错误。
  - 重试前清除旧错误，失败后按钮恢复可用。
  - 错误节点增加 `role="alert"`。
- `mvp0-report.js`
  - 三段报告提示词不再默认用户职业、行业、职责或技术背景。
  - 只有材料提供明确证据时才能使用具体身份；证据不足时统一称为“用户”。
  - 卡片难度和任务形式根据材料证据决定，不再默认要求或禁止写代码。
- `mvp1-public-web.js`
  - 新增无需 OpenAI 地区出口的实时公开网页搜索适配器。
  - 使用 HTML 解析器提取搜索结果的真实目标 URL、标题和摘要，拒绝空结果。
  - 搜索证据继续交给现有 DeepSeek 结构化，最终会话标记为 `live_ai`。
- `server.js`
  - 支持 `RESEARCH_PROVIDER=public_web`。
  - MVP-0 有界研究和 MVP-1 清偿研究共用该实时搜索适配器。
  - 保留原 OpenAI web search 路径，未来具备受支持出口时可切回。

## 自动化验收

- Web 专项：10/10 通过。
- 报告提示词专项：67/67 通过。
- Web 全量：32/32 通过；check、build 通过。
- 实时公开搜索适配器专项：3/3 通过。
- 主项目全量：486/486 通过；check、build 通过。
- `git diff --check` 通过。

`npm run test:mvp1` 的历史评估脚本仍只发送 Bearer token，而当前 Web
MVP-0/MVP-1 路由要求账户 Cookie；注入临时测试 Cookie 后，全量样本又因
需要实时外部研究而不能在禁用 AI 的环境完成。该脚本限制与本次变更无关，
未通过调用真实模型规避。

## 固定样本与浏览器验收

- `scripts/capture-demo-evidence.sh`：通过。
- 固定服务器事故样本完成注册、时间线、报告、创建会话、两次回答和结束结算。
- 研究模式：`curated_demo_fallback`。
- 最终状态：`needs_verification`。
- 390x844 移动端：
  - nginx 503 连续触发两次后，页面始终只有一个错误节点。
  - 可见文案为“服务暂时不可用，请稍后重试”。
  - 页面不包含原始 `<html>`、`nginx` 或英文 503 正文。
  - 刷新后错误节点不残留，再次点击可正常显示单条错误。

## 部署状态

已部署到 `demo.mindiou.top` 当前解析的新服务器 `156.225.23.88`。

- 部署时间戳：`20260730T131737Z`
- Web 目录：`/var/www/mindiou`
- 后端提示词文件：`/opt/mindiou/mvp0-report.js`
- 备份目录：`/opt/mindiou/deploy-backups/20260730T131737Z`
- 上一版 Web：`/var/www/mindiou-previous-20260730T131737Z`
- 后端服务：`mindiou.service`，部署后为 `active`
- 新服务器实际后端端口：`8794`
- 公网健康检查：`/mindiou-api/health` 返回 200
- 公网 Web 使用新构建资源 `index-DCpNurmD.js`、`index-C2HIFDG3.css`
- 公网 bundle 包含短中文 503 文案，不包含原始 nginx 503 HTML
- 服务器端提示词身份中立断言通过
- 390x844 公网移动端首屏与登录入口验收通过

### 第一层研究故障

旧服务器 `114.67.169.78` 与新服务器最初配置相同：

- `RESEARCH_PROVIDER=disabled`
- `RESEARCH_API_KEY` 为空
- 只有固定服务器诊断样本能进入 `curated_demo_fallback`

因此旧服务器没有可迁移的实时研究实现。原故障链为：

1. 非固定题创建会话时，后端返回 502 JSON：
   `Live web research is not configured for provider: deepseek`。
2. 用户连续重试触发 nginx `mindiou_ai` 限流，nginx 返回 503 HTML。
3. 旧前端把 HTML 当错误文案直接显示并重复追加。

尝试启用服务器已有 OpenAI 密钥后，新服务器从 OpenAI 收到
`403 unsupported_country_region_territory`；旧服务器则直接网络请求失败。
两台服务器也都没有可复用的代理或其他搜索服务密钥。

最终部署 `public_web` 适配器，使用新服务器可访问的公开搜索结果作为真实
来源，再由现有 DeepSeek 完成结构化。部署信息：

- 后端部署时间戳：`20260730T141528Z`
- 后端备份：`/opt/mindiou/deploy-backups/20260730T141528Z`
- 环境配置备份：`/etc/mindiou.env.backup-20260730T141148Z`
- 当前配置：`RESEARCH_PROVIDER=public_web`
- 服务状态：`active`，`NRestarts=0`
- 公网首页与健康检查均返回 200

非固定法学院学生样本验收：

- 报告创建 200
- 清偿会话创建 200
- `researchMode=live_ai`
- 返回 5 个有效 HTTP 来源
- 报告中“产品经理”出现 0 次
- nginx 日志中没有新增 503

公开搜索能证明来源是实时 URL，但搜索排序本身不保证来源权威性。后续质量门
应增加可信域名排序和页面正文抓取，不应把当前结果描述为“已验证的权威来源”。

回滚研究后端：

```bash
cp -a /opt/mindiou/deploy-backups/20260730T141528Z/server.js /opt/mindiou/server.js
cp -a /opt/mindiou/deploy-backups/20260730T141528Z/package.json /opt/mindiou/package.json
cp -a /opt/mindiou/deploy-backups/20260730T141528Z/package-lock.json /opt/mindiou/package-lock.json
cp -a /etc/mindiou.env.backup-20260730T141148Z /etc/mindiou.env
cd /opt/mindiou
npm install --omit=dev --ignore-scripts
systemctl restart mindiou.service
```

当前新服务器只开放 HTTP 80，HTTPS 443 仍拒绝连接；本次部署未修改 TLS
或 Nginx 监听配置。
