# MindIOU 用户端 Web 设计交接文档

> 本文档面向接手视觉与交互设计的工程师/设计师 agent。
> 功能闭环、落地页、原理页与 API 已实现并构建通过，本文档说明"设计需要做什么"。

---

## 1. 项目背景

MindIOU 是一个 AI 认知债务清算系统：用户粘贴一段 AI 辅助完成的工作材料 → 系统生成认知债务报告 → 用户选择一笔"欠条"（费曼卡）→ 用自己的话解释 → AI 给出反馈与追问 → 得到谨慎的清偿状态和下一步行动。

**已完成的面向用户的 Web 端**位于 `evenhub-g2-learning/web/`，包含：
- 公开营销区（落地首页 + 产品原理页）
- 产品核心闭环（输入材料 → 报告 → 清偿会话 → 结果）
- 邀请码门禁

视觉层是占位样式，需要重新设计。

### 设计目标
- 把一个"内部测试工具"改造成"面向原始用户的产品入口"
- 用户打开就能用，无需配置任何东西
- 体现产品调性：严肃、可信、克制（不是花哨的营销页，是学习工具）

---

## 2. 技术栈与约束

| 项 | 说明 |
|---|---|
| 框架 | 原生 TypeScript + Vite，无 React/Vue |
| 样式 | 单文件 `web/src/styles.css`，纯 CSS |
| DOM | 命令式渲染（`document.createElement`），类名即设计契约 |
| 入口 | `web/index.html` → `web/src/app.ts` |
| 构建 | `cd web && npm run build`（产物在 `web/dist/`） |
| 预览 | `cd web && npm run dev` → http://localhost:5180 |

**设计约束（必须遵守）：**
- **不要改 `pages.ts` / `marketing.ts` 里的 className**，这些类名是结构契约。只改 `styles.css`。
- 如需新增结构节点，在对应 ts 文件里加，并保持语义化命名。
- 单文件 CSS，不引入 CSS 框架或预处理器。
- 响应式：移动端 + 桌面端都要可用。
- 不要在客户端暴露任何 API key / token 字面量。

---

## 3. 路由与页面总览

```
公开区（无需登录）：
  /                 落地首页
  /how-it-works     产品原理页

产品区（需邀请码）：
  /login            邀请码登录
  /app              输入材料（三段式·第一段）
  /timeline/:draftId   时间线与困惑标注（三段式·第二段）★ 新增
  /report/:id       认知债务报告（三段式·第三段）
  /session/:id      清偿会话
  /not-found        404
```

**三段式报告流程（核心架构）：**
```
1 输入材料 (/app) → POST /api/mvp0/timelines → 跳 /timeline/:draftId
2 时间线与困惑 (/timeline/:draftId) → 用户标注困惑 → PATCH /api/mvp0/drafts/:id + POST /api/mvp0/report → 跳 /report/:id
3 认知债务报告 (/report/:id) → 六部分 + 困惑处理回执 + 选卡 → 清偿会话
```
报告页新增"你的困惑如何被处理"区块（`.confusion-resolutions`），回显每条用户困惑是归入缺口还是不构成能力缺口。
产品页顶部有三步进度指示（`.step-indicator`），让用户知道当前在第三步。

**鉴权逻辑：** 已登录用户访问 `/` 时 CTA 显示"进入工作区"（不自动跳转，保留落地页可见性）；未登录用户访问产品区自动跳 `/login`。

---

## 4. 营销页设计要点

### 4.1 落地首页 `/`
**文件：** `web/src/marketing.ts` → `renderLandingPage()`

**页面结构：**
1. 公共顶栏（`.site-header`）：logo + 导航（首页/原理）+ CTA
2. Hero 区（`.landing-hero`）：主标题 + 副标题 + 双 CTA
3. 痛点区（`.pains`）：3 张 `.pain-card`
4. 工作原理缩影（`.how-overview`）：3 个 `.how-step`
5. 底部 CTA（`.bottom-cta`）
6. 页脚（`.site-footer`）

**关键文案（请勿改动口径）：**

