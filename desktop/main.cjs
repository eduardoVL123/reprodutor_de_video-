// App de PC (RFC-024): o mesmo build das TVs (dist/, script clássico por file://) numa janela do Electron.
const { app, BrowserWindow, session, shell, ipcMain } = require('electron')
const { execFile } = require('node:child_process')
const path = require('node:path')

const PARTITION = 'persist:pulse'
const INDEX = path.join(__dirname, '..', 'dist', 'index.html')

/**
 * Servidores Xtream quase nunca mandam CORS. Como o MainActivity do APK, o app lê as respostas sem CORS: aqui os
 * cabeçalhos são acrescentados na resposta (nunca `webSecurity: false`, que desligaria a proteção da página toda).
 * Preflight (OPTIONS) vira 204, porque muitos painéis respondem 404/405 a ele.
 */
function allowCors(ses) {
  ses.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const headers = {}
    for (const [name, value] of Object.entries(details.responseHeaders || {})) {
      if (!/^access-control-/i.test(name)) headers[name] = value
    }
    headers['Access-Control-Allow-Origin'] = ['*']
    headers['Access-Control-Allow-Headers'] = ['*']
    headers['Access-Control-Allow-Methods'] = ['GET, POST, HEAD, OPTIONS']
    headers['Access-Control-Expose-Headers'] = ['Content-Length, Content-Range']
    const preflight = details.method === 'OPTIONS'
    callback({ responseHeaders: headers, ...(preflight ? { statusLine: 'HTTP/1.1 204 No Content' } : {}) })
  })
}

/** MachineGuid do Windows: sobrevive a reinstalar o app. Vai cru só até o preload; o app guarda apenas o hash. */
function machineGuid() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('')
    execFile('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true }, (err, out) => {
      const match = !err && /MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i.exec(String(out))
      resolve(match ? match[1] : '')
    })
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#0b0f0c',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.removeMenu()

  // A janela nunca sai do app: links externos (WhatsApp, planos) abrem no navegador do sistema.
  const openOutside = (url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return
    event.preventDefault()
    openOutside(url)
  })

  // F11: tela cheia (no PC não há tecla de TV para isso).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault()
      win.setFullScreen(!win.isFullScreen())
    }
  })

  win.loadFile(INDEX)
  return win
}

ipcMain.handle('pulse:machineId', () => machineGuid())
ipcMain.on('pulse:exit', () => app.quit())

app.whenReady().then(() => {
  allowCors(session.fromPartition(PARTITION))
  createWindow()
})

app.on('window-all-closed', () => app.quit())

module.exports = { allowCors } // para o teste (tests/desktopCors.test.js); o Electron ignora o export
