import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'
import { createLicenseServer } from '../server/license/license-server.mjs'

/** RFC-021: site do Pulse Player (enviar lista, assinar, comprar créditos), servido pelo serviço de licença. */

const SITE = 'server/license/public/site/'
const PAGES = ['index.html', 'assinar.html', 'creditos.html']

describe('núcleo — rotas do site', () => {
  let handle
  beforeEach(async () => {
    const db = openSqlite(':memory:')
    await migrate(db)
    handle = createLicenseHandler({ db, adminToken: 'x', contactUrl: 'https://wa.me/5516992791692' })
  })

  it('o QR da TV (/a/CÓDIGO) leva para Assinar com o código preenchido', async () => {
    const res = await handle(new Request('http://site.test/a/ABCD2345'), '1.1.1.1')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/assinar?codigo=ABCD2345')
  })

  it('código fora do alfabeto não redireciona', async () => {
    expect((await handle(new Request('http://site.test/a/abc%3Cb%3E'), '1.1.1.1')).status).toBe(404)
  })

  it('/v1/site-config entrega preços da tabela e o contato (uma regra só, pricing.mjs)', async () => {
    const res = await handle(new Request('http://site.test/v1/site-config'), '1.1.1.1')
    expect(await res.json()).toEqual({
      contactUrl: 'https://wa.me/5516992791692',
      devicePriceCents: 2500,
      minCredits: 10,
      creditTiers: [
        [1000, 500],
        [500, 600],
        [100, 700],
        [51, 800],
        [20, 900],
        [10, 1000],
      ],
    })
  })
})

describe('servidor local — páginas do site', () => {
  let server
  afterEach(async () => {
    if (server) await new Promise((r) => server.close(r))
    server = null
  })

  it('serve /, /assinar e /creditos com a política de segurança e os arquivos do site', async () => {
    server = createLicenseServer({ dbPath: ':memory:', adminToken: 'x' })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${server.address().port}`
    for (const path of ['/', '/assinar', '/creditos']) {
      const res = await fetch(base + path)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'")
    }
    for (const path of ['/site/site.js', '/site/site.css', '/site/pair-lib.js']) expect((await fetch(base + path)).status).toBe(200)
  })
})

describe('arquivos do site', () => {
  it('a cifra do site é a mesma do pareamento (cópia idêntica de pair-lib.js)', () => {
    expect(readFileSync(`${SITE}pair-lib.js`, 'utf8')).toBe(readFileSync('server/pair/public/pair-lib.js', 'utf8'))
  })

  it.each(PAGES)('%s: sem script embutido, com o aviso legal e as três abas', (page) => {
    const html = readFileSync(SITE + page, 'utf8')
    expect(html).not.toMatch(/<script>|\sstyle=|\son[a-z]+=/)
    expect(html).toContain('Nenhum conteúdo é fornecido, endossado ou vendido')
    for (const href of ['href="/"', 'href="/assinar"', 'href="/creditos"']) expect(html).toContain(href)
  })

  it.each(PAGES)('%s: nada de conteúdo nem de parceria (regra das lojas, RFC-021 R2/R4)', (page) => {
    const text = readFileSync(SITE + page, 'utf8').toLowerCase()
    for (const word of ['canais', 'canal', 'filme', 'série', 'futebol', 'esporte', 'parceir', 'iptv', 'servidor parceiro']) {
      expect(text).not.toContain(word)
    }
  })
})

describe('site.js no navegador', () => {
  const CONFIG = { contactUrl: 'https://wa.me/5516992791692', devicePriceCents: 2500, minCredits: 10, creditTiers: [[1000, 500], [500, 600], [100, 700], [51, 800], [20, 900], [10, 1000]] }

  async function open(page, fetchImpl, search = '') {
    const html = readFileSync(SITE + page, 'utf8')
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*><\/script>/g, '')
    window.history.replaceState({}, '', `/${page}${search}`)
    vi.stubGlobal('fetch', vi.fn(fetchImpl))
    await import('../server/pair/public/pair-lib.js')
    new Function(readFileSync(`${SITE}site.js`, 'utf8'))()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
  }

  const jsonReply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('Enviar lista: cifra para a chave da TV e só manda o texto cifrado, que a TV abre', async () => {
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const tv = await createPairingKeys()
    let sent = null
    await open('index.html', async (url, init) => {
      if (String(url).endsWith('/v1/site-config')) return jsonReply(CONFIG)
      if (String(url).endsWith('/v1/inbox/ABCD2345/key')) return jsonReply({ pub: tv.publicKey })
      sent = JSON.parse(init.body)
      return jsonReply({ sent: true }, 201)
    })
    document.getElementById('code').value = 'abcd 2345'
    document.getElementById('link').value = 'http://servidor.test:8080'
    document.getElementById('user').value = 'joao'
    document.getElementById('pass').value = 'S3nh@'
    document.getElementById('name').value = 'Sala'
    document.getElementById('send-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(sent).not.toBeNull())
    expect(Object.keys(sent)).toEqual(['box'])
    expect(sent.box).not.toContain('S3nh@')
    expect(await tv.open(sent.box, 'ABCD2345')).toEqual({ dns: 'http://servidor.test:8080', username: 'joao', password: 'S3nh@', label: 'Sala' })
    await vi.waitFor(() => expect(document.getElementById('send-status').textContent).toMatch(/Enviado/))
  })

  it('Enviar lista: TV que nunca abriu o app recebe a instrução do servidor', async () => {
    await open('index.html', async (url) =>
      String(url).endsWith('/v1/site-config') ? jsonReply(CONFIG) : jsonReply({ error: 'Código não encontrado. Abra o Pulse Player na TV uma vez (com internet) e tente de novo.' }, 404),
    )
    document.getElementById('code').value = 'ZZZZ9999'
    document.getElementById('link').value = 'http://servidor.test'
    document.getElementById('send-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(document.getElementById('send-status').textContent).toMatch(/Abra o Pulse Player/))
  })

  it('Assinar: código vindo do QR já preenchido; botão do WhatsApp leva o código e o preço', async () => {
    await open('assinar.html', async () => jsonReply(CONFIG), '?codigo=ABCD2345')
    await vi.waitFor(() => expect(document.getElementById('device-price').textContent).toContain('25'))
    expect(document.getElementById('sub-code').value).toBe('ABCD2345')
    document.getElementById('sub-form').dispatchEvent(new Event('submit', { cancelable: true }))
    const link = decodeURIComponent(document.getElementById('sub-whatsapp').href)
    expect(link).toContain('https://wa.me/5516992791692?text=')
    expect(link).toContain('ABCD2345')
  })

  it('Comprar créditos: total pela tabela (20 = R$ 180) e mínimo de 10', async () => {
    await open('creditos.html', async () => jsonReply(CONFIG))
    await vi.waitFor(() => expect(document.getElementById('tier-rows').textContent).toContain('1000'))
    const qty = document.getElementById('credit-qty')
    qty.value = '20'
    qty.dispatchEvent(new Event('input'))
    expect(document.getElementById('credit-total').textContent).toMatch(/180,00/)
    qty.value = '5'
    qty.dispatchEvent(new Event('input'))
    expect(document.getElementById('credit-total').textContent).toMatch(/mínimo de 10/)
  })
})
