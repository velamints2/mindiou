/**
 * Card quality scoring and validation
 * Implements quality checks to identify and filter low-quality cards
 */

import { LearningCard, CardQualityWarning } from './cardTypes'

export interface QualityCheckResult {
  score: number // 0-100
  warnings: CardQualityWarning[]
  isPassable: boolean // Can be kept with warnings
}

// Length constraints
const LIMITS = {
  front: {
    zh: { min: 4, max: 32 },
    en: { min: 5, max: 90 }
  },
  back: {
    zh: { min: 10, max: 160 },
    en: { min: 15, max: 320 }
  },
  glassesText: {
    zh: { min: 6, max: 18 },
    en: { min: 2, max: 7 } // word count
  },
  prompt: {
    zh: { min: 8, max: 100 },
    en: { min: 10, max: 150 }
  },
  sourceExcerpt: {
    min: 5,
    max: 500
  }
}

/**
 * Detect language of text
 */
function getLanguage(text: string): 'zh' | 'en' {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  return chineseChars > text.length * 0.3 ? 'zh' : 'en'
}

/**
 * Count meaningful length
 * - Chinese: character count
 * - English: word count
 */
function measureLength(text: string, language?: 'zh' | 'en'): number {
  const lang = language || getLanguage(text)
  
  if (lang === 'zh') {
    return (text.match(/[\u4e00-\u9fa5]/g) || []).length
  } else {
    return (text.match(/[a-zA-Z]+/g) || []).length
  }
}

/**
 * Check if field is empty or only whitespace
 */
function isEmpty(text?: string): boolean {
  return !text || text.trim().length === 0
}

/**
 * Check for generic phrases that lack specific content
 */
function isGeneric(text: string): boolean {
  const genericPatterns = [
    /^(这个|那个|这是|那是|一些|等等|各种|多个)$/,
    /^(thing|stuff|like|etc|various|several)$/i,
    /^(是什么|有什么|怎么样|什么意思)$/,
    /^(what|how|why|when|where)$/i
  ]

  for (const pattern of genericPatterns) {
    if (pattern.test(text.trim())) {
      return true
    }
  }

  // If text is mostly question words, it's too generic
  const contentWords = text.match(/[\u4e00-\u9fa5a-zA-Z]+/g) || []
  if (contentWords.length < 3) {
    return true
  }

  return false
}

/**
 * Check for duplicate content
 * Compares with existing cards
 */
export function findDuplicates(card: LearningCard, existing: LearningCard[]): LearningCard[] {
  const duplicates: LearningCard[] = []

  for (const other of existing) {
    // Exact front match
    if (card.front.trim() === other.front.trim()) {
      duplicates.push(other)
      continue
    }

    // Very similar glassesText (>90% match)
    if (similarityScore(card.glassesText, other.glassesText) > 0.9) {
      duplicates.push(other)
      continue
    }

    // Highly overlapping sourceExcerpt (>80% overlap)
    if (excerptOverlap(card.sourceExcerpt, other.sourceExcerpt) > 0.8) {
      duplicates.push(other)
      continue
    }
  }

  return duplicates
}

/**
 * Calculate string similarity (0-1)
 * Simple implementation using character overlap
 */
function similarityScore(a: string, b: string): number {
  if (!a || !b) return 0
  
  const aLower = a.toLowerCase().trim()
  const bLower = b.toLowerCase().trim()
  
  if (aLower === bLower) return 1
  
  const minLength = Math.min(aLower.length, bLower.length)
  if (minLength === 0) return 0
  
  let matches = 0
  for (let i = 0; i < minLength; i++) {
    if (aLower[i] === bLower[i]) matches++
  }
  
  return matches / Math.max(aLower.length, bLower.length)
}

/**
 * Calculate text overlap ratio
 */
function excerptOverlap(a: string, b: string): number {
  if (!a || !b) return 0
  
  const aWords = new Set(a.toLowerCase().match(/[\u4e00-\u9fa5a-z]+/gi) || [])
  const bWords = new Set(b.toLowerCase().match(/[\u4e00-\u9fa5a-z]+/gi) || [])
  
  if (aWords.size === 0 || bWords.size === 0) return 0
  
  let overlap = 0
  for (const word of aWords) {
    if (bWords.has(word)) overlap++
  }
  
  return overlap / Math.max(aWords.size, bWords.size)
}

/**
 * Check front field quality
 */
function checkFront(card: LearningCard): CardQualityWarning[] {
  const warnings: CardQualityWarning[] = []
  const lang = getLanguage(card.front)
  
  if (isEmpty(card.front)) {
    warnings.push('empty_field')
    return warnings
  }
  
  const length = measureLength(card.front, lang)
  const limit = LIMITS.front[lang]
  
  if (length < limit.min || length > limit.max) {
    warnings.push('front_too_long')
  }
  
  if (isGeneric(card.front)) {
    warnings.push('too_generic')
  }
  
  // Check if it's a proper question
  if (!card.front.includes('?') && !card.front.includes('？')) {
    if (!card.front.match(/^(什么|如何|为什么|谁|哪里|为什么|解释|说明)/)) {
      warnings.push('unclear_question')
    }
  }
  
  return warnings
}

