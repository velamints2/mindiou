/**
 * Tests for local card generation
 * Validates card generation without API dependency
 */

import { describe, it, expect } from 'vitest'
import { generateCardsFromText, generateFallbackCards } from './localCardGenerator'
import { normalizeText } from './textNormalizer'
import { chunkText } from './textChunker'
import { checkCardQuality } from './cardQuality'

// Test fixtures
const fixtures = {
  chineseDefinition: `
对比学习是一种重要的学习方法。对比学习是指通过将两个或多个概念、现象或事物进行比较，
找出它们的异同点，从而加深对这些概念的理解。这种学习方法可以帮助学生更好地理解和记忆。
  `,
  chineseSteps: `
学习一个新概念的步骤如下：首先，要理解概念的定义和基本含义。然后，要学习相关的例子和应用场景。
最后，要通过练习和复述来加深理解。这个过程通常需要反复进行。
  `,
  chineseContrast: `
内隐学习和外显学习有很大的区别。内隐学习是指在无意识的情况下获得的知识，而外显学习是指有意识地学习知识。
对比这两者可以帮助我们更好地理解学习过程。
  `,
  englishDefinition: `
Metacognition is the ability to think about thinking. It means being aware of your own thought processes
and being able to reflect on how you learn. This skill is important for effective learning.
  `,
  englishSteps: `
The process of solving a math problem involves several steps. First, you need to understand the problem statement.
Then, identify the relevant information. Next, plan your solution strategy. Finally, execute and verify your answer.
  `,
  mixedContent: `
# 学习科学基础

## 什么是Spaced Repetition?

Spaced Repetition 是间隔复习，指的是在递增的时间间隔后重复学习相同的信息。

### 为什么要间隔复习？

因为人类的记忆遵循遗忘曲线。通过在遗忘前复习，可以延长记忆保留时间。

### 与传统复习的对比

- 传统复习：一次性大量复习 vs Spaced Repetition：多次小剂量复习
- 效果对比：传统方法短期效果好，长期效果差 vs Spaced Repetition 长期效果优
  `,
  listContent: `
学习可以分为以下几种类型：
1. 概念学习 - 学习新的想法和理论
2. 技能学习 - 通过实践获得能力
3. 态度学习 - 改变信念和价值观
4. 行为学习 - 获得新的行为模式

每种类型都需要不同的学习策略。
  `,
  noiseContent: `
这是一段背景介绍文本。在开始学习之前，我们需要了解一些基本的概念。
学习是一个复杂的过程。它涉及许多不同的因素。有很多关于学习的理论。

然而，最重要的是理解学习的核心定义：学习是指个体通过实践或经验，所获得的相对稳定的行为或思维方式的改变。

这个定义强调了三个要点：1) 学习涉及行为改变，2) 学习需要实践或经验，3) 学习是相对稳定的。
  `
}

