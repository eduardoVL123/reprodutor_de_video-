import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'
import { createLicenseServer } from '../server/license/license-server.mjs'
import { PAGE_CSP } from '../server/pair/pair-core.mjs'
import { SITE_CSP } from '../server/license/license-core.mjs'
import { PAY_CSP } from '../server/license/license-checkout.mjs'

/** RFC-021: site do Pulse Player (enviar lista, assinar, comprar créditos), servido pelo serviço de licença. */

const SITE = 'server/license/public/site/'
const PAGES = ['index.html', 'enviar.html', 'cliente.html', 'assinar.html', 'creditos.html', 'pagar.html']
// RFC-025: /enviar é o destino do app das lojas, sem link de compra; as outras levam ao início, a assinar e a créditos.
const SALES_PAGES = PAGES.filter((p) => p !== 'enviar.html')

describe('núcleo — rotas do site', () => {
  let handle
  beforeEach(async () => {
    const db = openSqlite(':memory:')
    await migrate(db)
    handle = createLicenseHandler({ db, adminToken: 'x', contactUrl: 'https://wa.me/5516992791692' })
  })

  it('/apk (endereço curto do Downloader) leva ao APK da release fixa', async () => {
    const { APK_URL } = await import('../server/license/license-core.mjs')
    const res = await handle(new Request('http://site.test/apk'), '1.1.1.1')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe(APK_URL)
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
      playUrl: '',
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
      expect(res.headers.get('Content-Security-Policy')).toBe(SITE_CSP)
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

  it.each(PAGES)('%s: sem script embutido e com o aviso legal', (page) => {
    const html = readFileSync(SITE + page, 'utf8')
    expect(html).not.toMatch(/<script>|\sstyle=|\son[a-z]+=/)
    expect(html).toContain('Nenhum conteúdo é fornecido, endossado ou vendido')
  })

  it.each(SALES_PAGES)('%s: leva ao início, a assinar e a créditos', (page) => {
    const html = readFileSync(SITE + page, 'utf8')
    for (const href of ['href="/"', 'href="/assinar"', 'href="/creditos"']) expect(html).toContain(href)
  })

  it.each(['index.html', 'assinar.html', 'creditos.html', 'cliente.html', 'privacidade.html', 'pagar.html'])('%s: menu na ordem aprovada', (page) => {
    const html = readFileSync(SITE + page, 'utf8')
    const menu = html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/)[1]
    const links = [...menu.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((match) => [match[1], match[2]])
    expect(links).toEqual([
      ['/', 'Início'],
      ['/assinar', 'Ativar meu app'],
      ['/creditos', 'Revendas'],
      ['/enviar', 'Enviar listas'],
    ])
  })

  it('/enviar (destino do app das lojas, RFC-025 §2): sem preço nem link de compra, nem para a landing', () => {
    const html = readFileSync(SITE + 'enviar.html', 'utf8')
    for (const banned of ['href="/"', '/assinar', '/creditos', '/pagar', 'R$', 'preço']) expect(html).not.toContain(banned)
  })

  it('/privacidade é o PRIVACY.md publicado (Google Play exige o link) e não ficou desatualizada', () => {
    const html = readFileSync(SITE + 'privacidade.html', 'utf8')
    const md = readFileSync('PRIVACY.md', 'utf8')
    expect(html).not.toMatch(/<script>|\sstyle=|\son[a-z]+=/)
    expect(html).not.toContain('Rascunho técnico')
    for (const heading of md.match(/^#{1,3} .+$/gm)) expect(html).toContain(heading.replace(/^#+ /, '').replace(/\*\*/g, ''))
    expect(html).toContain(md.match(/Última atualização: (.+)/)[1].trim())
    expect(readFileSync(SITE + 'index.html', 'utf8')).toContain('href="/privacidade"')
  })

  it('o favicon é servido e todas as páginas do site o usam', () => {
    for (const page of PAGES) expect(readFileSync(SITE + page, 'utf8')).toContain('href="/site/favicon.svg"')
  })

  it('tema claro: o limão da marca só aparece dentro da faixa verde do herói (RFC-015 + RFC-025)', () => {
    const css = readFileSync(SITE + 'site.css', 'utf8')
    const limeRules = css.split('}').filter((rule) => rule.includes('var(--lime)'))
    expect(limeRules.length).toBeGreaterThan(0)
    for (const rule of limeRules) expect(rule.trim()).toMatch(/^\.(hero|tv-)/)
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

  async function open(page, fetchImpl, search = '', pathname = `/${page}`) {
    const html = readFileSync(SITE + page, 'utf8')
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*><\/script>/g, '')
    // jsdom não implementa o diálogo modal nativo do navegador.
    const dialog = document.getElementById('legal-notice')
    if (dialog) dialog.showModal = () => { dialog.open = true }
    window.history.replaceState({}, '', `${pathname}${search}`)
    vi.stubGlobal('fetch', vi.fn(fetchImpl))
    await import('../server/pair/public/pair-lib.js')
    new Function(readFileSync(`${SITE}site.js`, 'utf8'))()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
  }

  const jsonReply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.removeItem('pulse:legal-notice:v1')
    document.body.innerHTML = ''
  })

  it('o aviso abre na raiz do site e só memoriza a escolha quando solicitado', async () => {
    await open('index.html', async () => jsonReply(CONFIG), '', '/')
    const dialog = document.getElementById('legal-notice')
    expect(dialog.open).toBe(true)
    dialog.dispatchEvent(new Event('close'))
    expect(localStorage.getItem('pulse:legal-notice:v1')).toBeNull()
    document.getElementById('legal-remember').checked = true
    dialog.dispatchEvent(new Event('close'))
    expect(localStorage.getItem('pulse:legal-notice:v1')).toBe('dismissed')
    await open('index.html', async () => jsonReply(CONFIG), '', '/')
    expect(document.getElementById('legal-notice').open).toBe(false)
  })

  it('não abre o aviso fora da página inicial', async () => {
    await open('index.html', async () => jsonReply(CONFIG), '', '/outra')
    expect(document.getElementById('legal-notice').open).toBe(false)
    await open('enviar.html', async () => jsonReply(CONFIG))
    expect(document.getElementById('legal-notice')).toBeNull()
  })

  it('Enviar lista: cifra para a chave da TV e só manda o texto cifrado, que a TV abre', async () => {
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const tv = await createPairingKeys()
    let sent = null
    await open('enviar.html', async (url, init) => {
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
    await open('enviar.html', async () => jsonReply(CONFIG))
    const code = document.getElementById('code')
    code.value = 'ab-cd 2o'
    code.dispatchEvent(new Event('input'))
    expect(code.value).toBe('ABCD2')
  })

  it('Enviar lista: código vindo do celular (?codigo=) já preenchido e o foco vai para o link (RFC-023)', async () => {
    await open('enviar.html', async () => jsonReply(CONFIG), '?codigo=abcd2345')
    await vi.waitFor(() => expect(document.getElementById('code').value).toBe('ABCD2345'))
    expect(document.activeElement.id).toBe('link')
  })

  it('Enviar lista: TV que nunca abriu o app recebe a instrução do servidor', async () => {
    await open('enviar.html', async (url) =>
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

  it('Landing: preço e faixas vêm do servidor; com PLAY_URL o celular vai para a Google Play (RFC-025 §2)', async () => {
    await open('index.html', async () => jsonReply({ ...CONFIG, devicePriceCents: 3000, playUrl: 'https://play.google.com/store/apps/details?id=com.pulseplayer.app' }))
    await vi.waitFor(() => expect(document.getElementById('device-price').textContent).toMatch(/R\$\s*30$/))
    expect(document.querySelectorAll('#tier-rows tr')).toHaveLength(6)
    expect(document.getElementById('phone-link').href).toContain('play.google.com')
    expect(document.getElementById('apk-address').textContent).toBe(`${location.host}/apk`)
  })

  it.each([
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', 'phone'],
    ['Mozilla/5.0 (Linux; Android 12; BRAVIA 4K) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'tv'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36', 'tv'],
    ['Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36', 'soon'],
  ])('Landing: "Seu aparelho" em Baixar conforme o navegador (%s)', async (ua, device) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
    await open('index.html', async () => jsonReply(CONFIG))
    await vi.waitFor(() => expect(document.querySelector('.download.is-yours')).not.toBeNull())
    expect(document.querySelector('.download.is-yours').dataset.device).toBe(device)
    vi.restoreAllMocks()
  })

  it('Landing: sem PLAY_URL o celular recebe o APK', async () => {
    await open('index.html', async () => jsonReply({ ...CONFIG, playUrl: '' }))
    await vi.waitFor(() => expect(document.getElementById('device-price').textContent).toMatch(/25/))
    expect(new URL(document.getElementById('phone-link').href).pathname).toBe('/apk')
  })

  it('Minha TV: ativo com renovação mostra a data, renovar e cancelar; cancelar manda código e e-mail', async () => {
    const calls = []
    await open(
      'cliente.html',
      async (url, init) => {
        if (String(url).endsWith('/v1/site-config')) return jsonReply(CONFIG)
        calls.push([String(url), JSON.parse(init.body)])
        if (String(url).endsWith('/v1/device-status')) return jsonReply({ state: 'active', until: Date.UTC(2027, 10, 3, 15), renews: true })
        return jsonReply({ cancelled: true })
      },
      '?codigo=abcd2345',
    )
    expect(document.getElementById('status-code').value).toBe('ABCD2345')
    document.getElementById('status-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(document.getElementById('status-result').hidden).toBe(false))
    expect(calls[0]).toEqual(['/v1/device-status', { code: 'ABCD2345' }])
    expect(document.getElementById('status-title').textContent).toMatch(/Ativo até 3 de novembro de 2027/)
    expect(document.getElementById('status-renew').getAttribute('href')).toBe('/pagar?tipo=aparelho&codigo=ABCD2345')
    expect(document.getElementById('status-support').href).toContain('wa.me')
    expect(document.getElementById('cancel-open').hidden).toBe(false)

    document.getElementById('cancel-open').click()
    document.getElementById('cancel-email').value = 'maria@exemplo.com'
    document.getElementById('cancel-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(document.getElementById('cancel-msg').textContent).toMatch(/Renovação cancelada/))
    expect(calls[1]).toEqual(['/v1/subscription/cancel', { code: 'ABCD2345', email: 'maria@exemplo.com' }])
    expect(document.getElementById('cancel-open').hidden).toBe(true)
  })

  it('Minha TV: sem ativação não oferece cancelar; erro do servidor aparece na tela', async () => {
    let reply = jsonReply({ state: 'none', until: null, renews: false })
    await open('cliente.html', async (url) => (String(url).endsWith('/v1/site-config') ? jsonReply(CONFIG) : reply))
    document.getElementById('status-code').value = 'ZZZZ9999'
    document.getElementById('status-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(document.getElementById('status-title').textContent).toMatch(/Não há ativação/))
    expect(document.getElementById('cancel-open').hidden).toBe(true)
    expect(document.getElementById('status-renew').textContent).toMatch(/Assinar por R\$\s*25,00 ao ano/)

    reply = jsonReply({ error: 'Muitas tentativas. Aguarde um pouco.' }, 429)
    document.getElementById('status-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(document.getElementById('status-msg').textContent).toMatch(/Muitas tentativas/))
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
