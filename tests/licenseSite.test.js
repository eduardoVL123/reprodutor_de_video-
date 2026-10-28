import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'
import { createLicenseServer } from '../server/license/license-server.mjs'
import { PAGE_CSP } from '../server/pair/pair-core.mjs'
import { PAY_CSP } from '../server/license/license-checkout.mjs'

/** RFC-021: site do Pulse Player (enviar lista, assinar, comprar créditos), servido pelo serviço de licença. */

const SITE = 'server/license/public/site/'
const PAGES = ['index.html', 'assinar.html', 'creditos.html', 'pagar.html']

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

  it('/v1/mp-config entrega a chave pública do cartão sem cache; sem chave, 503 com o motivo', async () => {
    const missing = await handle(new Request('http://site.test/v1/mp-config'), '1.1.1.1')
    expect(missing.status).toBe(503)
    expect((await missing.json()).error).toMatch(/MP_PUBLIC_KEY/)
    const db = openSqlite(':memory:')
    await migrate(db)
    const withKey = createLicenseHandler({ db, mpPublicKey: 'APP_USR-chave-publica' })
    const res = await withKey(new Request('http://site.test/v1/mp-config'), '1.1.1.1')
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0')
    expect(await res.json()).toEqual({ publicKey: 'APP_USR-chave-publica' })
  })

  it('código fora do alfabeto não redireciona', async () => {
    expect((await handle(new Request('http://site.test/a/abc%3Cb%3E'), '1.1.1.1')).status).toBe(404)
  })

  it('/v1/site-config entrega preços da tabela e o contato (uma regra só, pricing.mjs)', async () => {
    const res = await handle(new Request('http://site.test/v1/site-config'), '1.1.1.1')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({
      payments: false,
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
      expect(res.headers.get('Content-Security-Policy')).toBe(PAGE_CSP)
    }
    for (const path of ['/site/site.js', '/site/site.css', '/site/pair-lib.js', '/site/pagar.js']) expect((await fetch(base + path)).status).toBe(200)
  })

  it('serve /pagar com a política própria do pagamento (SDK e QR do Mercado Pago), sem afrouxar as outras', async () => {
    server = createLicenseServer({ dbPath: ':memory:', adminToken: 'x' })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const res = await fetch(`http://127.0.0.1:${server.address().port}/pagar`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('form-checkout')
    expect(res.headers.get('Content-Security-Policy')).toBe(PAY_CSP)
    // Script embutido só na /pagar (identificação do aparelho do SDK); as outras páginas seguem fechadas.
    expect(PAY_CSP).toMatch(/script-src [^;]*'unsafe-inline'/)
    expect(PAGE_CSP).not.toContain('unsafe-inline')
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
    expect(document.getElementById('send-pulse').classList.contains('beat')).toBe(true) // a linha de pulso bate uma vez
  })

  it('o código da TV vira maiúsculas e só caracteres válidos enquanto se digita (cabe nas 8 casas)', async () => {
    await open('index.html', async () => jsonReply(CONFIG))
    const code = document.getElementById('code')
    code.value = 'ab-cd 2o'
    code.dispatchEvent(new Event('input'))
    expect(code.value).toBe('ABCD2')
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

  const payLink = () => new URL(document.querySelector('[data-mp-checkout-cta="checkout-api"]').href, 'http://site.test')

  it('Assinar: código vindo do QR já preenchido; o botão leva para /pagar com o código', async () => {
    await open('assinar.html', async () => jsonReply(CONFIG), '?codigo=ABCD2345')
    await vi.waitFor(() => expect(document.getElementById('device-price').textContent).toContain('25'))
    expect(document.getElementById('sub-code').value).toBe('ABCD2345')
    expect(payLink().pathname + payLink().search).toBe('/pagar?tipo=aparelho&codigo=ABCD2345')

    const code = document.getElementById('sub-code')
    code.value = 'zz'
    code.dispatchEvent(new Event('input'))
    const click = new MouseEvent('click', { cancelable: true })
    document.getElementById('sub-pay').dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(document.getElementById('sub-status').textContent).toMatch(/8 caracteres/)
  })

  it('Comprar créditos: total pela tabela (20 = R$ 180), mínimo de 10 e o botão leva a quantidade para /pagar', async () => {
    await open('creditos.html', async () => jsonReply(CONFIG))
    await vi.waitFor(() => expect(document.getElementById('tier-rows').textContent).toContain('1000'))
    const qty = document.getElementById('credit-qty')
    qty.value = '20'
    qty.dispatchEvent(new Event('input'))
    expect(document.getElementById('credit-total').textContent).toMatch(/180,00/)
    expect(payLink().pathname + payLink().search).toBe('/pagar?tipo=creditos&qtd=20')
    const current = [...document.querySelectorAll('#tier-rows tr.is-current')]
    expect(current.map((tr) => tr.textContent)).toEqual([expect.stringMatching(/^20 a 50/)])
    expect(current[0].getAttribute('aria-current')).toBe('true')
    qty.value = '5'
    qty.dispatchEvent(new Event('input'))
    expect(document.getElementById('credit-total').textContent).toMatch(/mínimo de 10/)
    expect(document.querySelectorAll('#tier-rows tr.is-current')).toHaveLength(0)
    const click = new MouseEvent('click', { cancelable: true })
    document.getElementById('credit-pay').dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })

  it('cada página de compra tem um único botão de checkout, apontando para /pagar', () => {
    for (const file of [`${SITE}assinar.html`, `${SITE}creditos.html`, 'server/license/public/revenda/index.html']) {
      const html = readFileSync(file, 'utf8')
      expect(html.match(/data-mp-checkout-cta="checkout-api"/g)).toHaveLength(1)
      expect(html).toMatch(/<a [^>]*href="\/pagar\?tipo=[a-z]+[^"]*"[^>]*data-mp-checkout-cta="checkout-api"/)
      expect(html).not.toMatch(/pelo WhatsApp<\/button>/)
    }
  })
})