| 元素 | className | 文案 |
|---|---|---|
| Hero 主标题 | `.hero-title` | 把 AI 帮你跳过的理解，变成真实的能力 |
| Hero 副标题 | `.hero-subtitle` | MindIOU 识别 AI 代劳的认知工作，生成一份「认知债务报告」，再用费曼式清偿帮你真正掌握——而不是让理解停留在 AI 那一侧。 |
| 痛点1标题 | `.pain-title` | 你交付了方案，但能复述出推理过程吗？ |
| 痛点2标题 | `.pain-title` | 你跳过的每个理解，都是一笔会到期的欠条 |
| 痛点3标题 | `.pain-title` | AI 给了答案，但你没法验证它对不对 |
| 步骤3标题 | `.step-title` | 费曼式清偿 |
| 底部 CTA | `.cta-heading` | 别让理解停留在 AI 那一侧 |

**设计要点：**
- Hero 区要建立第一印象，主标题要大、要有冲击力
- 痛点区三张卡片用网格布局（桌面 3 列，移动 1 列）
- 步骤区用序号圆圈体现流程感
- CTA 按钮区分主次：主按钮 `.btn-primary` 实心，次按钮 `.btn-ghost` 描边
- 已登录用户 CTA 文案变为"进入工作区"

### 4.2 产品原理页 `/how-it-works`
**文件：** `web/src/marketing.ts` → `renderHowItWorksPage()`

**页面结构（6 个 doc-section）：**
1. 什么是认知债务
2. 为什么它很危险（3 条列表）
3. 识别 → 清偿 → 谨慎确认（流程图 `.doc-flow`）
4. 六部分报告各自揭示什么（6 个 `.doc-item`）
5. 清偿会话：为什么是「用自己的话解释」**+ 费曼口径说明框**
6. 四种谨慎的清偿状态（`.status-explained-list`）

**费曼口径说明框（关键，请勿改动文案）：**
位于第五部分末尾，className 为 `.doc-note.note-feynman`：

> **关于「费曼式」**
> MindIOU 借鉴了费曼「用自己的话讲清楚复杂概念」的精神。需要说明的是，「费曼技巧」并非费曼本人提出的学术术语，而是从其学习习惯归纳而来。
> 其底层机制有认知科学支撑：主动回忆（Retrieval Practice）、生成效应（Generation Effect）、元认知监控（Metacognitive Monitoring）——这些是教育心理学同行评审文献中经过验证的机制。

**设计要点：**
- 这是长内容页，需要优秀的阅读体验（行高 1.7-1.8，段落间距）
- 流程图 `.doc-flow` 用等宽字体，可横向滚动
- 费曼口径说明框用左侧色条 + 浅底色，区别于正文
- 四种状态用 `.status-explained` 卡片网格展示（桌面 2 列），每种带对应配色类

---

## 5. 核心闭环页面设计要点

### 5.1 登录页 `#/login`
**文件：** `web/src/pages.ts` → `renderLoginPage()`

| 元素 | className | 说明 |
|---|---|---|
| 品牌标题 | `.brand-title` | "MindIOU" |
| 品牌副标题 | `.brand-subtitle` | "把 AI 代劳转化为真实能力成长" |
| 登录卡片 | `.login-card` | — |
| 邀请码输入框 | `.login-input` | type=password |
| 提交按钮 | `.btn-primary` | "进入" |

**设计要点：** 建立信任感，居中布局，克制不空洞。

### 5.2 产品输入页 `#/app`
**文件：** `web/src/pages.ts` → `renderAppPage()`

| 元素 | className | 说明 |
|---|---|---|
| 介绍区 | `.app-intro` | 标题 + 描述 |
| 预期管理区 | `.app-expect` | "接下来会经历什么" + 3 条 `.expect-item` |
| 三步进度 | `.step-indicator` | 1 输入 → 2 时间线与困惑 → 3 报告（当前步骤高亮） |
| 材料输入框 | `.artifact-input` | textarea, maxLength 30000 |
| 字数计数 | `.input-counter` | "0 / 30000"，超 27000 变红（`.is-warn`） |
| 隐私提示 | `.input-hint` | "请勿粘贴密码/密钥" |
| 生成按钮 | `.btn-primary` | ≥10字才启用，点击后生成时间线 |

**设计要点：**
- 输入框要大、要显眼，是核心操作
- 预期管理区告诉用户接下来三步流程
- 三步进度指示贯穿输入页、时间线页、报告页（`.step-indicator`），当前步骤高亮（`.is-active`），已完成步骤标记（`.is-done`）
- 字数计数器在右下角，接近上限变红

### 5.3 时间线与困惑标注页 `#/timeline/:draftId` ★ 新增
**文件：** `web/src/pages.ts` → `renderTimelinePage()`

