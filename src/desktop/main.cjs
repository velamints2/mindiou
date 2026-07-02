/**
 * Desktop application main process
 * Handles window creation and Electron lifecycle
 */

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let mainWindow

const isDev = process.env.NODE_ENV === 'development'

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false
    }
  })

  const startUrl = isDev
    ? 'http://localhost:5175/desktop.html'
    : `file://${path.join(__dirname, '../../dist/desktop.html')}`

  mainWindow.loadURL(startUrl)

  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('ready', createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// IPC handlers for card generation
ipcMain.handle('generate-cards', async (event, text, options) => {
  try {
    const { generateCardsFromText } = await import('../learning/localCardGenerator.js')
    const cards = await generateCardsFromText(text, options)
    return { success: true, cards }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// IPC handlers for text chunking info
ipcMain.handle('get-chunk-info', async (event, text) => {
  try {
    const { normalizeText } = await import('../learning/textNormalizer.js')
    const { chunkText } = await import('../learning/textChunker.js')
    
    const normalized = normalizeText(text)
    const chunks = chunkText(normalized.normalized)
    
    return {
      success: true,
      wordCount: normalized.wordCount,
      chunkCount: chunks.length,
      language: normalized.language
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})
