# MindIOU AI 协作类型测试 V1

日期：2026-08-04
题库版本：`MIOU-ACT-V1.0`
产品名称：AI 到底是你的副驾驶，还是代驾？

## 实现范围

- 新增公开路由 `#/assessment`，无需登录即可开始。
- 严格采用 12 道计分题结构：8 道通用核心题 + 所选身份模块的 4 道题。
- 四个身份模块：开发者与 Vibe Coder、产品经理与创业者、学生与研究者、内容创作者与通用职场用户。
- 覆盖选择、排序、100 点分配、多选风险识别、信心滑块、开放解释、直接修改与责任分类题型。
- 错误识别题与直接修改题各收集一次信心值，用两项客观表现参与校准，不把低信心直接当作能力差。
- 结构题使用确定性规则；开放题发送到后端，仅接受 0—3 的结构化维度结果和回答证据。
- AI 不可用时使用规则降级，并在结果页明确标记结果为暂定，不伪装成模型评审。
- 结果覆盖 9 种行为模式、6 个测量维度、主要优势、当前风险和具体行为证据；不提供虚构百分位。
- 测试状态保存在浏览器本地，刷新可恢复；评审请求中断后刷新会安全重试。
- 结果后的真实材料激活支持粘贴文字或代码、选中具体片段和选择理解状态，并将材料带入现有真实认知债务扫描。
- 按产品当前能力明确说明暂不支持截图上传，不承诺尚未实现的文件能力。
- Genesis 顶部和底部测试 CTA 已从错误的 `#/app` 改为正式 `#/assessment`。
- 共享页脚增加“认知债务测试”入口。
- 中英文题目、角色、结果标签、证据、可信度声明与交互文案同步实现。

## 产品边界

- 12 道题决定协作类型；真实材料激活是结果后的产品连接步骤，不作为第 13 道计分题。
- 测试不会直接授予 Genesis 身份。用户仍需完成首次真实认知债务扫描后才计入正式加入。
- 当前结果是研究启发的行为测试，不用于临床、招聘、升学或资格认证。
- 开放题采用模型结构化评审与规则 fallback；人工抽样复核属于运营验证阶段，不在自动化产品流程中伪造。

## 验收

- Web：6 个测试文件、56 项通过；类型检查和生产构建通过。
- 根工程：34 个测试文件、551 项通过；类型检查和生产构建通过。
- 后端匿名开放题评审接口在 AI 关闭时返回透明的 `rule_fallback` 和结构化评分。
- 390×844 英文手机页面：4 个身份入口全部可见，无横向溢出。
- 390×844 英文开发者模块第 1 题：6 个选项、1/12 进度和禁用态下一步按钮均正确，无横向溢出。

## 生产边界

- 2026-08-04 已按用户明确指令部署到 `http://demo.mindiou.top/mindiou/`。
- 后端已部署评估接口及最近报告/清偿会话修复，服务运行目录为 `/opt/mindiou`。
- Nginx 已增加 `/mindiou-api/api/assessment/review` 精确代理规则，并通过 `nginx -t` 后热重载。
- 公网开放题评审返回 `200`、`ok: true` 和 `mode: model_structured`；前端题库版本为 `MIOU-ACT-V1.0`。
- 公网 JS/CSS 与本地生产构建 SHA-256 完全一致；`#/assessment`、`#/genesis`、`#/workspace` 均返回 SPA 入口。
- 部署后 SQLite 仍为 WAL 模式且 `integrity_check=ok`；`mindiou-db-backup.timer` 保持 active。
- `mindiou.service` 部署后为 active，`NRestarts=0`。
- 后端回滚点：`/opt/mindiou/deploy-backups/assessment-20260804T075138Z`。
- Nginx 回滚点：`/etc/nginx/snippets/mindiou-locations.conf.backup-20260804T075310Z`。
- 静态前端回滚点：`/var/www/mindiou-backup-20260804155417`。

## 结果插画与导航避让（已部署）

- 9种结果均增加独立中文和英文结果卡，共18张WebP资源；语言切换后使用对应语言图片。
- 原始1254px PNG统一输出为900px WebP，18张合计约1.15MB；结果页使用懒加载且只请求命中的一张图。
- 图片使用结果键映射，不依赖中文标题字符串，覆盖 `autopilot`、`alchemist`、`blind`、`loop`、`auditor`、`later`、`supervisor`、`codriver`、`quantum`。
- 全站固定导航与产品页粘性页头增加桌面/手机分层距离，覆盖工作区、时间线、报告、清偿会话和设备Token页。
- 本地浏览器验证：中文和英文结果图均成功加载，900px自然宽度；390×844下无横向溢出，结果图宽354px。
- Web类型检查、56项测试和生产构建通过；根工程34个测试文件、551项测试及生产构建通过。
- 2026-08-04 已部署到 `https://demo.mindiou.top/mindiou/`，静态回滚点为 `/var/www/mindiou-backup-20260804200243`。
- 公网18张图片全部返回200并与本地构建逐字节一致；线上JS/CSS SHA-256与本地构建一致。
- 部署脚本默认公网验收地址由HTTP改为HTTPS，避免站点301强制跳转被误报为部署失败。

