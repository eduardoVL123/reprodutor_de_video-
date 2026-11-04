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
        if (path.endsWith('/') || path === '') path += 'index.html'
        else if (!/\.[a-z]+$/.test(path)) path += '.html' // como o Workers: /site/assinar serve assinar.html
        const full = join(PUBLIC_DIR, path)
        return existsSync(full) ? new Response(readFileSync(full), { status: 200 }) : new Response('nada', { status: 404 })
      }),
    },
    ...extra,
  }
}

const b64url = (bytes) => Buffer.from(bytes).toString('base64url')
const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }

/** Equipe do Cloudflare Access falsa: chaves RSA, /certs servido por fetch falso e JWTs assinados. */
async function makeAccess() {
  const key = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])
  const otherKey = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])
  const jwk = { ...(await crypto.subtle.exportKey('jwk', key.publicKey)), kid: 'k1' }
  vi.stubGlobal('fetch', vi.fn(async (url) => (String(url) === 'https://pulse.cloudflareaccess.com/cdn-cgi/access/certs' ? Response.json({ keys: [jwk] }) : new Response('', { status: 404 }))))
  /** JWT como o Access manda; `claims` sobrescreve os campos, `pair` troca a chave que assina. */
  async function token(claims = {}, pair = key) {
    const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }))
    const body = b64url(JSON.stringify({ aud: ['aud-do-painel'], iss: 'https://pulse.cloudflareaccess.com', email: 'Dono@Exemplo.com', exp: Math.floor(Date.now() / 1000) + 600, ...claims }))
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`))
    return `${head}.${body}.${b64url(new Uint8Array(sig))}`
  }
  return { env: { ACCESS_TEAM: 'pulse', ACCESS_AUD: 'aud-do-painel', ACCESS_OWNER_EMAIL: 'dono@exemplo.com' }, otherKey, token }
}

let worker
beforeEach(async () => {
  vi.resetModules()
  vi.unstubAllGlobals()
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

  it('se a criação das tabelas falhar uma vez, a chamada seguinte tenta de novo', async () => {
    const env = mockEnv()
    const realDb = env.DB
    let broken = true
    env.DB = {
      ...realDb,
      prepare: (sql) => {
        if (broken) throw new Error('D1 indisponível')
        return realDb.prepare(sql)
      },
    }
    await expect(post(env, '/v1/access', { deviceKey: 'a'.repeat(64), host: 'x.com' })).rejects.toThrow('D1 indisponível')

    broken = false
    expect((await post(env, '/v1/access', { deviceKey: 'a'.repeat(64), host: 'x.com' })).status).toBe(200)
  })

  it('migração presa num pedido cancelado não trava os pedidos seguintes do isolate', async () => {
    const env = mockEnv()
    const realDb = env.DB
    let stuck = true
    env.DB = {
      ...realDb,
      prepare: (sql) => {
        if (!stuck) return realDb.prepare(sql)
        stuck = false
        return { run: () => new Promise(() => {}) } // como o pedido cancelado: nunca termina
      },
    }
    post(env, '/v1/access', { deviceKey: 'a'.repeat(64), host: 'x.com' }) // fica pendurado
    const second = post(env, '/v1/access', { deviceKey: 'a'.repeat(64), host: 'x.com' })
    const timeout = new Promise((resolve) => setTimeout(() => resolve('travou'), 2000))
    const res = await Promise.race([second, timeout])
    expect(res).not.toBe('travou')
    expect(res.status).toBe(200)
  })

  it('o limite de aparelhos novos usa o IP real do visitante (CF-Connecting-IP)', async () => {
    const env = mockEnv()
    for (let i = 0; i < 20; i++) await post(env, '/v1/access', { deviceKey: `${'b'.repeat(60)}${String(i).padStart(4, '0')}`, host: 'x.com' }, '9.9.9.9')
    expect((await post(env, '/v1/access', { deviceKey: 'c'.repeat(64), host: 'x.com' }, '9.9.9.9')).status).toBe(429)
    expect((await post(env, '/v1/access', { deviceKey: 'c'.repeat(64), host: 'x.com' }, '8.8.8.8')).status).toBe(200)
  })

  it('painel do dono: com o Access conferido serve a tela e a API ainda exige o token (RFC-025 §5)', async () => {
    const access = await makeAccess()
    const env = mockEnv(access.env)
    const jwt = await access.token()
    const asOwner = (path, headers = {}) => worker.fetch(new Request(`https://licenca.test${path}`, { headers: { 'Cf-Access-Jwt-Assertion': jwt, ...headers } }), env)
    const page = await asOwner('/admin/')
    expect(page.status).toBe(200)
    expect(page.headers.get('Content-Security-Policy')).toContain("script-src 'self'")
    expect(await page.text()).toContain('src="/admin/admin.js"')
    expect((await asOwner('/admin/api/partners')).status).toBe(401)
    expect((await asOwner('/admin/api/partners', { Authorization: 'Bearer segredo-do-painel' })).status).toBe(200)
  })

  it('painel do dono: sem Access válido nem a tela existe (404), mesmo com o token certo', async () => {
    const access = await makeAccess()
    const env = mockEnv(access.env)
    const get = (path, headers = {}) => worker.fetch(new Request(`https://licenca.test${path}`, { headers }), env)
    const token = { Authorization: 'Bearer segredo-do-painel' }
    for (const path of ['/admin/', '/admin', '/admin/admin.js', '/admin/api/partners']) expect((await get(path, token)).status).toBe(404)
    const cases = [
      await access.token({ aud: ['outra-app'] }),
      await access.token({ email: 'intruso@exemplo.com' }),
      await access.token({ exp: Math.floor(Date.now() / 1000) - 10 }),
      await access.token({ iss: 'https://outra.cloudflareaccess.com' }),
      await access.token({}, access.otherKey),
      'nao.e.jwt',
    ]
    for (const jwt of cases) expect((await get('/admin/api/partners', { ...token, 'Cf-Access-Jwt-Assertion': jwt })).status).toBe(404)
  })

  it('painel do dono: segredos colados com espaço ou quebra de linha ainda funcionam', async () => {
    const access = await makeAccess()
    const env = mockEnv({ ACCESS_TEAM: ' pulse ', ACCESS_AUD: 'aud-do-painel\r\n', ACCESS_OWNER_EMAIL: ' DONO@exemplo.com\n' })
    const res = await worker.fetch(new Request('https://licenca.test/admin/', { headers: { 'Cf-Access-Jwt-Assertion': await access.token() } }), env)
    expect(res.status).toBe(200)
  })

  it('painel do dono: sem o Access configurado fica desligado (503)', async () => {
    const res = await worker.fetch(new Request('https://licenca.test/admin/api/partners', { headers: { Authorization: 'Bearer segredo-do-painel' } }), mockEnv())
    expect(res.status).toBe(503)
  })

  it('serve as páginas do site (RFC-021) com a política de segurança', async () => {
    const env = mockEnv()
    for (const [path, text] of [['/', 'id="landing"'], ['/enviar', 'send-form'], ['/cliente', 'status-form'], ['/assinar', 'sub-form'], ['/creditos', 'credit-qty'], ['/privacidade', 'Política de Privacidade']]) {
      const res = await worker.fetch(new Request(`https://licenca.test${path}`), env)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'")
      expect(await res.text()).toContain(text)
    }
  })

  it('serve /pagar (RFC-020) com a política própria do pagamento e entrega a chave pública no site-config', async () => {
    const { PAY_CSP } = await import('../server/license/license-checkout.mjs')
    const env = mockEnv({ MP_ACCESS_TOKEN: 'APP_USR-teste', MP_PUBLIC_KEY: 'APP_USR-chave-publica' })
    const page = await worker.fetch(new Request('https://licenca.test/pagar'), env)
    expect(page.status).toBe(200)
    expect(page.headers.get('Content-Security-Policy')).toBe(PAY_CSP)
    expect(await page.text()).toContain('form-checkout')
    expect((await worker.fetch(new Request('https://licenca.test/site/pagar.js'), env)).status).toBe(200)
    expect(await (await worker.fetch(new Request('https://licenca.test/v1/site-config'), env)).json()).toMatchObject({ payments: true })
    expect(await (await worker.fetch(new Request('https://licenca.test/v1/mp-config'), env)).json()).toEqual({ publicKey: 'APP_USR-chave-publica' })
  })

  it('serve o painel do revendedor (RFC-022) em /revenda/', async () => {
    const env = mockEnv()
    const res = await worker.fetch(new Request('https://licenca.test/revenda/'), env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'")
    expect(await res.text()).toContain('activate-form')
    expect((await worker.fetch(new Request('https://licenca.test/revenda'), env)).status).toBe(301)
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
