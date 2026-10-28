import { describe, it, expect, beforeEach } from 'vitest'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'

let db
let handle

const get = (path) => handle(new Request(`http://license.test${path}`), '10.0.0.5')

async function deviceCode() {
  const res = await handle(
    new Request('http://license.test/v1/hello', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceKey: 'e'.repeat(64), platform: 'android' }),
    }),
    '10.0.0.5',
  )
  return (await res.json()).code
}

beforeEach(async () => {
  db = openSqlite(':memory:')
  await migrate(db)
  handle = createLicenseHandler({ db, adminToken: 'x', contactUrl: 'https://wa.me/5511999999999' })
})

describe('página de planos (QR da tela de ativação)', () => {
  it('mostra o código do aparelho, o plano anual de R$ 10 e o contato para pagar', async () => {
    const code = await deviceCode()
    const res = await get(`/a/${code}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain(code)
    expect(html).toContain('R$ 10')
    expect(html).toContain('href="https://wa.me/5511999999999"')
  })

  it('usa a mesma política de segurança do pareamento (sem script nem estilo embutido)', async () => {
    const res = await get(`/a/${await deviceCode()}`)
    const csp = res.headers.get('Content-Security-Policy')
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toContain('unsafe-inline')
    expect(await res.text()).not.toMatch(/<script|style=/)
  })

  it('serve a folha de estilo da página', async () => {
    const res = await get('/a/plans.css')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/css')
  })

  it('código desconhecido ou fora do alfabeto é 404, sem ecoar o texto', async () => {
    for (const code of ['ZZZZZZZZ', 'abc<b>12', '0O1IL000']) {
      const res = await get(`/a/${encodeURIComponent(code)}`)
      expect(res.status).toBe(404)
      expect(await res.text()).not.toContain('<b>')
    }
  })

  it('sem contato configurado a página não mostra botão vazio', async () => {
    handle = createLicenseHandler({ db, adminToken: 'x' })
    const html = await (await get(`/a/${await deviceCode()}`)).text()
    expect(html).not.toContain('href=""')
  })
})
