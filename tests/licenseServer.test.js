import { describe, it, expect, afterEach } from 'vitest'
import { createLicenseServer } from '../server/license/license-server.mjs'

let server

async function start(options = {}) {
  server = createLicenseServer({ dbPath: ':memory:', adminToken: 'segredo', ...options })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  server = null
})

describe('servidor de licença local (node:http + node:sqlite)', () => {
  it('responde /healthz', async () => {
    const base = await start()
    const res = await fetch(`${base}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })

  it('registra o aparelho pelo HTTP de verdade', async () => {
    const base = await start()
    const res = await fetch(`${base}/v1/hello`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceKey: 'd'.repeat(64), platform: 'web' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).code).toHaveLength(8)
  })

  it('serve o painel em /admin/ com a política de segurança e os arquivos dele', async () => {
    const base = await start()
    const res = await fetch(`${base}/admin/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'")
    const html = await res.text()
    expect(html).toContain('src="/admin/admin.js"')
    expect(html).not.toMatch(/<script>|style=/)
    expect((await fetch(`${base}/admin/admin.js`)).status).toBe(200)
    expect((await fetch(`${base}/admin/admin.css`)).status).toBe(200)
  })

  it('a API do painel exige o token também pelo HTTP', async () => {
    const base = await start()
    expect((await fetch(`${base}/admin/api/partners`)).status).toBe(401)
    expect((await fetch(`${base}/admin/api/partners`, { headers: { Authorization: 'Bearer segredo' } })).status).toBe(200)
  })
})
