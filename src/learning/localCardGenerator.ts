/**
 * Local card generator
 * Generates learning cards from raw text without API dependency
 */

import {
  LearningCard,
  LearningCardType,
  TextChunk,
  CardGenerationOptions
} from './cardTypes'
import { normalizeText, cleanForCardDisplay } from './textNormalizer'
import { chunkText, chunkByParagraphs } from './textChunker'
import { checkCardQuality, findDuplicates, scoreBatch } from './cardQuality'

/**
 * Generate a simple UUID-like ID
 */
function generateId(): string {
  return 'card-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

/**
 * Detect language of text
 */
function detectLanguage(text: string): 'zh' | 'en' | 'mixed' {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length
  const totalChars = text.length

  if (chineseChars > totalChars * 0.3) {
    return englishWords > totalChars * 0.1 ? 'mixed' : 'zh'
  }
  return 'en'
}

function containsStepMarkers(text: string): boolean {
  return /(?:首先|然后|其次|最后|第一步|第二步|第三步|step|steps|first|then|finally|next|1\.|2\.|3\.)/i.test(text)
}

function isLikelyConceptTerm(term: string): boolean {
  const cleaned = term.trim()
  if (!cleaned) return false

  // Reject common leading discourse fragments that are often extracted from
  // background text rather than real concepts.
  if (/^[但而并因所这那将让使可需会要]\S*/.test(cleaned)) {
    return false
  }

  const chineseStopTerms = new Set([
    '解决方法', '方法', '问题', '内容', '背景', '步骤', '原因', '方案', '概念',
    '东西', '事情', '结果', '信息', '知识', '主题', '标题', '讨论', '分析'
  ])
  if (chineseStopTerms.has(cleaned)) {
    return false
  }

  // English terms should usually look like a concept or acronym, not a lower
  // case filler word such as "data" pulled out of a sentence clause.
  if (/^[a-z]+$/.test(cleaned)) {
    const stopWords = new Set(['data', 'while', 'this', 'that', 'then', 'when', 'what', 'where', 'why', 'how', 'thing', 'stuff'])
    if (cleaned.length < 4 || stopWords.has(cleaned.toLowerCase())) {
      return false
    }
  }

  // Prefer clear concept labels over long sentence fragments.
  if (cleaned.includes(' ') && cleaned.split(/\s+/).length > 5) {
    return false
  }

  return true
}

/**
 * Try to match concept patterns in text
 */
function extractConcepts(chunk: TextChunk): LearningCard[] {
  const text = chunk.text
  const cards: LearningCard[] = []

  if (containsStepMarkers(text)) {
    return cards
  }

  // Pattern: "X 是..." / "X 指的是..." / "X is..." / "X means..."
  const conceptPatterns = [
    /([^，。？！]*?)(?:是|指的是|意思是|定义为|指)([^，。？！]+[。？！，]?)/g,
    /([a-zA-Z0-9_\-]+)\s+(?:is|means|refers to|defined as)\s+([^.!?]+)/gi
  ]

  for (const pattern of conceptPatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1].trim()
      const definition = match[2].trim()

      if (term.length > 2 && term.length < 50 && definition.length > 5 && definition.length < 100 && isLikelyConceptTerm(term)) {
        const card: LearningCard = {
          id: generateId(),
          sourceId: chunk.id,
          type: 'concept',
          front: `什么是${term}？`,
          back: definition,
          glassesText: detectLanguage(term) === 'zh' ? `什么是${term}？` : `What is ${term}?`,
          prompt: `请用自己的话解释${term}的含义。`,
          hint: `它的关键特点是：${definition.split('；')[0]}`,
          sourceExcerpt: text.substring(match.index, match.index + 150),
          tags: ['concept', term],
          difficulty: 1,
          qualityScore: 0,
          qualityWarnings: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        cards.push(card)
        break // Only one concept per chunk
      }
    }
  }

  return cards
}

/**
 * Try to match why/reason patterns
 */
