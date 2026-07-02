# Learn Coach 当前项目进度

更新时间：2026-07-02

## 1. 产品定义

Learn Coach / Spiral 是一个 AI native 主动学习系统。它不只把材料变成普通
卡片，而是从真实工作和 AI 协作中识别用户尚不能独立复现的能力缺口，将其
记录为学习债务，再通过眼镜上的主动回忆、语音解释、AI 评价、追问和复习
调度逐步清偿。

## 2. 当前平台

### Even G2

- 当前版本：`0.3.3`。
- 眼镜显示：单张 `288 x 144` 大字概念图 + 短 footer。
- 操作：上滑上一项、下滑下一项、点击安全忽略。
- 语音：G2 MIC PCM、STT、保守命令识别、长回答、Tutor 评价和追问。
- 手机端：Today、Capture、Knowledge、Review、Settings。

### Rokid AIUI

- 当前版本：`0.1.0`。
- 4 个 Ink 页面：沉浸式学习、语音动作、材料导入、API 设置。
- 与 Even G2 共用 Spiral 知识原子、学习债务、Tutor 和复习调度。
- Craft 导入候选包已生成，尚待比赛账号与 Rokid 真机验证。

### Desktop Workbench

- 独立入口：`desktop.html`。
- 支持本地文本清洗、切块、卡片候选、质量评分、编辑、Deck 和学习会话。
- 已与 EHPK 的 `index.html` 分离，不再覆盖 G2 发布入口。

## 3. 两种材料处理方式

### 提取知识并加入复习

原名“编译知识增量”。它用于处理 Codex 工作记录、故障复盘、项目决策或
其他真实工作材料。系统会：

1. 判断是否存在真正可复用的新知识，允许生成 0 张卡。
2. 最多生成 3 个知识原子。
3. 保存来源 ID、项目上下文、概念、答案和主动回忆问题。
4. 生成学习债务分数、无 AI 微练习和复习计划。
5. 将回答结果持久化到 Knowledge 和 Review。

### 仅生成临时卡片

用于普通文章、单词或临时材料。AI 会直接生成 1-8 张卡，保存在当前
WebView 本地，不创建持久化知识原子、学习债务或来源关系。

## 4. 0.3.3 修复

- 修复桌面 Workbench 覆盖 Even G2 `index.html`，导致 EHPK 同时加载两个应用。
- Desktop 改用独立 `desktop.html`，Vite 同时构建 G2 与 Desktop。
- 移除旧启动示例 `apple / resilient / context / iterate`，迁移为主动回忆示例。
- 手机端 `Failed to fetch` 等网络错误不再进入 G2 概念图片。
- G2 图片只使用卡片自身的 concept 和 recall question，避免图片与提示错位。
- 图片上传增加 6.5 秒超时；失败后显示 `Image failed / Swipe to retry`，
  不会永久停在 `Updating image...`。
- Spiral store 升级到 version 4，旧卡自动迁移为：
  `concept front + recall question prompt + answer back`。
- 清理旧 Today 卡片中的 `Fix the G2 WebView request failure...` source 原文。
- “编译知识增量”改名为“提取知识并加入复习”。
- “AI 转卡片”改名为“仅生成临时卡片”。
- 修复 Desktop 本地卡片生成器的混合语言、中文步骤、Markdown、列表与
  fallback 生成问题。

## 5. 当前发布包

```text
release/learn-coach-0.3.3.ehpk
size: 61,015 bytes
sha256: dd00bad363a4ff6bad536d720c7d543268c41a7736bafac179505c4e5d4a0867
```

## 6. 验证结果

- TypeScript：通过。
- Vitest：5 个文件，47 项测试全部通过。
- Spiral smoke：通过。
- Rokid API smoke：通过。
- Voice API contract：通过；本轮未传入真实 PCM 文件。
- Vite G2 + Desktop 双入口构建：通过。
- Even release check 和 EHPK pack：通过。
- 官方 Even Simulator 正常路径：
  - 启动画面非空；
  - 点击不触发动作；
  - 上下滑正确；
  - 快速三次下滑收敛到最新卡；
  - Tutor schema 正常。
- 官方 Even Simulator 图片故障注入：
  - telemetry 返回 `g2_concept_image_failed`；
  - 眼镜 footer 显示 `Image failed / Swipe to retry`；
  - 不再永久显示图片传输中。
- 本地真实 store 已迁移，Today 当前显示概念和对应问题，不再显示 source 原文。

## 7. 当前限制

- `0.3.3` 仍需上传 Developer Portal 后做一次真实 G2 图片失败/重试验收。
- Voice smoke 本轮没有提供真实 PCM；普通话和英文真声仍需在 0.3.3 上回归。
- Mac API 需要持续运行，手机/G2 必须使用 Mac 当前局域网地址，不能使用
  `localhost`。
- Rokid 版本尚未完成 Craft 导入、比赛格式确认、公开 HTTPS 后端和真机验证。

## 8. 下一步

1. 上传 `learn-coach-0.3.3.ehpk`。
2. 验证启动后不再出现 apple 或 Failed to fetch 图片。
3. 验证 Today 显示概念标题和对应问题。
4. 连续切换 10 次并模拟弱网，确认不会永久停在图片传输中。
5. 测试“提取知识并加入复习”产生的知识原子和 Review 记录。
6. 继续收集用户实际使用中的未完成问题描述。