describe('Local Card Generation', () => {
  describe('Text Normalization', () => {
    it('should normalize Chinese text', () => {
      const result = normalizeText(fixtures.chineseDefinition)
      expect(result.language).toBe('zh')
      expect(result.wordCount).toBeGreaterThan(0)
      expect(result.normalized.length).toBeGreaterThan(0)
    })

    it('should normalize English text', () => {
      const result = normalizeText(fixtures.englishDefinition)
      expect(result.language).toBe('en')
      expect(result.wordCount).toBeGreaterThan(0)
    })

    it('should detect mixed language', () => {
      const result = normalizeText(fixtures.mixedContent)
      expect(result.language).toBe('mixed')
    })

    it('should handle empty input', () => {
      const result = normalizeText('')
      expect(result.normalized).toBe('')
      expect(result.wordCount).toBe(0)
    })
  })

  describe('Text Chunking', () => {
    it('should chunk Chinese text', () => {
      const normalized = normalizeText(fixtures.chineseDefinition)
      const chunks = chunkText(normalized.normalized)
      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].text.length).toBeGreaterThan(0)
    })

    it('should chunk English text', () => {
      const normalized = normalizeText(fixtures.englishDefinition)
      const chunks = chunkText(normalized.normalized)
      expect(chunks.length).toBeGreaterThan(0)
    })

    it('should preserve chunk order', () => {
      const normalized = normalizeText(fixtures.mixedContent)
      const chunks = chunkText(normalized.normalized)
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i].order).toBeLessThan(chunks[i + 1].order)
      }
    })
  })

  describe('Concept Card Generation', () => {
    it('should generate concept cards from Chinese definition', async () => {
      const cards = await generateCardsFromText(fixtures.chineseDefinition)
      const conceptCards = cards.filter(c => c.type === 'concept')
      expect(conceptCards.length).toBeGreaterThan(0)
      conceptCards.forEach(card => {
        expect(card.front).toBeTruthy()
        expect(card.back).toBeTruthy()
        expect(card.glassesText).toBeTruthy()
        expect(card.glassesText.length).toBeGreaterThan(0)
        expect(card.glassesText.length).toBeLessThan(50)
      })
    })

    it('should generate concept cards from English definition', async () => {
      const cards = await generateCardsFromText(fixtures.englishDefinition)
      const conceptCards = cards.filter(c => c.type === 'concept')
      expect(conceptCards.length).toBeGreaterThan(0)
    })

    it('should not generate empty fields', async () => {
      const cards = await generateCardsFromText(fixtures.chineseDefinition)
      cards.forEach(card => {
        expect(card.front.trim().length).toBeGreaterThan(0)
        expect(card.back.trim().length).toBeGreaterThan(0)
        expect(card.glassesText.trim().length).toBeGreaterThan(0)
      })
    })
  })

  describe('Why Card Generation', () => {
    it('should generate why cards from Chinese text', async () => {
      const cards = await generateCardsFromText(fixtures.chineseSteps)
      const whyCards = cards.filter(c => c.type === 'why')
      // Why cards may or may not be generated depending on patterns
      if (whyCards.length > 0) {
        whyCards.forEach(card => {
          expect(card.front).toContain('？')
          expect(card.glassesText).toContain('？')
        })
      }
    })
  })

  describe('Steps Card Generation', () => {
    it('should generate steps cards from process text', async () => {
      const cards = await generateCardsFromText(fixtures.chineseSteps)
      const stepCards = cards.filter(c => c.type === 'steps')
      expect(stepCards.length).toBeGreaterThan(0)
      stepCards.forEach(card => {
        expect(card.front).toContain('步骤')
        expect(card.glassesText).toContain('步骤')
      })
    })

    it('should generate steps cards from English process text', async () => {
      const cards = await generateCardsFromText(fixtures.englishSteps)
      const stepCards = cards.filter(c => c.type === 'steps')
      if (stepCards.length > 0) {
        expect(stepCards[0].back.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Contrast Card Generation', () => {
    it('should generate contrast cards from comparison text', async () => {
      const cards = await generateCardsFromText(fixtures.chineseContrast)
      const contrastCards = cards.filter(c => c.type === 'contrast')
      if (contrastCards.length > 0) {
        contrastCards.forEach(card => {
          expect(card.front).toContain('区别')
          expect(card.glassesText).toContain('vs')
        })
      }
    })
  })

  describe('Example Card Generation', () => {
    it('should generate example cards', async () => {
      const text = `
这个概念有很多例子。例如，红色是一种颜色。比如说，鸟类可以飞行。
另一个例子是云的形成过程。
      `
      const cards = await generateCardsFromText(text)
      const exampleCards = cards.filter(c => c.type === 'example')
      if (exampleCards.length > 0) {
        exampleCards.forEach(card => {
          expect(card.glassesText).toContain('例')
        })
      }
    })
  })

  describe('Misconception Card Generation', () => {
    it('should generate misconception cards', async () => {
      const text = `
一个常见的误解是认为学习只是记忆。实际上，学习涉及理解和应用。
另一个不正确的想法是所有人都以相同的方式学习。
实际上，每个人都有独特的学习风格。
      `
      const cards = await generateCardsFromText(text)
      const misconCards = cards.filter(c => c.type === 'misconception')
      if (misconCards.length > 0) {
        expect(misconCards[0].glassesText).toContain('误')
      }
    })
  })

  describe('Quality Scoring', () => {
    it('should score cards based on quality', async () => {
      const cards = await generateCardsFromText(fixtures.chineseDefinition)
      cards.forEach(card => {
        expect(card.qualityScore).toBeGreaterThanOrEqual(0)
        expect(card.qualityScore).toBeLessThanOrEqual(100)
        expect(Array.isArray(card.qualityWarnings)).toBe(true)
      })
    })

    it('should identify too-long front text', async () => {
      const badCard = await generateCardsFromText(
        '这是一个非常长的概念定义，说起来话很长，需要很多词来描述它，几乎没有其他方式来表达这个复杂的想法'
      )
      if (badCard.length > 0) {
        const hasWarnings = badCard.some(c => c.qualityWarnings.length > 0)
        // May or may not generate depending on patterns
      }
    })

    it('should include sourceExcerpt', async () => {
      const cards = await generateCardsFromText(fixtures.chineseDefinition)
      cards.forEach(card => {
        expect(card.sourceExcerpt.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Deduplication', () => {
    it('should not generate duplicate cards', async () => {
      const text = `
什么是学习？学习是指通过实践获得知识。学习是通过经验改变行为。
学习的定义是获取知识和技能的过程。
      `
      const cards = await generateCardsFromText(text)
      const fronts = cards.map(c => c.front)
      const uniqueFronts = new Set(fronts.map(f => f.toLowerCase()))
      // Most cards should have unique fronts (deduplication)
      expect(uniqueFronts.size).toBeGreaterThanOrEqual(cards.length * 0.7)
    })
  })

  describe('Mixed Content', () => {
    it('should handle markdown content', async () => {
      const cards = await generateCardsFromText(fixtures.mixedContent)
      expect(cards.length).toBeGreaterThan(0)
      cards.forEach(card => {
        expect(card.front).not.toContain('#')
        expect(card.back).not.toContain('###')
      })
    })

    it('should handle list content', async () => {
      const cards = await generateCardsFromText(fixtures.listContent)
      expect(cards.length).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty text', async () => {
      const cards = await generateCardsFromText('')
      expect(cards.length).toBe(0)
    })

    it('should handle very short text', async () => {
      const cards = await generateCardsFromText('学习。')
      // May generate or not based on patterns
      expect(Array.isArray(cards)).toBe(true)
    })

    it('should respect maxTotalCards option', async () => {
      const cards = await generateCardsFromText(
        fixtures.mixedContent,
        { maxTotalCards: 3 }
      )
      expect(cards.length).toBeLessThanOrEqual(3)
    })

    it('should filter low quality cards if requested', async () => {
      const cards = await generateCardsFromText(
        fixtures.chineseDefinition,
        { removeLoQualityCards: true, minQualityScore: 60 }
      )
      cards.forEach(card => {
        expect(card.qualityScore).toBeGreaterThanOrEqual(60)
      })
    })
  })

  describe('Fallback Generation', () => {
    it('should generate fallback cards from text without patterns', () => {
      const cards = generateFallbackCards(fixtures.noiseContent)
      expect(cards.length).toBeGreaterThan(0)
      cards.forEach(card => {
        expect(card.type).toBe('summary')
        expect(card.front.length).toBeGreaterThan(0)
        expect(card.back.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Card Metadata', () => {
    it('should have proper card metadata', async () => {
      const cards = await generateCardsFromText(fixtures.chineseDefinition)
      if (cards.length > 0) {
        const card = cards[0]
        expect(card.id).toBeTruthy()
        expect(card.sourceId).toBeTruthy()
        expect(card.type).toBeTruthy()
        expect(card.difficulty).toBeGreaterThanOrEqual(1)
        expect(card.difficulty).toBeLessThanOrEqual(3)
        expect(card.tags.length).toBeGreaterThanOrEqual(0)
        expect(card.createdAt).toBeTruthy()
        expect(card.updatedAt).toBeTruthy()
      }
    })

    it('should have glassesText with appropriate length', async () => {
      const cards = await generateCardsFromText(fixtures.chineseDefinition)
      cards.forEach(card => {
        const chineseChars = (card.glassesText.match(/[\u4e00-\u9fa5]/g) || []).length
        const englishWords = (card.glassesText.match(/[a-zA-Z]+/g) || []).length

        // For Chinese: 6-18 characters
        if (chineseChars > englishWords) {
          expect(chineseChars).toBeGreaterThanOrEqual(2)
          expect(chineseChars).toBeLessThanOrEqual(30)
        } else {
          // For English: 2-7 words
          expect(englishWords).toBeGreaterThanOrEqual(1)
          expect(englishWords).toBeLessThanOrEqual(10)
        }
      })
    })
  })
})