function extractWhyCards(chunk: TextChunk): LearningCard[] {
  const text = chunk.text
  const cards: LearningCard[] = []

  // Pattern: "因为...", "原因是...", "为什么", "this is because", "because"
  const whyPatterns = [
    /(?:因为|原因是|这是因为)([^，。？！]+)/g,
    /(?:why|because|this is because)\s+([^.!?]+)/gi,
    /(?:所以|因此|那么)([^，。？！]+)(?=，|。|！|？|$)/g
  ]

  for (const pattern of whyPatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const reason = match[1].trim()

      if (reason.length > 5 && reason.length < 150) {
        const card: LearningCard = {
          id: generateId(),
          sourceId: chunk.id,
          type: 'why',
          front: '为什么会这样？',
          back: reason,
          glassesText: '为什么？',
          prompt: '请解释这段内容背后的原因。',
          sourceExcerpt: text.substring(match.index, match.index + 150),
          tags: ['why', 'reason'],
          difficulty: 2,
          qualityScore: 0,
          qualityWarnings: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        cards.push(card)
        break
      }
    }
  }

  return cards
}

/**
 * Try to match steps patterns
 */
function extractStepsCards(chunk: TextChunk): LearningCard[] {
  const text = chunk.text
  const cards: LearningCard[] = []

  // Pattern: numbered steps, "first", "then", "finally"
  const stepsPatterns = [
    /(?:首先|第一步)[，,:：]?\s*([^。？！]+)/,
    /(?:然后|其次|第二步|接着)[，,:：]?\s*([^。？！]+)/,
    /(?:最后|第三步|最终)[，,:：]?\s*([^。？！]+)/,
    /(?:first|then|finally|next)\s+([^.!?]+)/i
  ]

  const stepsList: string[] = []
  for (const pattern of stepsPatterns) {
    const match = pattern.exec(text)
    if (match && match[1]) {
      stepsList.push(match[1].trim())
    }
  }

  if (stepsList.length < 2) {
    const numberedItems = text
      .split(/\n+/)
      .map(line => line.match(/^\s*\d+[.)、]\s*(.+)$/)?.[1]?.trim() || "")
      .filter(Boolean)

    stepsList.push(...numberedItems.slice(0, 6))
  }

  if (stepsList.length < 2 && containsStepMarkers(text)) {
    const rawClauses = text.split(/(?:首先|然后|其次|接着|最后|第一步|第二步|第三步|first|then|finally|next)/i)
    const cleanedClauses = rawClauses
      .map(item => item.replace(/^[，,:：\s]+/, '').trim())
      .filter(Boolean)
      .filter(item => item.length > 1)
      .slice(0, 6)
    stepsList.push(...cleanedClauses)
  }

  if (stepsList.length >= 2) {
    const stepsText = stepsList.join(' → ')
    const card: LearningCard = {
      id: generateId(),
      sourceId: chunk.id,
      type: 'steps',
      front: '这件事的步骤是什么？',
      back: stepsText,
      glassesText: '步骤？',
      prompt: '请按顺序复述主要步骤。',
      sourceExcerpt: text.substring(0, 200),
      tags: ['steps', 'process'],
      difficulty: 2,
      qualityScore: 0,
      qualityWarnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    cards.push(card)
  }

  return cards
}

/**
 * Try to match contrast patterns
 */
