import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { openSqlite } from '../server/license/sqlite-d1.mjs'

/** Serviço de licença no Cloudflare Workers (D1 no lugar do node:sqlite; mesma interface). */

const PUBLIC_DIR = join(process.cwd(), 'server/license/public')

function mockEnv(extra = {}) {
  return {
    DB: openSqlite(':memory:'),
    LICENSE_ADMIN_TOKEN: 'segredo-do-painel',
    ASSETS: {
      fetch: vi.fn(async (req) => {
        let path = new URL(req.url).pathname.replace(/^\//, '')
        if (path.endsWith('/')) path += 'index.html'
        const full = join(PUBLIC_DIR, path)
        return existsSync(full) ? new Response(readFileSync(full), { status: 200 }) : new Response('nada', { status: 404 })
      }),
    },
    ...extra,
  }
}

let worker
beforeEach(async () => {
  vi.resetModules()
  worker = (await import('../server/license/worker.mjs')).default
})

const post = (env, path, body, ip = '200.1.1.1') =>
  worker.fetch(
    new Request(`https://licenca.test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify(body),
    }),
    env,
  )

describe('Worker da licença', () => {
  it('responde /healthz', async () => {
    const res = await worker.fetch(new Request('https://licenca.test/healthz'), mockEnv())
    expect(res.status).toBe(200)
  })

  it('cria as tabelas sozinho e atende o app (/v1/access)', async () => {
    const env = mockEnv()
    const res = await post(env, '/v1/access', { deviceKey: 'a'.repeat(64), platform: 'android', host: 'x.com' })
    expect(res.status).toBe(200)
    expect((await res.json()).access).toBe('trial')
  })

  it('o limite de aparelhos novos usa o IP real do visitante (CF-Connecting-IP)', async () => {
    const env = mockEnv()
    for (let i = 0; i < 20; i++) await post(env, '/v1/access', { deviceKey: `${'b'.repeat(60)}${String(i).padStart(4, '0')}`, host: 'x.com' }, '9.9.9.9')
    expect((await post(env, '/v1/access', { deviceKey: 'c'.repeat(64), host: 'x.com' }, '9.9.9.9')).status).toBe(429)
    expect((await post(env, '/v1/access', { deviceKey: 'c'.repeat(64), host: 'x.com' }, '8.8.8.8')).status).toBe(200)
  })

  it('serve o painel com a política de segurança e a API do painel exige o token do segredo', async () => {
    const env = mockEnv()
    const page = await worker.fetch(new Request('https://licenca.test/admin/'), env)
    expect(page.status).toBe(200)
    expect(page.headers.get('Content-Security-Policy')).toContain("script-src 'self'")
    expect(await page.text()).toContain('src="/admin/admin.js"')
    expect((await worker.fetch(new Request('https://licenca.test/admin/api/partners'), env)).status).toBe(401)
    const ok = await worker.fetch(
      new Request('https://licenca.test/admin/api/partners', { headers: { Authorization: 'Bearer segredo-do-painel' } }),
      env,
    )
    expect(ok.status).toBe(200)
  })

  it('a rotina diária (cron) roda a limpeza de 24 meses', async () => {
    const env = mockEnv()
    await post(env, '/v1/access', { deviceKey: 'd'.repeat(64), host: 'x.com' })
    const old = Date.now() - 800 * 24 * 3600e3
    await env.DB.prepare('UPDATE devices SET first_seen_at = ?').bind(old).run()
    await worker.scheduled({}, env)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first()).n).toBe(0)
  })
})
