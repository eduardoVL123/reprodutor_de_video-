import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'
import { createLicenseServer } from '../server/license/license-server.mjs'

/** RFC-022: painel do revendedor (/revenda/), uma interface sobre a API /api/v1/* da RFC-019. */

const DIR = 'server/license/public/revenda/'
let handle
let reseller

async function admin(method, path, body) {
  const res = await handle(
    new Request(`http://painel.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer adm' },
      body: body ? JSON.stringify(body) : undefined,
    }),
    '1.1.1.1',
  )
  return res.json()
}

/** Monta /revenda/ no jsdom, com o fetch indo para o serviço de verdade (banco em memória). */
function openPanel(key) {
  const html = readFileSync(`${DIR}index.html`, 'utf8')
  document.body.innerHTML = html.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '').replace(/<script[^>]*><\/script>/g, '')
  sessionStorage.clear()
  if (key) sessionStorage.setItem('pulse-reseller-key', key)
  vi.stubGlobal('fetch', (url, init = {}) => handle(new Request(new URL(String(url), 'http://painel.test'), init), '1.1.1.1'))
  new Function(readFileSync(`${DIR}revenda.js`, 'utf8'))()
}

const $ = (id) => document.getElementById(id)
const submit = (id) => $(id).dispatchEvent(new Event('submit', { cancelable: true }))

beforeEach(async () => {
  const db = openSqlite(':memory:')
  await migrate(db)
  handle = createLicenseHandler({ db, adminToken: 'adm', contactUrl: 'https://wa.me/5516992791692' })
  reseller = await admin('POST', '/admin/api/resellers', { name: 'Loja do João' })
  await admin('POST', `/admin/api/resellers/${reseller.id}/credits`, { amount: 10, kind: 'grant' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('painel do revendedor', () => {
  it('sem chave pede para entrar; chave errada avisa', async () => {
    openPanel('')
    expect($('login').hidden).toBe(false)
    $('key').value = 'pk_errada'
    submit('login-form')
    await vi.waitFor(() => expect($('message').textContent).toMatch(/Chave inválida/))
  })

  it('entra com a chave e mostra o nome e o saldo', async () => {
    openPanel('')
    $('key').value = reseller.key
    submit('login-form')
    await vi.waitFor(() => expect($('balance').textContent).toBe('10'))
    expect($('reseller-name').textContent).toBe('Loja do João')
  })

  it('ativa a TV pelo código: gasta 1 crédito, mostra até quando e aparece em Meus clientes', async () => {
    const tv = await (
      await handle(
        new Request('http://painel.test/v1/access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceKey: 't'.repeat(64), platform: 'tizen', host: '' }),
        }),
        '2.2.2.2',
      )
    ).json()
    openPanel(reseller.key)
    await vi.waitFor(() => expect($('balance').textContent).toBe('10'))
    $('activate-code').value = tv.code.toLowerCase()
    submit('activate-form')
    await vi.waitFor(() => expect($('activate-status').textContent).toMatch(/Ativado até/))
    expect($('balance').textContent).toBe('9')
    await vi.waitFor(() => expect($('client-rows').textContent).toContain(tv.code))
  })

  it('código errado mostra a mensagem do serviço e não gasta crédito', async () => {
    openPanel(reseller.key)
    await vi.waitFor(() => expect($('balance').textContent).toBe('10'))
    $('activate-code').value = 'ZZZZ9999'
    submit('activate-form')
    await vi.waitFor(() => expect($('activate-status').textContent).toMatch(/Abra o Pulse Player/))
    expect($('balance').textContent).toBe('10')
  })

  it('cria revenda (chave aparece uma vez) e passa créditos para ela', async () => {
    openPanel(reseller.key)
    await vi.waitFor(() => expect($('balance').textContent).toBe('10'))
    $('sub-name').value = 'Filial'
    submit('sub-form')
    await vi.waitFor(() => expect($('sub-key').textContent).toMatch(/pk_/))
    await vi.waitFor(() => expect($('sub-rows').textContent).toContain('Filial'))
    $('sub-rows').querySelector('button').click()
    $('transfer-amount').value = '4'
    submit('transfer-form')
    await vi.waitFor(() => expect($('balance').textContent).toBe('6'))
    await vi.waitFor(() => expect($('sub-rows').textContent).toContain('4'))
  })

  it('o extrato lista os movimentos', async () => {
    openPanel(reseller.key)
    await vi.waitFor(() => expect($('movement-rows').textContent).toContain('Cortesia'))
  })

  it('comprar créditos mostra a tabela e o WhatsApp com a quantidade (Pix ainda não)', async () => {
    openPanel(reseller.key)
    await vi.waitFor(() => expect($('tier-rows').textContent).toContain('1000'))
    $('buy-qty').value = '20'
    submit('buy-form')
    expect(decodeURIComponent($('buy-whatsapp').href)).toMatch(/20 créditos.*R\$\s?180,00/)
  })

  it('trocar a própria chave mostra a nova e a antiga para de valer', async () => {
    openPanel(reseller.key)
    await vi.waitFor(() => expect($('balance').textContent).toBe('10'))
    $('rotate-key').click()
    await vi.waitFor(() => expect($('my-key').textContent).toMatch(/pk_/))
    const old = await handle(new Request('http://painel.test/api/v1/me', { headers: { Authorization: `Bearer ${reseller.key}` } }), '1.1.1.1')
    expect(old.status).toBe(401)
  })
})

describe('arquivos do painel', () => {
  it('sem script embutido, só textContent para dados da API e linguagem neutra', () => {
    const html = readFileSync(`${DIR}index.html`, 'utf8')
    expect(html).not.toMatch(/<script>|\sstyle=|\son[a-z]+=/)
    const js = readFileSync(`${DIR}revenda.js`, 'utf8')
    expect(js).not.toMatch(/innerHTML/)
    for (const word of ['canais', 'filme', 'série', 'futebol', 'iptv']) expect(html.toLowerCase()).not.toContain(word)
  })

  it('o servidor local serve /revenda/ com a política de segurança', async () => {
    const server = createLicenseServer({ dbPath: ':memory:', adminToken: 'x' })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      const res = await fetch(`${base}/revenda/`)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'")
      for (const f of ['revenda.js', 'revenda.css']) expect((await fetch(`${base}/revenda/${f}`)).status).toBe(200)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})