| 元素 | className | 说明 |
|---|---|---|
| 三步进度 | `.step-indicator` | 当前在第 2 步 |
| 介绍区 | `.timeline-intro` | 标题 + 说明 |
| 步骤卡片 | `.timeline-card` | 每个协作步骤一张卡 |
| 步骤编号 | `.timeline-step-id` | "step-1" 等 |
| 步骤标题 | `.timeline-step-title` | — |
| AI 做了什么 | `.timeline-step-ai` | — |
| 关键动作标签 | `.tag-action` | `.timeline-tags` 容器 |
| 关键概念标签 | `.tag-concept` | `.timeline-tags` 容器 |
| 困惑输入框 | `.confusion-input` | 每步一个 textarea，标注"哪里没看懂" |
| 生成报告按钮 | `.btn-primary` | 点击后保存困惑并生成报告 |

**设计要点：**
- 这是三段式的核心交互：用户在 AI 拆解的步骤上标注困惑
- 步骤卡片纵向排列，每张卡内信息层次清晰（编号→标题→AI 做了什么→标签→困惑输入）
- 困惑输入框要明显，让用户知道"这是我要填的"
- fallback 时显示 `.notice-fallback` 提示

### 5.4 报告页 `#/report/:id`
**文件：** `web/src/pages.ts` → `renderReportPage()`

**六部分（对应产品规则）：**

| 区块 | className | 内容 |
|---|---|---|
| 第一部分 | `.section.ai-completed` | `.evidence-item` 列表 |
| 第二部分 | `.section.user-contributed` | `.evidence-item` 列表 |
| 第三部分 | `.section.dangerous-gaps` | `.gap-card`（带 `.gap-rank` 序号） |
| 第四部分 | `.section.cognitive-structure` | 5 个 `.sub-list`（facts/hypotheses/questions/decisions/tradeoffs） |
| 第五部分 | `.section.cards-section` | `.feynman-card` 列表（选卡入口） |
| 第六部分 | `.section.next-actions` | `.action-item`（带 route 标签） |
| 困惑处理回执 | `.section.confusion-resolutions` | 回显用户在时间线标注的困惑如何被处理（归入缺口/不构成能力缺口） |

**设计要点：**
- 报告内容长，需要清晰视觉层次
- 费曼卡是核心转化点，视觉上要突出、可点击感强
- 缺口卡片用 rank 体现危险程度
- action 四种 route（verify/note/task/ask）用四种颜色标签
- 困惑处理回执是三段式闭环的关键：让用户看到自己标注的困惑被认真对待了。`.resolution-item.is-gap`（归入缺口，红色色条）与 `.is-not-gap`（不构成缺口，灰色色条）视觉区分

### 5.5 清偿会话页 `#/session/:id`
**文件：** `web/src/pages.ts` → `renderSessionPage()` + `drawSession()`

**页面结构：** 清偿问题区 → 参考来源区 → 对话历史 → 输入区 / 结果区

**四种清偿状态（核心情感点）：**

| 状态值 | className | 中文标签 | 配色 |
|---|---|---|---|
| `provisionally_cleared` | `.status-provisionally_cleared` | 初步清偿 | 绿色系 |
| `needs_practice` | `.status-needs_practice` | 需要练习 | 橙色系 |
| `needs_verification` | `.status-needs_verification` | 需要验证 | 蓝色系 |
| `no_valid_attempt` | `.status-no_valid_attempt` | 无有效回答 | 红色系 |

**设计要点：**
- 清偿问题要大、要醒目
- **结果状态是情感高潮点**，四种状态视觉差异要明显但克制
- scaffold（参考要点）在会话结束后才显示

---

## 6. 费曼口径契约（重要）

对外宣传用"费曼式"（致敬精神），不用"费曼学习法"（学术术语）。原理页有专门说明框锚定认知科学出处。

| 场景 | 该怎么说 |
|---|---|
| 落地页 | 「费曼式清偿」（用"式"不用"法"） |
| 原理页 | 借鉴费曼精神 + Retrieval Practice / Generation Effect 学术锚点 |
| 代码字段 | `feynmanCards` 不变（内部契约） |

设计师请勿改动营销页和原理页的关键文案口径。

---

## 7. 全局设计 token

```css
:root {
  --max-width: 760px;
  --space: 1rem;
  --radius: 8px;
  --text: #1a1a1a;
  --muted: #666;
  --border: #e2e2e2;
  --bg: #fafafa;
  --primary: #2a2a2a;
  --primary-text: #fff;
  --danger: #c0392b;
}
```

