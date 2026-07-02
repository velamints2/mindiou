/**
 * Text chunking for local card generation
 * Splits normalized text into meaningful segments for card generation
 */

import { TextChunk } from './cardTypes'

export interface ChunkingOptions {
  maxChunkSize?: number
  maxChunkSizeZh?: number
  maxChunkSizeEn?: number
  overlapSize?: number
  splitBySentence?: boolean
}

const DEFAULT_MAX_CHUNK_SIZE_ZH = 200 // Chinese characters
const DEFAULT_MAX_CHUNK_SIZE_EN = 500 // English words
const DEFAULT_OVERLAP_SIZE = 50

/**
 * Detect if text is predominantly Chinese
 */
function isChineseText(text: string): boolean {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const totalChars = text.length
  return chineseChars > totalChars * 0.3
}

/**
 * Split Chinese text by sentence (using Chinese punctuation)
 */
function splitChineseSentences(text: string): string[] {
  // Split by Chinese punctuation: 。！？；，、
  const sentences = text.split(/(?<=[。！？；，、])\s*/)
  return sentences.filter(s => s.length > 0)
}

/**
 * Split English text by sentence
 */
function splitEnglishSentences(text: string): string[] {
  // Split by common English sentence endings
  const sentences = text.split(/(?<=[.!?;])\s+/)
  return sentences.filter(s => s.length > 0)
}

/**
 * Split text into sentences, handling mixed language
 */
function splitSentences(text: string): string[] {
  if (isChineseText(text)) {
    const chineseSentences = splitChineseSentences(text)
    if (chineseSentences.length > 1) {
      return chineseSentences
    }
  }
  
  const englishSentences = splitEnglishSentences(text)
  if (englishSentences.length > 1) {
    return englishSentences
  }

  // Fallback: treat whole text as one sentence
  return [text]
}

/**
 * Calculate text length for chunking (accounts for language)
 */
function getTextLength(text: string): number {
  if (isChineseText(text)) {
    // For Chinese, count characters
    return (text.match(/[\u4e00-\u9fa5]/g) || []).length
  }
  // For English, count words
  return (text.match(/[a-zA-Z]+/g) || []).length
}

/**
 * Split text into chunks
 * - Respects sentence boundaries when possible
 * - Handles both Chinese and English text
 * - Supports overlap for context preservation
 */
export function chunkText(
  text: string,
  options: ChunkingOptions = {}
): TextChunk[] {
  const isChinese = isChineseText(text)
  const maxChunkSize = isChinese
    ? options.maxChunkSizeZh || DEFAULT_MAX_CHUNK_SIZE_ZH
    : options.maxChunkSizeEn || DEFAULT_MAX_CHUNK_SIZE_EN

  const overlapSize = options.overlapSize || DEFAULT_OVERLAP_SIZE

  if (!text || text.trim().length === 0) {
    return []
  }

  const sentences = options.splitBySentence !== false ? splitSentences(text) : [text]
  
  const chunks: TextChunk[] = []
  let currentChunk = ''
  let chunkStartIndex = 0
  let globalCharIndex = 0
  let chunkOrder = 0

  for (const sentence of sentences) {
    const sentenceLength = getTextLength(sentence)
    const currentChunkLength = getTextLength(currentChunk)

    if (currentChunkLength + sentenceLength > maxChunkSize && currentChunk.length > 0) {
      // Save current chunk
      const chunkText = currentChunk.trim()
      if (chunkText.length > 0) {
        chunks.push({
          id: `chunk-${chunkOrder}`,
          text: chunkText,
          startIndex: chunkStartIndex,
          endIndex: globalCharIndex,
          order: chunkOrder
        })
        chunkOrder++

        // Prepare overlap for next chunk
        const overlapText = chunkText
          .split(/\s+/)
          .slice(-Math.ceil(overlapSize / 10)) // Rough estimate
          .join(' ')
        currentChunk = overlapText + ' ' + sentence
        chunkStartIndex = Math.max(0, globalCharIndex - overlapText.length)
      }
    } else {
      currentChunk += (currentChunk.length > 0 ? ' ' : '') + sentence
    }

    globalCharIndex += sentence.length + 1 // +1 for space or punctuation
  }

  // Add final chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: `chunk-${chunkOrder}`,
      text: currentChunk.trim(),
      startIndex: chunkStartIndex,
      endIndex: text.length,
      order: chunkOrder
    })
  }

  return chunks
}

/**
 * Split text into paragraphs (for simpler chunking strategy)
 */
export function chunkByParagraphs(text: string, maxParagraphSize = 3): TextChunk[] {
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0)
  
  const chunks: TextChunk[] = []
  let currentChunk = ''
  let currentChunkStartIndex = 0
  let globalIndex = 0
  let order = 0

  for (const para of paragraphs) {
    if (currentChunk.split('\n').length >= maxParagraphSize && currentChunk.length > 0) {
      chunks.push({
        id: `chunk-${order}`,
        text: currentChunk.trim(),
        startIndex: currentChunkStartIndex,
        endIndex: globalIndex,
        order
      })
      order++
      currentChunk = ''
      currentChunkStartIndex = globalIndex
    }

    currentChunk += (currentChunk.length > 0 ? '\n' : '') + para
    globalIndex += para.length + 2 // +2 for paragraph break
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: `chunk-${order}`,
      text: currentChunk.trim(),
      startIndex: currentChunkStartIndex,
      endIndex: text.length,
      order
    })
  }

  return chunks
}
