/**
 * Text normalization for learning card generation
 * Handles encoding, whitespace, and format standardization
 */

export interface NormalizedText {
  original: string
  normalized: string
  wordCount: number
  language: 'zh' | 'en' | 'mixed'
}

/**
 * Detect language of text
 */
function detectLanguage(text: string): 'zh' | 'en' | 'mixed' {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const englishLetters = (text.match(/[a-zA-Z]/g) || []).length
  const semanticChars = chineseChars + englishLetters

  if (chineseChars > 0 && englishLetters > 0 && englishLetters / Math.max(1, semanticChars) >= 0.12) {
    return 'mixed'
  }
  return chineseChars > englishLetters ? 'zh' : 'en'
}

/**
 * Count meaningful words in text
 */
function countWords(text: string): number {
  const language = detectLanguage(text)
  
  if (language === 'zh') {
    // Chinese: count characters, not words
    return (text.match(/[\u4e00-\u9fa5]/g) || []).length
  } else if (language === 'mixed') {
    // Mixed: count Chinese characters + English words
    const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length
    const englishCount = (text.match(/[a-zA-Z]+/g) || []).length
    return chineseCount + englishCount
  } else {
    // English: count words
    return (text.match(/[a-zA-Z]+/g) || []).length
  }
}

/**
 * Normalize text:
 * - Remove extra whitespace
 * - Normalize line breaks
 * - Remove BOM
 * - Normalize Unicode
 */
export function normalizeText(rawText: string): NormalizedText {
  if (!rawText || typeof rawText !== 'string') {
    return {
      original: '',
      normalized: '',
      wordCount: 0,
      language: 'en'
    }
  }

  // Remove BOM
  let text = rawText.replace(/^\ufeff/, '')

  // Normalize line breaks: convert \r\n and \r to \n
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Normalize spaces: remove trailing/leading whitespace on each line
  text = text
    .split('\n')
    .map(line => line
      .replace(/^\s+|\s+$/g, '')
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*•]\s+/, '')
    )
    .filter(line => line.length > 0)
    .join('\n')

  // Remove excessive blank lines (more than 2 consecutive)
  text = text.replace(/\n{3,}/g, '\n\n')

  // Normalize multiple spaces to single space (but keep significant spacing)
  text = text.replace(/  +/g, ' ')

  // Trim leading/trailing whitespace
  text = text.trim()

  const language = detectLanguage(text)
  const wordCount = countWords(text)

  return {
    original: rawText,
    normalized: text,
    wordCount,
    language
  }
}

/**
 * Extract main paragraphs (skip headers, empty lines, etc)
 */
export function extractParagraphs(text: string): string[] {
  const lines = text.split('\n')
  const paragraphs: string[] = []
  let currentParagraph = ''

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip markdown headers
    if (trimmed.startsWith('#')) {
      if (currentParagraph.trim()) {
        paragraphs.push(currentParagraph.trim())
        currentParagraph = ''
      }
      continue
    }

    // Skip list markers at start (will be preserved in chunks)
    const isListItem = /^[-*•]\s/.test(trimmed) || /^[0-9]+\.\s/.test(trimmed)

    if (trimmed.length === 0) {
      if (currentParagraph.trim()) {
        paragraphs.push(currentParagraph.trim())
        currentParagraph = ''
      }
    } else {
      currentParagraph += (currentParagraph ? ' ' : '') + trimmed
    }
  }

  if (currentParagraph.trim()) {
    paragraphs.push(currentParagraph.trim())
  }

  return paragraphs
}

/**
 * Clean text for card display
 * Remove markdown, excessive punctuation, etc
 */
export function cleanForCardDisplay(text: string): string {
  if (!text) return ''

  // Remove markdown links [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // Remove markdown emphasis **text** -> text, *text* -> text
  text = text.replace(/\*\*([^\*]+)\*\*/g, '$1')
  text = text.replace(/\*([^\*]+)\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')

  // Remove markdown code blocks
  text = text.replace(/```[\s\S]*?```/g, '')
  text = text.replace(/`([^`]+)`/g, '$1')

  // Remove remaining heading and list markers.
  text = text.replace(/(^|\s)#{1,6}\s*/g, '$1')
  text = text.replace(/(^|\s)[-*•]\s+/g, '$1')

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim()

  return text
}
