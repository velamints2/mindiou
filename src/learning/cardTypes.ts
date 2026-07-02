/**
 * Core Learning Card Types and Interfaces
 * This module defines the unified data structure for learning cards
 */

export type LearningCardType =
  | 'concept'
  | 'why'
  | 'steps'
  | 'contrast'
  | 'example'
  | 'misconception'
  | 'application'
  | 'summary'

export interface LearningCard {
  id: string
  sourceId: string
  deckId?: string

  type: LearningCardType

  front: string
  back: string
  glassesText: string
  prompt: string
  hint?: string

  sourceExcerpt: string
  tags: string[]

  difficulty: 1 | 2 | 3
  qualityScore: number
  qualityWarnings: string[]

  createdAt: string
  updatedAt: string
}

export interface LearningDeck {
  id: string
  name: string
  description?: string
  cards: LearningCard[]
  createdAt: string
  updatedAt: string
  totalWords: number
  sourceTexts: string[]
}

export interface TextChunk {
  id: string
  text: string
  startIndex: number
  endIndex: number
  order: number
}

export interface TextSource {
  id: string
  rawText: string
  normalizedText: string
  chunks: TextChunk[]
  wordCount: number
  createdAt: string
}

export type CardQualityWarning =
  | 'front_too_long'
  | 'back_too_long'
  | 'glasses_text_too_long'
  | 'glasses_text_too_short'
  | 'missing_source_excerpt'
  | 'too_generic'
  | 'duplicate_candidate'
  | 'unclear_question'
  | 'answer_not_grounded'
  | 'too_many_concepts'
  | 'empty_field'
  | 'poor_grammar'

export interface CardGenerationOptions {
  maxCardsPerChunk?: number
  maxTotalCards?: number
  minQualityScore?: number
  language?: 'zh' | 'en' | 'mixed'
  removeLoQualityCards?: boolean
}
