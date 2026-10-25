# Fluency Loop 前端预告任务总结

日期：2026-08-12  
分支：`codex/mindiou-cognitive-loop`

## 本轮交付

- 在现有 `#/cognitive-loop` 页面顶部加入 Fluency Loop 产品预告层，保留原有真实活动导入和 Loop 结果功能。
- 新增公开路由 `#/fluency-loop-preview`，未登录用户可以直接查看功能更新预告；真实数据入口仍然受原有账户鉴权保护。
- 按产品框架实现以下界面模块：
  - Fluency Loop hero 与 Personal AI Harness 视觉入口；
  - Your Loop is running 与 Last Loop 指标；
  - 领域能力与 AI 协作能力分开的双区域预告；
  - 问题建模、任务拆解、上下文、验证、多轮协作、工作流、AI 边界认知七维 AI Fluency；
  - Your Fluency Gap：AI User → AI Delegator；
  - Your Next Experiment：Goal / Context / Constraints / Acceptance Criteria；
  - Personal AI Harness 六层结构；
  - Capability Awareness 与两条 Capability Shift；
  - Information Diet 与被过滤的信息；
  - Always Learning 与 Observe → Loop Again 循环；
  - 公开预告页的 CTA 跳转到登录入口。
- 预告中的数字、判断和能力变化均标记为界面样例，不冒充当前用户真实数据或真实内容平台数据。
- 修正本地开发 API 覆盖优先级：`?api=...` 优先于 `/mindiou-api` 生产路径，默认生产路径不变。

## 本次补充：国际化与评估依据

- 补齐预告页和真实 Loop 页的 locale 渲染：中文和英文不再只依赖页面加载后的通用替换，而是由页面组件直接按当前语言生成文案。
- 中文版已把 `Delegation / Description / Discernment / Diligence`、`Prompt / Context / Harness`、`Feature Preview`、`Start Experiment` 等混用英文改为中文；保留 `AI`、`MindIOU`、`NBER`、`METR` 等品牌或研究机构名称。
- 新增“评估依据”区域，展示 5 篇一手研究及其对 MindIOU 评估设计的支持关系，并明确自我报告、受控实验、单一职业样本等证据边界。
- 新增仓库文档 [`docs/research/AI_COLLABORATION_EVALUATION_EVIDENCE.md`](docs/research/AI_COLLABORATION_EVALUATION_EVIDENCE.md)，把外部研究映射到问题建模、上下文、委派、验证、专业能力并轨等产品原则。
- 新增前端 locale 回归测试，确保中文预告不出现 English-only 标签，英文预告能显示对应英文研究区和能力维度。

## 本次补充：领域能力与 AI 协作能力并轨

- 预告页新增“两条并行能力线”：左侧是专业领域掌握度及知识、训练、解释、迁移、真实工作验证路径；右侧是七个 AI 协作行为维度及行为实验、委派、验证、上下文、工作流升级路径。
- 真实 `#/cognitive-loop` 结果页也按同一结构展示领域能力、AI 协作画像和最多三项统一干预。

## 本次补充：预告页卡片排版

- AI 协作能力画像从桌面四列调整为三列，研究依据从五列调整为三列，减少窄长竖条并增加内容呼吸空间。
- 能力卡片顶部改为“名称 + 固定分数列”的网格布局，英文维度名称不会再挤出分数；560px 及以下改为单列，优先保证长英文可读性。
- 页面级检查确认 1600px 桌面视口下 7 个英文分数均完整显示、无横向溢出；560px 小屏下同样无分数溢出。

## 本次补充：Landing 入口与生产发布

- Landing 页顶栏左侧在 MindIOU 品牌旁新增紫色 `AI 协作循环预告` 入口，直接跳转到公开 `#/fluency-loop-preview`；英文环境显示为 `Fluency Loop preview`。
- 新增入口渲染与中英文文案测试；入口使用现有公开路由，不改变登录 CTA、导航或后端鉴权。
- Web 前端和旧入口均重新完成构建后，已按 `scripts/deploy-web.sh` 发布到 `demo.mindiou.top`，Node 服务未重启，数据库未触碰。
- 发布前静态备份：`/var/www/mindiou-backup-20260812071556`，目录属主为 `mindiou:mindiou`，可用于回滚。
- 公网 `index.html` 已引用本次构建的 `index-MiOaXMZm.js` 与 `index-PoH9yNMn.css`；线上 bundle 已包含 `AI 协作循环预告`、`fluency-loop-preview` 和 `site-fluency-entry`。
- `/mindiou/` → `/mindiou/index.html` 返回 302；`index.html`、引用的 JS/CSS、`index.html#/fluency-loop-preview` 返回 200；`/mindiou-api/health` 返回 200。
- 发现并修正发布脚本的旧探针：训练接口当前要求登录，未登录的 `/api/training/today` 与 `/api/training/debts` 正确返回 401，不应被发布脚本当作失败。