**建议设计师定义完整 design system**（间距梯度、字号梯度、颜色梯度），当前是中性方案，可加入品牌主色。

---

## 8. 后端 API 接口清单

设计师一般不需要直接调 API，完整契约见 `web/src/types.ts`。

| # | 方法 | 路径 | 用途 |
|---|---|---|---|
| 1 | POST | `/api/mvp0/timelines` | 三段式·第一段→第二段：生成协作时间线草稿 |
| 2 | PATCH | `/api/mvp0/drafts/:id` | 三段式·第二段：保存用户标注的困惑 |
| 3 | GET | `/api/mvp0/drafts/:id` | 获取草稿详情（刷新恢复） |
| 4 | POST | `/api/mvp0/report` | 三段式·第三段：生成报告（支持 draftId） |
| 5 | GET | `/api/mvp0/reports/:id` | 获取报告详情 |
| 6 | POST | `/api/mvp1/sessions` | 启动清偿会话 |
| 7 | GET | `/api/mvp1/sessions/:id` | 获取会话状态 |
| 8 | POST | `/api/mvp1/sessions/:id/answers` | 提交解释→获取反馈 |
| 9 | POST | `/api/mvp1/sessions/:id/end` | 结束会话→最终状态 |

**鉴权：** 邀请码存 localStorage，每个请求带 `Authorization: Bearer` 头。前端不持有 AI API Key。

---

## 9. 设计任务 checklist

### P0 - 必须
- [ ] 完整 design system（颜色、字号、间距、圆角梯度）
- [ ] 落地页视觉设计（hero + 痛点 + 流程 + CTA）
- [ ] 原理页排版优化（长内容可读性 + 费曼说明框）
- [ ] 登录页视觉设计
- [ ] 产品输入页（输入框 + 预期管理 + 三步进度 + 字数计数）
- [ ] 时间线与困惑标注页（步骤卡片 + 困惑输入 + 标签）★ 新增
- [ ] 三步进度指示组件（贯穿三页）
- [ ] 报告页六部分视觉层次 + 困惑处理回执
- [ ] 清偿会话页专注感
- [ ] 四种清偿状态视觉差异
- [ ] 移动端适配（max-width 640px 断点）
- [ ] loading / error / 空状态设计

### P1 - 建议
- [ ] 公共顶栏与页脚的设计
- [ ] 痛点卡片视觉强化
- [ ] 流程步骤的视觉引导
- [ ] 降级模式 `.notice-fallback` 视觉处理
- [ ] 来源 credibility 视觉区分
- [ ] 404 页设计

### P2 - 可选
- [ ] 品牌 logo / favicon
- [ ] 微交互动效
- [ ] 深色模式
- [ ] 打印样式

---

## 10. 本地预览

```bash
# 1. 启动后端
cd evenhub-g2-learning
npm run api          # → http://localhost:8793

# 2. 启动前端
cd evenhub-g2-learning/web
npm install
npm run dev          # → http://localhost:5180
```

- 后端未配置 `LEARNING_API_TOKEN` 时，任意邀请码均可进入
- 修改 `styles.css` 后 Vite HMR 自动刷新

---

## 11. 文件地图

```
evenhub-g2-learning/web/
├── index.html              ← HTML 入口
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── app.ts              ← 路由分发 + 鉴权守卫
    ├── router.ts           ← 路由 + DOM 工具
    ├── api.ts              ← 后端 API 客户端
    ├── types.ts            ← 数据结构定义
    ├── marketing.ts        ← ★ 落地页 + 原理页（文案契约）
    ├── pages.ts            ← 产品页渲染
    └── styles.css          ← ★ 设计师主要改这个文件 ★
```

**设计师工作流：**
1. 改 `styles.css` → 浏览器自动刷新
2. 如需新增 DOM 节点 → 改 `marketing.ts` 或 `pages.ts`
3. 不要动 `app.ts` / `router.ts` / `api.ts` / `types.ts`
4. 完成后运行 `npm run build` 验证构建通过

---

## 12. 验收标准

- [ ] `cd web && npm run build` 通过
- [ ] 桌面端（≥1024px）所有页面视觉正常
- [ ] 移动端（≤640px）所有页面可用
- [ ] 四种清偿状态视觉可区分
- [ ] 费曼口径说明框清晰可读
- [ ] 降级模式有明确视觉提示
- [ ] loading/error/空状态都有设计
- [ ] 无水平滚动条
- [ ] 首屏无大规模布局跳动
