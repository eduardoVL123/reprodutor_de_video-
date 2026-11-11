import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

/**
 * App de PC (RFC-024): o desktop/main.cjs acrescenta CORS nas respostas dos servidores de lista. Sem isso nenhuma
 * lista abre no PC (auditoria 2026-11-11, item 4). O main.cjs roda com um Electron falso: só o que ele usa ao carregar.
 */
const require = createRequire(import.meta.url)

function loadMain() {
  const fakeElectron = {
    app: { whenReady: () => new Promise(() => {}), on: () => {}, quit: () => {} },
    BrowserWindow: function () {},
    session: {},
    shell: {},
    ipcMain: { handle: () => {}, on: () => {} },
  }
  require.cache[require.resolve('electron')] = { exports: fakeElectron, loaded: true }
  const path = require.resolve('../desktop/main.cjs')
  delete require.cache[path]
  return require(path)
}

/** Sessão falsa: guarda o filtro e o callback que o main.cjs registra. */
function fakeSession() {
  const ses = { webRequest: { onHeadersReceived: (filter, listener) => Object.assign(ses, { filter, listener }) } }
  return ses
}

function respond(ses, details) {
  return new Promise((resolve) => ses.listener(details, resolve))
}

describe('CORS do app de PC', () => {
  it('vale para http e https (as listas quase sempre são http)', () => {
    const ses = fakeSession()
    loadMain().allowCors(ses)
    expect(ses.filter.urls).toEqual(['http://*/*', 'https://*/*'])
  })

  it('libera a leitura da resposta e troca o CORS do servidor pelo do app', async () => {
    const ses = fakeSession()
    loadMain().allowCors(ses)
    const { responseHeaders, statusLine } = await respond(ses, {
      method: 'GET',
      responseHeaders: { 'Content-Type': ['application/json'], 'access-control-allow-origin': ['https://outro.site'] },
    })
    expect(statusLine).toBeUndefined()
    expect(responseHeaders['Content-Type']).toEqual(['application/json'])
    expect(responseHeaders['access-control-allow-origin']).toBeUndefined()
    expect(responseHeaders['Access-Control-Allow-Origin']).toEqual(['*'])
    expect(responseHeaders['Access-Control-Expose-Headers']).toEqual(['Content-Length, Content-Range'])
  })

  it('pré-voo (OPTIONS) vira 204: muitos painéis respondem 404/405 a ele', async () => {
    const ses = fakeSession()
    loadMain().allowCors(ses)
    const { statusLine } = await respond(ses, { method: 'OPTIONS', responseHeaders: {} })
    expect(statusLine).toBe('HTTP/1.1 204 No Content')
  })
})