## 验收

- Web 类型检查通过：`npm run check`。
- Web 测试通过：11 个测试文件、83 个测试。
- Web 构建通过：`npm run build`。
- Cognitive Loop 后端单测通过：2 个测试文件、6 个测试。
- 根目录全量测试通过：48 个测试文件、703 个测试；第一次在沙箱内运行时仅因服务测试监听 `127.0.0.1` 被 `EPERM` 拦截，使用受限外测试权限复跑后全绿。
- 路由回归覆盖：公开预告路由解析、公开鉴权判定、导航跳转。
- 浏览器视觉检查通过：中文/英文切换、桌面首屏和 390×844 移动端；确认顶部 hero、研究卡片、信息卡片、移动端收拢和 CTA 跳转均可用。
- 本次排版回归通过：1600px 下英文能力卡片三列、中文研究依据三列；560px 下能力卡片单列，分数均在卡片边界内。
- 本次生产发布核验通过：Landing 入口、预告静态路由、线上 bundle、静态资源、回滚备份和 API health 均已核验。
- 本次仅部署静态前端，未重启 Node 服务，未触碰数据库；本地临时服务状态不作为生产验收依据。

## 边界

- 这是前端功能更新预告，不改变 Cognitive Loop 后端 schema、评分算法或真实数据来源。
- 预告页使用静态演示数据；`#/cognitive-loop` 下方仍是上一轮已实现的真实活动导入、持久化和反馈闭环。

## 本次补充：从评估页改为后台认知助理叙事

- 预告页收敛为 6 个主段落：它是什么、后台循环、认知画像与认知欠条、替你阅读外部世界、为什么推荐与下一步、持续更新。
- 首屏从“AI 协作能力评分”改为 `MindIOU Loop`：一个一直在后台工作的认知助理；首屏直接给出“我现在会什么 / 我还有哪些认知欠条 / 最近有什么真正值得我看”三个结果。
- 原先连续展示的 7 个 AI 协作评分卡、Personal AI Harness 六层理论、两张能力变化卡和信息饮食图表不再作为预告页主内容；能力评分降为认知画像中的后台信息。
- 认知画像现在并列展示专业能力、正在形成的能力、AI 协作能力、认知欠条、最近高频主题和当前项目目标，并用一段“Loop 最近对你的理解”替代诊断式分数墙。
- 新增独立的认知欠条区域，使用长期 Agent、循环采购商业价值和英语 trade-off 三个示例说明 Loop 如何按当前工作重新排序待补理解。
- 新增“替你读外部世界”区域，明确展示文章/帖子、视频、产品更新和研究资料的读取、去重、无关过滤、新闻价值过滤和低信息密度过滤；同时说明视频会读取字幕、语音和关键画面。
- 新增“为什么把它给你？”推荐卡，将外部能力变化、用户最近 7 天的 11 次逐步骤监督行为和本周一次低风险完整委派实验连成可行动建议。
- 删除“你的问题已经不是提示词”等攻击式表达，统一改为“我整理了最近情况，这里有一个可能对你有帮助的发现”的认知助理口吻。
- 更新中英文回归测试：确认六段结构、三项首屏结果、认知欠条、外部阅读、推荐理由与持续学习文案存在，并确认旧评分卡不再渲染。

## 本次验收

- `cd web && npm run check` 通过。
- `cd web && npm test` 通过：11 个测试文件、85 个测试。
- `cd web && npm run build` 通过。
- `git diff --check` 通过。
- 在六段式重构的本地验收阶段只更新了前端页面与任务记录；当时线上版本尚未包含本次叙事重构，后续发布记录见下节。

## 本次发布

- 已将当前分支的六段式认知助理预告页发布到 `https://demo.mindiou.top/mindiou/#/fluency-loop-preview`。
- 发布前重新完成 Web 85/85 测试、根目录 708/708 测试，以及两套前端构建。
- 发布脚本改用 SCP 传统协议完成构建包上传，避免服务器端 SFTP 握手卡住；未重启 Node 服务，未触碰数据库。
- 发布后的线上入口与资源核验通过：`/mindiou/index.html` 200、`legacy.html` 200、`desktop.html` 200、`mvp1.html` 200、`training.html` 200、`report.html` 302。
- 线上 bundle `index-b8JNQWb8.js` 已确认包含：`MindIOU Loop`、后台认知助理文案、认知欠条文案、外部阅读文案和 `site-fluency-entry` Landing 入口。
- `/mindiou/index.html#/fluency-loop-preview` 返回 200，`/mindiou-api/health` 返回 200；未登录训练接口继续正确返回 401。
- 本次发布前备份：`/var/www/mindiou-backup-20260812075936`，属主 `mindiou:mindiou`。
- 回滚方法：`ssh root@156.225.23.88 'rm -rf /var/www/mindiou && cp -a /var/www/mindiou-backup-20260812075936 /var/www/mindiou'`。