/**
 * Check back field quality
 */
function checkBack(card: LearningCard): CardQualityWarning[] {
  const warnings: CardQualityWarning[] = []
  const lang = getLanguage(card.back)
  
  if (isEmpty(card.back)) {
    warnings.push('empty_field')
    return warnings
  }
  
  const length = measureLength(card.back, lang)
  const limit = LIMITS.back[lang]
  
  if (length < limit.min || length > limit.max) {
    warnings.push('back_too_long')
  }
  
  // Check if back is grounded in sourceExcerpt
  if (!isEmpty(card.sourceExcerpt)) {
    const backWords = (card.back.match(/[\u4e00-\u9fa5a-z]+/gi) || []).slice(0, 5)
    const excerptLower = card.sourceExcerpt.toLowerCase()
    
    let foundWords = 0
    for (const word of backWords) {
      if (excerptLower.includes(word.toLowerCase())) {
        foundWords++
      }
    }
    
    if (foundWords === 0) {
      warnings.push('answer_not_grounded')
    }
  }
  
  return warnings
}

/**
 * Check glassesText field quality
 */
function checkGlassesText(card: LearningCard): CardQualityWarning[] {
  const warnings: CardQualityWarning[] = []
  const lang = getLanguage(card.glassesText)
  
  if (isEmpty(card.glassesText)) {
    warnings.push('empty_field')
    return warnings
  }
  
  const length = lang === 'zh'
    ? measureLength(card.glassesText, 'zh')
    : (card.glassesText.match(/[a-zA-Z]+/g) || []).length
  
  const limit = LIMITS.glassesText[lang]
  
  if (length < limit.min) {
    warnings.push('glasses_text_too_short')
  }
  if (length > limit.max) {
    warnings.push('glasses_text_too_long')
  }
  
  // Check that it's not just copied from back
  if (similarityScore(card.glassesText, card.back) > 0.8) {
    warnings.push('glasses_text_too_long') // Effectively too long in spirit
  }
  
  return warnings
}

/**
 * Check prompt field quality
 */
function checkPrompt(card: LearningCard): CardQualityWarning[] {
  const warnings: CardQualityWarning[] = []
  const lang = getLanguage(card.prompt)
  
  if (isEmpty(card.prompt)) {
    warnings.push('empty_field')
    return warnings
  }
  
  const length = measureLength(card.prompt, lang)
  const limit = LIMITS.prompt[lang]
  
  if (length < limit.min || length > limit.max) {
    warnings.push('too_generic') // Prompt too constrained or too open
  }
  
  return warnings
}

/**
 * Check sourceExcerpt field quality
 */
function checkSourceExcerpt(card: LearningCard): CardQualityWarning[] {
  const warnings: CardQualityWarning[] = []
  
  if (isEmpty(card.sourceExcerpt)) {
    warnings.push('missing_source_excerpt')
    return warnings
  }
  
  const length = card.sourceExcerpt.length
  if (length < LIMITS.sourceExcerpt.min || length > LIMITS.sourceExcerpt.max) {
    warnings.push('answer_not_grounded') // Poor excerpt
  }
  
  return warnings
}

/**
 * Perform comprehensive quality check on a card
 */
export function checkCardQuality(card: LearningCard): QualityCheckResult {
  const warnings: CardQualityWarning[] = []
  let score = 100

  // Check each field
  const frontWarnings = checkFront(card)
  const backWarnings = checkBack(card)
  const glassesWarnings = checkGlassesText(card)
  const promptWarnings = checkPrompt(card)
  const excerptWarnings = checkSourceExcerpt(card)

  warnings.push(...frontWarnings, ...backWarnings, ...glassesWarnings, ...promptWarnings, ...excerptWarnings)

  // Deduct score for each warning
  for (const warning of warnings) {
    switch (warning) {
      case 'empty_field':
        score -= 30
        break
      case 'missing_source_excerpt':
      case 'answer_not_grounded':
        score -= 20
        break
      case 'front_too_long':
      case 'back_too_long':
      case 'glasses_text_too_long':
      case 'glasses_text_too_short':
        score -= 10
        break
      case 'too_generic':
      case 'unclear_question':
      case 'duplicate_candidate':
        score -= 15
        break
      case 'too_many_concepts':
        score -= 12
        break
      case 'poor_grammar':
        score -= 5
        break
    }
  }

  // Bonus for good practices
  if (card.sourceExcerpt && card.sourceExcerpt.length > 10) {
    score += 5
  }
  if (card.hint) {
    score += 3
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score))

  return {
    score,
    warnings: [...new Set(warnings)], // Remove duplicates
    isPassable: score >= 30 || warnings.length <= 2 // Allow some warnings
  }
}

/**
 * Filter and score a batch of cards
 */
export function scoreBatch(cards: LearningCard[]): LearningCard[] {
  return cards.map(card => {
    const result = checkCardQuality(card)
    return {
      ...card,
      qualityScore: result.score,
      qualityWarnings: result.warnings
    }
  })
}
