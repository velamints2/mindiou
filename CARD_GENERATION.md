# Card Generation

## 目标

Learn Coach 现在优先使用本地规则生成学习卡片，不依赖外部 AI API。

原始内容处理流程：

1. `normalizeText(rawText)`
2. `chunkText(normalizedText)`
3. `generateCardsFromText(rawText, options)`
4. 候选卡片打分 `scoreCards`
5. 去重 `dedupeCards`
6. 过滤低质量卡片 `filterLowQualityCards`
7. 输出可预览、可编辑的卡片列表

## 支持的卡片类型

- `concept`
- `why`
- `steps`
- `contrast`
- `example`
- `misconception`
- `application`
- `summary`

第一版重点实现前 6 类。

## 字段约束

每张卡片包含：

- `front`：桌面端学习问题
- `back`：参考答案
- `glassesText`：给眼镜显示的极短提示
- `prompt`：复述引导语
- `hint`：可选提示
- `sourceExcerpt`：原文证据
- `qualityScore`：0-100
- `qualityWarnings`：质量警告数组

## 质量评分规则

重点不是生成数量，而是生成值得学习的卡片。

常见警告：

- `front_too_long`
- `back_too_long`
- `glasses_text_too_long`
- `glasses_text_too_short`
- `missing_source_excerpt`
- `too_generic`
- `duplicate_candidate`
- `unclear_question`
- `answer_not_grounded`
- `too_many_concepts`

## 设计原则

- 一张卡只讲一个知识点
- `front` 必须是清楚的问题
- `back` 必须能从 `sourceExcerpt` 找到依据
- `glassesText` 必须短
- `prompt` 必须引导用户复述
- 不生成空泛卡片
- 不生成重复卡片
- 不把整段原文塞进 `glassesText`

## 测试

运行：

```bash
npm run test:cards
```

## 当前限制

- 规则版生成器无法像大模型一样理解复杂语义
- 对强上下文依赖的内容，召回率有限
- 对高度抽象、跨段落推理的内容覆盖不完整
- 质量评分偏保守，可能保留少量人工可修正卡片

## 下一步

未来接入 AI API 时，建议只作为后处理层：

- 本地清洗仍保留
- 本地切块仍保留
- AI 仅补充候选卡片或改写低质量卡片
- 仍然保留人工预览和编辑
