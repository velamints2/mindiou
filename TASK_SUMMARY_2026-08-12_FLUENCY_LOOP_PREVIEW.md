# Fluency Loop 前端预告任务总结

日期：2026-08-12  
分支：`codex/mindiou-cognitive-loop`

## 本轮交付

- 在现有 `#/cognitive-loop` 页面顶部加入 Fluency Loop 产品预告层，保留原有真实活动导入和 Loop 结果功能。
- 新增公开路由 `#/fluency-loop-preview`，未登录用户可以直接查看功能更新预告；真实数据入口仍然受原有账户鉴权保护。
- 按产品框架实现以下界面模块：
  - Fluency Loop hero 与 Personal AI Harness 视觉入口；
  - Your Loop is running 与 Last Loop 指标；
  - Delegation / Description / Discernment / Diligence 四维 AI Fluency；
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

## 验收

- Web 类型检查通过：`npm run check`。
- Web 测试通过：11 个测试文件、83 个测试。
- Web 构建通过：`npm run build`。
- Cognitive Loop 后端单测通过：2 个测试文件、6 个测试。
- 根目录全量测试通过：48 个测试文件、703 个测试；第一次在沙箱内运行时仅因服务测试监听 `127.0.0.1` 被 `EPERM` 拦截，使用受限外测试权限复跑后全绿。
- 路由回归覆盖：公开预告路由解析、公开鉴权判定、导航跳转。
- 浏览器视觉检查通过：中文/英文切换、桌面首屏和 390×844 移动端；确认顶部 hero、研究卡片、信息卡片、移动端收拢和 CTA 跳转均可用。
- 临时本地 Web/API 服务已停止；未部署生产。

## 边界

- 这是前端功能更新预告，不改变 Cognitive Loop 后端 schema、评分算法或真实数据来源。
- 预告页使用静态演示数据；`#/cognitive-loop` 下方仍是上一轮已实现的真实活动导入、持久化和反馈闭环。
