import { generateCardsFromText } from './learning/localCardGenerator'
import { normalizeText } from './learning/textNormalizer'
import { chunkText } from './learning/textChunker'
import type { LearningCard, LearningDeck, LearningCardType } from './learning/cardTypes'
import './styles.css'

type Tab = 'sources' | 'cards' | 'session'

type AppState = {
  rawText: string
  sourceName: string
  cards: LearningCard[]
  decks: LearningDeck[]
  activeDeckId: string | null
  activeTab: Tab
  selectedType: LearningCardType | 'all'
  sortMode: 'quality' | 'updated'
  sessionIndex: number
  status: string
}

const STORAGE_KEYS = {
  rawText: 'learn-coach-raw-text',
  cards: 'learn-coach-cards',
  decks: 'learn-coach-decks',
  activeDeckId: 'learn-coach-active-deck',
  sessionIndex: 'learn-coach-session-index'
}

const DEFAULT_STATE: AppState = {
  rawText: '',
  sourceName: 'Untitled source',
  cards: [],
  decks: [],
  activeDeckId: null,
  activeTab: 'sources',
  selectedType: 'all',
  sortMode: 'quality',
  sessionIndex: 0,
  status: 'Ready'
}

const state: AppState = loadState()

const appElement = document.querySelector<HTMLDivElement>('#app')
if (!appElement) throw new Error('App root not found')
const app = appElement

function loadState(): AppState {
  const rawText = localStorage.getItem(STORAGE_KEYS.rawText) ?? ''
  const cards = readJson<LearningCard[]>(STORAGE_KEYS.cards, [])
  const decks = readJson<LearningDeck[]>(STORAGE_KEYS.decks, [])
  const activeDeckId = localStorage.getItem(STORAGE_KEYS.activeDeckId)
  const sessionIndex = Number(localStorage.getItem(STORAGE_KEYS.sessionIndex) ?? '0')
  return {
    ...DEFAULT_STATE,
    rawText,
    cards,
    decks,
    activeDeckId,
    sessionIndex: Number.isFinite(sessionIndex) ? sessionIndex : 0
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEYS.rawText, state.rawText)
  localStorage.setItem(STORAGE_KEYS.cards, JSON.stringify(state.cards))
  localStorage.setItem(STORAGE_KEYS.decks, JSON.stringify(state.decks))
  if (state.activeDeckId) localStorage.setItem(STORAGE_KEYS.activeDeckId, state.activeDeckId)
  localStorage.setItem(STORAGE_KEYS.sessionIndex, String(state.sessionIndex))
}

function now() {
  return new Date().toISOString()
}

function deckName() {
  return state.sourceName || 'Untitled deck'
}

function currentDeck(): LearningDeck | null {
  return state.decks.find(deck => deck.id === state.activeDeckId) ?? null
}

function filteredCards(): LearningCard[] {
  let cards = [...state.cards]
  if (state.selectedType !== 'all') {
    cards = cards.filter(card => card.type === state.selectedType)
  }
  if (state.sortMode === 'quality') {
    cards.sort((a, b) => b.qualityScore - a.qualityScore)
  } else {
    cards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  return cards
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]|'/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
}