## V1.1 分类与题库修复（本地完成，尚未部署）

- 根因：V1.0 将“AI 项目监工”作为未命中其他阈值时的默认结果，且部分角色结构题没有进入计分，导致分类明显偏向单一类型。
- 题库升级为 `MIOU-ACT-V1.1`，本地答题状态使用新存储键，避免旧答案污染新版结果。
- 九种结果改为九套正向匹配分；最高分决定主要类型，同时展示次接近类型和根据分差、答题覆盖率计算的“结果稳定度”。
- 四个身份仍分别使用 8 道公共题 + 4 道身份题；身份模块保持隔离，不会向研究者展示开发题或向开发者展示产品题。
- 公共题移除 SaaS、代码上线和重试算法等职业偏向，改为跨职业的 AI 成果核验、独立来源与外部承诺场景。
- 开发、产品、创作者模块的多选、排序、分类题均接入确定性答案矩阵，不再只依赖开放题关键词。
- 开放题请求现在包含题目、上下文、语言和 0—3 分 rubric；模型异常时返回规则降级结果，不阻断出结果。
- 新增回归覆盖：明显代驾、无限追问、均衡共驾不再落入“AI 项目监工”兜底；结果包含九种匹配分和有界稳定度。
- 验证：根工程 551 项测试、Web 58 项测试全部通过；两处类型检查和生产构建全部通过。
- 发布状态：2026-08-04 经用户明确授权部署到生产环境；本地变更仍未提交、未合并主分支。
- 公网 SPA 为 `index-BOO1vuew.js`，包含 `MIOU-ACT-V1.1`、新版状态键和结果稳定度；公网文件与本地构建 SHA-256 一致。
- 公网开放题接口使用包含题干、上下文和 rubric 的 V1.1 请求验证，返回 `200`、`ok: true` 和 `mode: model_structured`。
- `mindiou.service` 为 active、`NRestarts=0`；两份 SQLite 数据库均为 WAL 模式且 `integrity_check=ok`；每日备份 timer 为 active。
- 后端回滚点：`/opt/mindiou/deploy-backups/assessment-v1.1-20260804T232716`。
- 静态前端回滚点：`/var/www/mindiou-backup-20260804232808`。

## 结果插画加载修复（2026-08-05，已部署）

- 生产资源检查确认 18 张中英文 WebP 均存在并返回 200；问题集中在结果页保留末题滚动位置、图片使用懒加载且 URL 无版本标识时可能不发起加载或继续使用旧缓存。
- 进入结果页时强制回到顶部；结果图改为 `loading=eager` 和高优先级加载，资源 URL 增加 `MIOU-ACT-V1.1` 版本参数。
- 首次图片请求失败会自动增加重试参数再次加载；再次失败时显示明确错误提示，不再留下无说明的空白区域。
- 新增结果图片 DOM 回归测试；Web 59 项测试、类型检查和生产构建通过。
- 已部署公网包 `index-BFK4xxn0.js` 与 `index-MqnnkvCF.css`，二者分别与本地构建 SHA-256 一致；18 个版本化图片 URL 全部验证为 200。
- 本次只更新静态前端，Node 服务未重启且 `NRestarts=0`；静态回滚点为 `/var/www/mindiou-backup-20260805020413`。

## 结果插画第二次线上修复（2026-08-05，已恢复正确入口）

- 复查发现线上 `index.html` 曾被另一份静态发布覆盖，指向 `index-DkngHj1u.js`；该包包含 assessment 文本但没有 `assessment-results`、WebP 或图片加载逻辑，因此移动端和桌面端都会看不到图。
- 已从已验证的 `web/dist` SPA 产物重新同步，不动后端、数据库和旧页面；当前公网 `index.html` 明确指向 `index-BFK4xxn0.js` 与 `index-MqnnkvCF.css`。
- 公网 JS SHA-256 与本地已验证构建一致：`a2c52b27a44845d2eb0b4d8445de249c4743e07a6e40e228a57a1510052750b1`；公网 JS 已确认包含 `assessment-results` 和 `fetchPriority`。
- 公网版本化结果图请求返回 200；`mindiou.service` 仍为 active、`NRestarts=0`。
- 此次本地重新构建被并行未完成的 `projectMemory.ts` 路由改动阻断（`"projects"` 尚未加入路由类型）；为避免覆盖该未完成工作，部署使用此前已通过 59 项 Web 测试、类型检查和构建的 `web/dist` 产物。
- 新静态回滚点：`/var/www/mindiou-backup-image-fix-20260805T024354`。

## 题库 V1.2 扩充（2026-08-05，已部署）