function extractContrastCards(chunk: TextChunk): LearningCard[] {
  const text = chunk.text
  const cards: LearningCard[] = []

  // Pattern: "vs", "versus", "compared with", "different from", "而不是"
  const contrastPatterns = [
    /([^ ，。]*?)\s*(?:vs|versus|compared with|different from)\s*([^ ，。]*)/gi,
    /([^，。]*?)(?:而不是|区别是|对比于|有明显区别|有很大区别|有很大的区别)([^，。]*)/g,
    /([^，。]*?)和([^，。]*?)(?:有|存在)?(?:明显|显著|很大)?区别/g
  ]

  for (const pattern of contrastPatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const itemA = match[1].trim()
      const itemB = match[2].trim()

      if (itemA.length > 2 && itemB.length > 2 && itemA.length < 50 && itemB.length < 50) {
        const card: LearningCard = {
          id: generateId(),
          sourceId: chunk.id,
          type: 'contrast',
          front: `${itemA}和${itemB}有什么区别？`,
          back: text.substring(match.index, Math.min(match.index + 150, text.length)),
          glassesText: `${itemA} vs ${itemB}`,
          prompt: `请说出${itemA}和${itemB}最关键的区别。`,
          sourceExcerpt: text.substring(match.index, match.index + 150),
          tags: ['contrast', 'comparison', itemA, itemB],
          difficulty: 2,
          qualityScore: 0,
          qualityWarnings: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        cards.push(card)
        break
      }
    }
  }

  if (cards.length === 0) {
    const pairMatch = text.match(/([^，。]*?)和([^，。]*?)(?:有|存在)?(?:明显|显著|很大)?区别/)
    if (pairMatch && pairMatch[1] && pairMatch[2]) {
      const itemA = pairMatch[1].trim()
      const itemB = pairMatch[2].trim()
      if (itemA.length > 1 && itemB.length > 1) {
        cards.push({
          id: generateId(),
          sourceId: chunk.id,
          type: 'contrast',
          front: `${itemA}和${itemB}有什么区别？`,
          back: text.substring(0, 150),
          glassesText: `${itemA} vs ${itemB}`,
          prompt: `请说出${itemA}和${itemB}最关键的区别。`,
          sourceExcerpt: text.substring(0, 150),
          tags: ['contrast', 'comparison', itemA, itemB],
          difficulty: 2,
          qualityScore: 0,
          qualityWarnings: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      }
    }
  }

  return cards
}

/**
 * Try to match example patterns
 */
function extractExampleCards(chunk: TextChunk): LearningCard[] {
  const text = chunk.text
  const cards: LearningCard[] = []

  // Pattern: "例如", "比如", "举例", "for example", "such as", "e.g."
  const examplePatterns = [
    /(?:例如|比如说|比如|举个例子|for example|such as|e\.g\.)([^，。？！]*)/g,
    /(?:for example|such as|e\.g\.|example:)\s*([^.!?]+)/gi
  ]

  for (const pattern of examplePatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const example = match[1].trim()

      if (example.length > 5 && example.length < 150) {
        const card: LearningCard = {
          id: generateId(),
          sourceId: chunk.id,
          type: 'example',
          front: '这个概念的例子是什么？',
          back: example,
          glassesText: '举个例子',
          prompt: '请用一个例子解释这段内容。',
          sourceExcerpt: text.substring(match.index, match.index + 150),
          tags: ['example'],
          difficulty: 1,
          qualityScore: 0,
          qualityWarnings: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        cards.push(card)
        break
      }
    }
  }

  return cards
}

/**
 * Try to match misconception patterns
 */
function extractMisconceptionCards(chunk: TextChunk): LearningCard[] {
  const text = chunk.text
  const cards: LearningCard[] = []

  // Pattern: "不是...", "并不意味着...", "常见误解", "does not mean", "misconception"
  const misconceptionPatterns = [
    /(?:不是|并不是|并不意味着|不等于)([^，。？！]+)/g,
    /(?:does not mean|not the same as|misconception|incorrect to think)\s+([^.!?]+)/gi
  ]

  for (const pattern of misconceptionPatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const misconception = match[1].trim()

      if (misconception.length > 5 && misconception.length < 150) {
        const card: LearningCard = {
          id: generateId(),
          sourceId: chunk.id,
          type: 'misconception',
          front: '关于这件事的常见误解是什么？',
          back: misconception,
          glassesText: '常见误解',
          prompt: '请解释为什么这个说法不准确。',
          sourceExcerpt: text.substring(match.index, match.index + 150),
          tags: ['misconception', 'correction'],
          difficulty: 2,
          qualityScore: 0,
          qualityWarnings: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        cards.push(card)
        break
      }
    }
  }

  return cards
}

/**
 * Extract candidate cards from a single chunk
 */
function extractCandidatesFromChunk(chunk: TextChunk): LearningCard[] {
  const candidates: LearningCard[] = []

  // Try each extraction method
  candidates.push(...extractConcepts(chunk))
  candidates.push(...extractWhyCards(chunk))
  candidates.push(...extractStepsCards(chunk))
  candidates.push(...extractContrastCards(chunk))
  candidates.push(...extractExampleCards(chunk))
  candidates.push(...extractMisconceptionCards(chunk))

  // Limit to max 3 per chunk
  return candidates.slice(0, 3)
}

/**
 * Remove near-duplicate cards
 */
function deduplicateCards(cards: LearningCard[]): LearningCard[] {
  const deduped: LearningCard[] = []
  const seen = new Set<string>()

  for (const card of cards) {
    // Use front as primary key
    const key = card.front.toLowerCase().trim()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(card)
  }

  return deduped
}

/**
 * Main card generation function
 */
export async function generateCardsFromText(
  rawText: string,
  options: CardGenerationOptions = {}
): Promise<LearningCard[]> {
  // Normalize
  const normalized = normalizeText(rawText)
  if (normalized.normalized.length === 0) {
    return []
  }

  // Chunk
  const chunks = chunkText(normalized.normalized, {
    maxChunkSizeZh: 200,
    maxChunkSizeEn: 500,
    splitBySentence: true
  })

  if (chunks.length === 0) {
    return []
  }

  // Extract candidates
  let candidates: LearningCard[] = []
  for (const chunk of chunks) {
    const chunkCards = extractCandidatesFromChunk(chunk)
    candidates.push(...chunkCards)
    
    // Stop if we have enough candidates
    if (candidates.length >= (options.maxTotalCards || 40)) {
      break
    }
  }

  // Limit to max candidates
  candidates = candidates.slice(0, options.maxTotalCards || 40)

  if (candidates.length === 0) {
    candidates = generateFallbackCards(normalized.normalized)
  }

  candidates = candidates.map(card => ({
    ...card,
    front: cleanForCardDisplay(card.front),
    back: cleanForCardDisplay(card.back),
    glassesText: cleanForCardDisplay(card.glassesText),
    prompt: cleanForCardDisplay(card.prompt),
    hint: card.hint ? cleanForCardDisplay(card.hint) : undefined,
    sourceExcerpt: cleanForCardDisplay(card.sourceExcerpt)
  }))

  // Score and validate
  candidates = scoreBatch(candidates)

  // Deduplicate
  candidates = deduplicateCards(candidates)

  // Filter by quality if requested
  if (options.removeLoQualityCards) {
    candidates = candidates.filter(c => c.qualityScore >= (options.minQualityScore || 50))
  }

  // Sort by quality score (descending)
  candidates.sort((a, b) => b.qualityScore - a.qualityScore)

  return candidates
}

/**
 * Fallback generator for when patterns don't match
 * Creates simple Q&A cards from paragraphs
 */
export function generateFallbackCards(text: string): LearningCard[] {
  const normalized = normalizeText(text)
  const chunks = chunkByParagraphs(normalized.normalized, 3)
  const cards: LearningCard[] = []

  for (const chunk of chunks.slice(0, 3)) {
    const cleanedText = cleanForCardDisplay(chunk.text)
    if (cleanedText.length >= 12) {
      const firstSentence = cleanedText.split(/[。！？.!?]/).find(Boolean)?.trim() || cleanedText
      const card: LearningCard = {
        id: generateId(),
        sourceId: chunk.id,
        type: 'summary',
        front: `这段内容的核心是什么？`,
        back: cleanedText.substring(0, 200),
        glassesText: cleanForCardDisplay(firstSentence).substring(0, 18) || '核心总结',
        prompt: '请用自己的话总结这段内容。',
        sourceExcerpt: cleanedText,
        tags: ['summary'],
        difficulty: 1,
        qualityScore: 40,
        qualityWarnings: ['too_generic'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      cards.push(card)
    }
  }

  return cards
}