function shorten(text: string, max = 140) {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function render() {
  const normalized = normalizeText(state.rawText)
  const chunks = normalized.normalized ? chunkText(normalized.normalized) : []
  const deck = currentDeck()
  const sessionCards = deck?.cards ?? state.cards
  const currentSessionCard = sessionCards[state.sessionIndex % Math.max(sessionCards.length, 1)] ?? null

  app.innerHTML = `
    <div class="desktop-shell">
      <header class="desktop-topbar">
        <div>
          <p class="eyebrow">LEARN COACH</p>
          <h1 class="product-title">Local Understanding Coach</h1>
          <p class="subtitle">原文 → 本地清洗 → 本地切块 → 候选卡片 → 质量评分 → 预览/编辑 → 保存 Deck → 学习会话</p>
        </div>
        <div class="topbar-actions">
          <button class="tab ${state.activeTab === 'sources' ? 'is-active' : ''}" data-tab="sources">Sources</button>
          <button class="tab ${state.activeTab === 'cards' ? 'is-active' : ''}" data-tab="cards">Cards</button>
          <button class="tab ${state.activeTab === 'session' ? 'is-active' : ''}" data-tab="session">Session</button>
        </div>
      </header>

      <section class="desktop-status">${escapeHtml(state.status)}</section>

      <section class="desktop-grid">
        <section class="panel ${state.activeTab === 'sources' ? '' : 'hidden'}" data-panel="sources">
          <div class="panel-heading">
            <h2>Sources</h2>
            <div class="panel-meta">字数 ${normalized.wordCount} · 切块 ${chunks.length}</div>
          </div>
          <label class="field">来源名称
            <input id="source-name" value="${escapeHtml(state.sourceName)}" />
          </label>
          <label class="field">粘贴文本
            <textarea id="raw-text" rows="14" placeholder="粘贴原始内容、文章、笔记或 Markdown">${escapeHtml(state.rawText)}</textarea>
          </label>
          <div class="row">
            <input id="file-input" type="file" accept=".txt,.md" />
            <button id="generate-btn" class="primary">Generate Local Cards</button>
          </div>
          <div class="info-grid">
            <div><span>${normalized.wordCount}</span><small>words/chars</small></div>
            <div><span>${chunks.length}</span><small>chunks</small></div>
            <div><span>${state.cards.length}</span><small>cards</small></div>
          </div>
          <div class="excerpt-list">
            ${chunks.slice(0, 6).map(chunk => `<article class="excerpt"><strong>Chunk ${chunk.order + 1}</strong><p>${escapeHtml(shorten(chunk.text, 180))}</p></article>`).join('') || '<p class="muted">暂无切块</p>'}
          </div>
        </section>

        <section class="panel ${state.activeTab === 'cards' ? '' : 'hidden'}" data-panel="cards">
          <div class="panel-heading">
            <h2>Cards</h2>
            <div class="controls">
              <select id="filter-type">
                <option value="all">All types</option>
                ${['concept','why','steps','contrast','example','misconception','application','summary'].map(type => `<option value="${type}" ${state.selectedType === type ? 'selected' : ''}>${type}</option>`).join('')}
              </select>
              <select id="sort-mode">
                <option value="quality" ${state.sortMode === 'quality' ? 'selected' : ''}>Quality</option>
                <option value="updated" ${state.sortMode === 'updated' ? 'selected' : ''}>Updated</option>
              </select>
              <button id="save-deck-btn">Save Deck</button>
              <button id="export-json-btn">Export JSON</button>
              <button id="export-md-btn">Export Markdown</button>
            </div>
          </div>
          <div class="card-list">
            ${filteredCards().map(card => renderCard(card)).join('') || '<p class="muted">暂无卡片。请先生成卡片。</p>'}
          </div>
        </section>

        <section class="panel ${state.activeTab === 'session' ? '' : 'hidden'}" data-panel="session">
          <div class="panel-heading">
            <h2>Session</h2>
            <div class="controls">
              <select id="deck-select">
                <option value="">Use current cards</option>
                ${state.decks.map(deckItem => `<option value="${deckItem.id}" ${deckItem.id === state.activeDeckId ? 'selected' : ''}>${escapeHtml(deckItem.name)}</option>`).join('')}
              </select>
              <button id="prev-card-btn">上一张</button>
              <button id="next-card-btn">下一张</button>
            </div>
          </div>
          ${currentSessionCard ? `
            <article class="session-card">
              <p class="kicker">${escapeHtml(currentSessionCard.type)}</p>
              <h3>${escapeHtml(currentSessionCard.front)}</h3>
              <p class="prompt">${escapeHtml(currentSessionCard.prompt)}</p>
              <p class="answer"><strong>参考答案：</strong>${escapeHtml(currentSessionCard.back)}</p>
              <p class="glasses"><strong>眼镜提示：</strong>${escapeHtml(currentSessionCard.glassesText)}</p>
            </article>
          ` : '<p class="muted">暂无可用 deck。先保存一个 Deck。</p>'}
        </section>
      </section>
    </div>
  `

  bindEvents()
}

function renderCard(card: LearningCard) {
  const warnings = card.qualityWarnings.length ? `<div class="warnings">${card.qualityWarnings.map(w => `<span>${escapeHtml(w)}</span>`).join('')}</div>` : ''
  return `
    <article class="card-item" data-card-id="${card.id}">
      <div class="card-header">
        <strong>${escapeHtml(card.type)}</strong>
        <span class="score">${card.qualityScore}</span>
      </div>
      <label>front <textarea data-field="front">${escapeHtml(card.front)}</textarea></label>
      <label>back <textarea data-field="back">${escapeHtml(card.back)}</textarea></label>
      <label>glassesText <input data-field="glassesText" value="${escapeHtml(card.glassesText)}" /></label>
      <label>prompt <textarea data-field="prompt">${escapeHtml(card.prompt)}</textarea></label>
      <label>hint <input data-field="hint" value="${escapeHtml(card.hint ?? '')}" /></label>
      <div class="excerpt">${escapeHtml(shorten(card.sourceExcerpt, 220))}</div>
      ${warnings}
      <div class="row">
        <button data-action="delete-card">Delete</button>
        <button data-action="keep-card">Keep</button>
      </div>
    </article>
  `
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(btn => {
    btn.onclick = () => {
      state.activeTab = btn.dataset.tab as Tab
      render()
    }
  })

  const sourceName = document.querySelector<HTMLInputElement>('#source-name')
  if (sourceName) {
    sourceName.oninput = () => {
      state.sourceName = sourceName.value
      saveState()
    }
  }

  const rawText = document.querySelector<HTMLTextAreaElement>('#raw-text')
  if (rawText) {
    rawText.oninput = () => {
      state.rawText = rawText.value
      saveState()
      render()
    }
  }

  const fileInput = document.querySelector<HTMLInputElement>('#file-input')
  if (fileInput) {
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0]
      if (!file) return
      state.rawText = await file.text()
      state.sourceName = file.name
      saveState()
      render()
    }
  }

  const generateBtn = document.querySelector<HTMLButtonElement>('#generate-btn')
  if (generateBtn) {
    generateBtn.onclick = async () => {
      state.status = 'Generating local cards...'
      render()
      const cards = await generateCardsFromText(state.rawText, { maxTotalCards: 40, removeLoQualityCards: false })
      state.cards = cards
      state.status = `Generated ${cards.length} cards locally`
      saveState()
      state.activeTab = 'cards'
      render()
    }
  }

  const filterType = document.querySelector<HTMLSelectElement>('#filter-type')
  if (filterType) {
    filterType.onchange = () => {
      state.selectedType = filterType.value as AppState['selectedType']
      render()
    }
  }

  const sortMode = document.querySelector<HTMLSelectElement>('#sort-mode')
  if (sortMode) {
    sortMode.onchange = () => {
      state.sortMode = sortMode.value as AppState['sortMode']
      render()
    }
  }

  document.querySelectorAll<HTMLElement>('.card-item').forEach(cardEl => {
    const cardId = cardEl.dataset.cardId!
    const card = state.cards.find(item => item.id === cardId)
    if (!card) return

    cardEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]').forEach(field => {
      field.oninput = () => {
        const key = field.dataset.field as keyof LearningCard
        if (key === 'hint') {
          card.hint = (field as HTMLInputElement).value
        } else if (key === 'front' || key === 'back' || key === 'glassesText' || key === 'prompt') {
          card[key] = field.value as never
        }
        card.updatedAt = now()
        saveState()
        render()
      }
    })

    cardEl.querySelector<HTMLButtonElement>('[data-action="delete-card"]')?.addEventListener('click', () => {
      state.cards = state.cards.filter(item => item.id !== cardId)
      saveState()
      render()
    })
  })

  const saveDeckBtn = document.querySelector<HTMLButtonElement>('#save-deck-btn')
  if (saveDeckBtn) saveDeckBtn.onclick = () => {
    const deck: LearningDeck = {
      id: `deck-${Date.now()}`,
      name: deckName(),
      cards: [...state.cards],
      createdAt: now(),
      updatedAt: now(),
      totalWords: normalizeText(state.rawText).wordCount,
      sourceTexts: [state.rawText]
    }
    state.decks = [deck, ...state.decks.filter(d => d.id !== deck.id)]
    state.activeDeckId = deck.id
    state.sessionIndex = 0
    state.status = `Saved deck ${deck.name}`
    saveState()
    render()
  }

  const exportJsonBtn = document.querySelector<HTMLButtonElement>('#export-json-btn')
  if (exportJsonBtn) exportJsonBtn.onclick = () => {
    const blob = new Blob([JSON.stringify({ sourceName: state.sourceName, cards: state.cards }, null, 2)], { type: 'application/json' })
    downloadBlob(blob, `${slugify(state.sourceName)}.json`)
  }

  const exportMdBtn = document.querySelector<HTMLButtonElement>('#export-md-btn')
  if (exportMdBtn) exportMdBtn.onclick = () => {
    const md = state.cards.map(card => `## ${card.front}\n\n- type: ${card.type}\n- back: ${card.back}\n- glassesText: ${card.glassesText}\n- prompt: ${card.prompt}\n- source: ${card.sourceExcerpt}`).join('\n\n')
    downloadBlob(new Blob([md], { type: 'text/markdown' }), `${slugify(state.sourceName)}.md`)
  }

  const deckSelect = document.querySelector<HTMLSelectElement>('#deck-select')
  if (deckSelect) deckSelect.onchange = e => {
    const value = (e.target as HTMLSelectElement).value
    state.activeDeckId = value || null
    state.sessionIndex = 0
    saveState()
    render()
  }

  const prevCardBtn = document.querySelector<HTMLButtonElement>('#prev-card-btn')
  if (prevCardBtn) prevCardBtn.onclick = () => {
    const deck = currentDeck()
    const cards = deck?.cards ?? state.cards
    if (cards.length === 0) return
    state.sessionIndex = (state.sessionIndex - 1 + cards.length) % cards.length
    saveState()
    render()
  }

  const nextCardBtn = document.querySelector<HTMLButtonElement>('#next-card-btn')
  if (nextCardBtn) nextCardBtn.onclick = () => {
    const deck = currentDeck()
    const cards = deck?.cards ?? state.cards
    if (cards.length === 0) return
    state.sessionIndex = (state.sessionIndex + 1) % cards.length
    saveState()
    render()
  }
}

function slugify(text: string) {
  return text.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'learn-coach-deck'
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

render()