- 公共题由 8 道扩充为 12 道，身份题仍为每个身份 4 道，总题数由 12 道变为 16 道。
- 新增公共行为覆盖：AI 起草与人类最终判断边界、无法解释的结论如何用独立材料重建、交付后如何复盘与迁移、真实工作中的数据/复核/失败回滚/责任边界。
- 新增题目均提供中英文文案；多选、排序、选择题均接入确定性计分，开放题沿用题目上下文和 0—3 分 rubric。

## 按用户要求回滚 V1.2（2026-08-05）

- 用户反馈 V1.2 误改变主页页面、宣传活动内容和结果页后半段，要求先回滚，再以最小改动保留原图片问题修复。
- 生产静态目录已精确恢复到 V1.1 图片修复版本：`/var/www/mindiou-backup-assessment-v12-20260805T025751`。
- 当前公网入口为 `index-BFK4xxn0.js` / `index-MqnnkvCF.css`，包含 `MIOU-ACT-V1.1`、原 9 张结果图映射、eager 图片加载和失败重试；不包含 V1.2 的 `core-12`/16 题扩充。
- V1.2 当前线上目录已整体保留在 `/var/www/mindiou-after-v12-before-rollback-20260805T030032`，可恢复，不影响数据。
- 公网入口、9 张中文结果图、健康接口均已验证；Node 服务未重启，`mindiou.service` active、`NRestarts=0`。
- 评分覆盖新增 `core-9`、`core-11`、`core-12`；结果稳定度覆盖率分母同步由 12 调整为 16。
- 测试版本升级为 `MIOU-ACT-V1.2`，浏览器状态键升级为 `mindiou_ai_collaboration_test_v1_2`，避免 V1.1 未完成答案直接进入 V1.2 结果。
- 首屏测试时长由 5—7 分钟更新为 7—10 分钟，题数说明更新为 16 题。
- Web 测试 59 项通过；Vite 生产构建通过，产物包含 `MIOU-ACT-V1.2`、`core-12` 和结果图片加载逻辑。
- 因并行未完成的 `projectMemory.ts` 改动尚未加入 `projects` 路由类型，完整 `tsc` 检查当前仍会报该独立错误；本次部署使用已通过 Web 测试、经 Vite 构建验证的 SPA 产物，未修改或覆盖那组并行源文件。
- 公网入口已切换至 `index-C1a7WKZ8.js` / `index-Db9HixoU.css`；公网 JS 与本地 Vite 产物 SHA-256 一致，9 张中文结果图均返回 200。
- Node 服务未重启，`mindiou.service` active、`NRestarts=0`；静态回滚点：`/var/www/mindiou-backup-assessment-v12-20260805T025751`。

## 公网再次回滚到用户指定版本（2026-08-05）

- 复查发现公网曾被后续 `index-Bc5NXxWX.js` 构建覆盖，导致上一条回滚记录与用户实际看到的版本不一致。
- 已将公网完整静态目录切回用户指定的 V1.1 图片修复快照 `/var/www/mindiou-backup-assessment-v12-20260805T025751`，不是只替换单个入口文件。
- 当前公网入口为 `index-BFK4xxn0.js` / `index-MqnnkvCF.css`，包含主页、`#/genesis` 001 期档案内容、原结果页后半段、`MIOU-ACT-V1.1`、`assessment-results`、`fetchPriority` 和 9 种结果类型的中英文图片映射。
- 当前 9 种结果类型的 18 个 WebP 资源（中文/英文）均返回 200；`/mindiou-api/api/genesis` 返回正常数据；`mindiou.service` active、`NRestarts=0`。
- 回滚前的后续构建完整保留在 `/var/www/mindiou-before-v11-rollback-20260804T194956Z`，没有删除；当前静态切换不涉及 Node 服务或 SQLite 数据。
- 本地 Web 59 项测试、TypeScript 检查和 Vite 构建通过；未强制回退并行的 Project Memory 源码改动。

## 开放题模型评审代理修复（2026-08-05）

- 根因：回滚后的 Nginx 配置缺少精确的 `/mindiou-api/api/assessment/review` location，公网请求被 `/mindiou-api/` 404 catch-all 拦截；前端因此总是降级为规则评审。
- 已在本地部署配置和生产 Nginx 配置中补充精确代理：限制 AI 限流、128KB 请求体、120 秒上游超时，并转发到 `127.0.0.1:8794/api/assessment/review`。
- `nginx -t` 通过并已热重载；Node 服务未重启，`mindiou.service` active、`NRestarts=0`。
- 使用最小开放题请求做公网验收：`POST /mindiou-api/api/assessment/review` 返回 HTTP 200，响应 `mode: model_structured`，包含模型生成的 evidence 和 reason；当前生产模型为 DeepSeek `deepseek-v4-flash`。
- 生产原配置已保留：`/etc/nginx/snippets/mindiou-locations.conf.backup-assessment-proxy-20260805T063137Z`。
