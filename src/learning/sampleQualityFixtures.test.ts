import { describe, expect, it } from 'vitest'
import { generateCardsFromText } from './localCardGenerator'

const fixtures = {
  corsBug: `我在浏览器里调用本地 API 时遇到 CORS 问题。前端在 localhost:5175，请求 localhost:8793 被拦截。原因是服务端没有返回 Access-Control-Allow-Origin。解决方法是让服务端添加允许的来源，或者让前后端走同源代理。`,
  aiCodingLog: `今天用 AI 辅助重构了一个解析模块。先让模型总结当前实现，再拆出 normalize、chunk、score 三个步骤。最后人工检查边界条件，修正了重复卡片和过长 glassesText 的问题。`,
  chineseTechArticle: `在前端性能优化中，减少主线程阻塞非常关键。可以通过拆分大任务、延迟非关键渲染、合理使用 Web Worker 来降低用户感知卡顿。浏览器的渲染管线决定了我们不能无限制地在一次事件循环里做太多事情。`,
  englishTechArticle: `Suspense helps coordinate asynchronous UI states. It lets the UI show a fallback while data is loading, and then reveal the final content once the promise resolves. The key benefit is smoother perceived performance and simpler loading logic.`,
  markdownNote: `# Notes\n\n## Definition\n学习迁移是指把一种情境中获得的知识应用到另一种情境。\n\n## Example\n比如，把写作中的结构化思维迁移到产品文档写作。`,
  stepsText: `处理输入的步骤是：首先清洗文本，然后分块，再生成候选卡片，接着进行质量评分，最后交给用户预览和编辑。`,
  contrastText: `增量式学习和一次性学习有明显区别。前者强调小步快跑和持续复习，后者往往一次性投入大量时间但遗忘更快。`,
  conceptText: `间隔复习是指在逐渐拉大的时间间隔内重复回顾同一知识点。它的核心目标不是记住答案，而是增强长期提取能力。`,
  backgroundNoise: `这是一段背景介绍。团队讨论了很多历史、流程和上下文，但真正重要的是：我们需要稳定地把原始内容变成可复述的学习卡片。很多废话并不能帮助学习，只有明确定义、原因、步骤和例子才有用。`,
  productResearch: `我们访谈了三位用户。大家都不想被迫背答案，更希望卡片能帮助他们解释概念、比较方案、举例说明以及记住关键动作。桌面端被认为最适合整理原始素材和编辑卡片。`
}

async function cardsFor(text: string) {
  return generateCardsFromText(text)
}

describe('sample quality fixtures', () => {
  it('english technical article should not generate data concept', async () => {
    const cards = await cardsFor(fixtures.englishTechArticle)
    expect(cards.some(card => /什么是data/i.test(card.front))).toBe(false)
    expect(cards.every(card => card.qualityScore <= 70 || card.type !== 'concept')).toBe(true)
  })

  it('markdown headings should not leak into concept names', async () => {
    const cards = await cardsFor(fixtures.markdownNote)
    expect(cards.some(card => /Notes|Definition/.test(card.front))).toBe(false)
    expect(cards.some(card => card.front.includes('学习迁移'))).toBe(true)
    expect(cards.some(card => card.front === '什么是学习迁移？')).toBe(true)
  })

  it('background noise should not become a concept card', async () => {
    const cards = await cardsFor(fixtures.backgroundNoise)
    expect(cards.some(card => /但真正重要/.test(card.front))).toBe(false)
    expect(cards.every(card => card.qualityScore <= 70 || card.type !== 'concept')).toBe(true)
  })

  it('contrast text should generate a contrast card', async () => {
    const cards = await cardsFor(fixtures.contrastText)
    expect(cards.some(card => card.type === 'contrast')).toBe(true)
  })

  it('steps text should prefer steps cards', async () => {
    const cards = await cardsFor(fixtures.stepsText)
    expect(cards.some(card => card.type === 'steps')).toBe(true)
    expect(cards[0]?.type).toBe('steps')
  })

  it('product research text should not be misread as an example card', async () => {
    const cards = await cardsFor(fixtures.productResearch)
    expect(cards.some(card => card.type === 'example')).toBe(false)
  })

  it('bad cards should not score above 75', async () => {
    const badSamples = [
      fixtures.englishTechArticle,
      fixtures.backgroundNoise,
      fixtures.productResearch
    ]

    for (const sample of badSamples) {
      const cards = await cardsFor(sample)
      if (cards.length > 0) {
        expect(Math.max(...cards.map(card => card.qualityScore))).toBeLessThanOrEqual(75)
      }
    }
  })

  it('good cards should score above 75', async () => {
    const cards = await cardsFor(fixtures.conceptText)
    expect(cards.length).toBeGreaterThan(0)
    expect(Math.max(...cards.map(card => card.qualityScore))).toBeGreaterThan(75)
  })
})
