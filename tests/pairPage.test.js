import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { newTv } from './helpers/pairTv.js'

/** Página do celular (RFC-016): o fluxo completo contra um servidor falso, com a cifra de verdade. */

const HTML = readFileSync('server/pair/public/index.html', 'utf8')

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  history.pushState({}, '', '/')
})

function reply(status, json) {
  return { ok: status >= 200 && status < 300, status, json: async () => json ?? {} }
}

async function openPage({ path = '/K7M2QP', language = 'pt-BR', fetchImpl } = {}) {
  document.body.innerHTML = new DOMParser().parseFromString(HTML, 'text/html').body.innerHTML
  history.pushState({}, '', path)
  Object.defineProperty(navigator, 'language', { value: language, configurable: true })
  const fetchMock = vi.fn(fetchImpl)
  vi.stubGlobal('fetch', fetchMock)
  await import('../server/pair/public/pair-lib.js')
  await import('../server/pair/public/app.js')
  const $ = (id) => document.getElementById(id)
  return { $, fetchMock }
}

async function fill($, { code, link, user = '', pass = '', name = '' }) {
  const set = (id, value) => {
    $(id).value = value
    $(id).dispatchEvent(new Event('input', { bubbles: true }))
  }
  if (code !== undefined) set('code', code)
  set('link', link ?? '')
  set('user', user)
  set('pass', pass)
  set('name', name)
}

/** Envia o formulário e espera o fim do envio: o botão volta a abrir e há uma mensagem ou a tela "Enviado!". */
async function submit($) {
  $('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => {
    expect($('send').disabled).toBe(false)
    expect($('msg').textContent !== '' || !$('done').hidden).toBe(true)
  })
}

describe('página do celular', () => {
  it('abre com o código do endereço já preenchido', async () => {
    const { $ } = await openPage({ fetchImpl: async () => reply(404) })

    expect($('code').value).toBe('K7M2QP')
  })

  it('envia a lista cifrada para a TV e mostra "Enviado!"', async () => {
    const tv = await newTv()
    let posted = null
    const { $, fetchMock } = await openPage({
      fetchImpl: async (url, init) => {
        if (init && init.method === 'POST') {
          posted = JSON.parse(init.body)
          return reply(204)
        }
        return reply(200, { pub: tv.pub })
      },
    })
    await fill($, {
      link: 'Sua lista: http://srv.com/get.php?username=a&password=b&type=m3u_plus obrigado',
      user: 'ana',
      pass: 'segredo',
      name: 'Casa',
    })

    await submit($)

    expect(fetchMock.mock.calls[0][0]).toBe('/v1/sessions/K7M2QP')
    expect(fetchMock.mock.calls[1][0]).toBe('/v1/sessions/K7M2QP/payload')
    expect(fetchMock.mock.calls[1][1].headers['Content-Type']).toBe('application/json')
    expect(JSON.stringify(posted)).not.toContain('srv.com')
    expect(await tv.open(posted.box, 'K7M2QP')).toEqual({
      dns: 'http://srv.com/get.php?username=a&password=b&type=m3u_plus',
      username: 'ana',
      password: 'segredo',
      label: 'Casa',
    })
    expect($('done').hidden).toBe(false)
    expect($('form').hidden).toBe(true)
    expect($('done').textContent).toContain('Enviado!')
  })

  it('aceita o código digitado em minúsculas e com hífen', async () => {
    const tv = await newTv()
    const { $, fetchMock } = await openPage({ path: '/', fetchImpl: async (_u, init) => (init && init.method === 'POST' ? reply(204) : reply(200, { pub: tv.pub })) })
    await fill($, { code: 'k7m-2qp', link: 'http://srv.com/lista.m3u' })

    await submit($)

    expect(fetchMock.mock.calls[0][0]).toBe('/v1/sessions/K7M2QP')
  })

  it('código com menos de 6 letras: avisa e não chama o servidor', async () => {
    const { $, fetchMock } = await openPage({ path: '/', fetchImpl: async () => reply(200, {}) })
    await fill($, { code: 'K7M', link: 'http://srv.com/lista.m3u' })

    await submit($)

    expect($('msg').textContent).toContain('6 letras')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sem link no texto colado: avisa e não chama o servidor', async () => {
    const { $, fetchMock } = await openPage({ fetchImpl: async () => reply(200, {}) })
    await fill($, { link: 'bom dia, tudo bem?' })

    await submit($)

    expect($('msg').textContent).toContain('Cole o link')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('código que não existe: avisa, não envia nada e libera o botão', async () => {
    const { $, fetchMock } = await openPage({ fetchImpl: async () => reply(404) })
    await fill($, { link: 'http://srv.com/lista.m3u' })

    await submit($)

    expect($('msg').textContent).toContain('Código não encontrado')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect($('send').disabled).toBe(false)
    expect($('done').hidden).toBe(true)
  })

  it.each([
    ['segundo envio (409)', 409, 'já recebeu'],
    ['código expirou durante o envio (404)', 404, 'Código não encontrado'],
    ['muitas tentativas (429)', 429, 'Muitas tentativas'],
    ['erro do servidor (500)', 500, 'Algo deu errado'],
  ])('falha no envio: %s', async (_nome, status, texto) => {
    const tv = await newTv()
    const { $ } = await openPage({ fetchImpl: async (_u, init) => (init && init.method === 'POST' ? reply(status) : reply(200, { pub: tv.pub })) })
    await fill($, { link: 'http://srv.com/lista.m3u' })

    await submit($)

    expect($('msg').textContent).toContain(texto)
    expect($('done').hidden).toBe(true)
    expect($('send').disabled).toBe(false)
  })

  it('sem conexão: avisa e libera o botão', async () => {
    const { $ } = await openPage({ fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
    await fill($, { link: 'http://srv.com/lista.m3u' })

    await submit($)

    expect($('msg').textContent).toContain('Sem conexão')
    expect($('send').disabled).toBe(false)
  })

  it('link grande demais: avisa antes de enviar', async () => {
    const tv = await newTv()
    const { $, fetchMock } = await openPage({ fetchImpl: async () => reply(200, { pub: tv.pub }) })
    await fill($, { link: `http://srv.com/${'a'.repeat(2100)}` })

    await submit($)

    expect($('msg').textContent).toContain('grande demais')
    expect(fetchMock.mock.calls.every(([, init]) => !init || init.method !== 'POST')).toBe(true)
  })

  it('navegador sem WebCrypto: explica e não deixa enviar', async () => {
    vi.stubGlobal('crypto', {})
    const { $ } = await openPage({ fetchImpl: async () => reply(200, {}) })

    expect($('msg').textContent).toContain('https')
    expect($('send').disabled).toBe(true)
  })

  it('mostra a página em inglês quando o celular está em inglês', async () => {
    const { $ } = await openPage({ language: 'en-US', fetchImpl: async () => reply(404) })

    expect($('send').textContent).toBe('Send to TV')
    expect(document.documentElement.lang).toBe('en')
  })

  it('é só HTML, CSS e JS próprios: nada de recursos externos', () => {
    expect(HTML).not.toMatch(/(src|href)="https?:\/\//)
    expect(HTML).not.toMatch(/<script>|<style>|onclick=/)
  })
})
