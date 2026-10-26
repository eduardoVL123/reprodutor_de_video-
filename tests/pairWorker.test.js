import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import worker, { PairHub } from '../server/pair/worker.mjs'

const PUBLIC_DIR = join(process.cwd(), 'server/pair/public')

function createMockEnv() {
  const hub = new PairHub({}, {})
  const pairSpy = vi.fn((req) => hub.fetch(req))

  const env = {
    PAIR: {
      idFromName: vi.fn((name) => ({ name })),
      get: vi.fn(() => ({
        fetch: pairSpy,
      })),
    },
    ASSETS: {
      fetch: vi.fn(async (req) => {
        const url = new URL(req.url)
        let filePath = url.pathname.replace(/^\//, '')
        if (!filePath || filePath === 'index.html') {
          filePath = 'index.html'
        }
        const fullPath = join(PUBLIC_DIR, filePath)
        if (!existsSync(fullPath)) {
          return new Response('Not Found', { status: 404 })
        }
        const content = readFileSync(fullPath)
        const type = filePath.endsWith('.html')
          ? 'text/html; charset=utf-8'
          : filePath.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : filePath.endsWith('.css')
              ? 'text/css; charset=utf-8'
              : 'application/octet-stream'
        return new Response(content, {
          status: 200,
          headers: { 'Content-Type': type },
        })
      }),
    },
  }

  return { env, pairSpy }
}

describe('Worker: rota /healthz', () => {
  it('responde ok direto no Worker sem gastar chamada do Durable Object', async () => {
    const { env, pairSpy } = createMockEnv()
    const req = new Request('http://localhost/healthz', { method: 'GET' })

    const res = await worker.fetch(req, env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(res.headers.get('content-type')).toMatch(/text\/plain/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(pairSpy).not.toHaveBeenCalled()
  })

  it('responde a HEAD em /healthz sem corpo e com status 200', async () => {
    const { env, pairSpy } = createMockEnv()
    const req = new Request('http://localhost/healthz', { method: 'HEAD' })

    const res = await worker.fetch(req, env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    expect(pairSpy).not.toHaveBeenCalled()
  })

  it('recusa outros métodos em /healthz com 405', async () => {
    const { env, pairSpy } = createMockEnv()
    const req = new Request('http://localhost/healthz', { method: 'POST' })

    const res = await worker.fetch(req, env)

    expect(res.status).toBe(405)
    expect(pairSpy).not.toHaveBeenCalled()
  })
})

describe('Worker: rotas da API (/v1/*) e sanitização de IP', () => {
  it('encaminha /v1/* para o Durable Object hub passando CF-Connecting-IP', async () => {
    const { env, pairSpy } = createMockEnv()
    const req = new Request('http://localhost/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.195',
      },
      body: JSON.stringify({ pub: 'B'.padEnd(87, 'A') }),
      duplex: 'half',
    })

    const res = await worker.fetch(req, env)

    expect(res.status).toBe(201)
    expect(env.PAIR.idFromName).toHaveBeenCalledWith('hub')
    expect(pairSpy).toHaveBeenCalledTimes(1)

    const forwardedReq = pairSpy.mock.calls[0][0]
    expect(forwardedReq.headers.get('x-internal-client-ip')).toBe('203.0.113.195')
  })

  it('apaga qualquer x-internal-client-ip forjado pelo cliente e usa apenas CF-Connecting-IP', async () => {
    const { env, pairSpy } = createMockEnv()
    const req = new Request('http://localhost/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-client-ip': '1.1.1.1', // forjado pelo invasor
        'CF-Connecting-IP': '203.0.113.50',
      },
      body: JSON.stringify({ pub: 'B'.padEnd(87, 'A') }),
      duplex: 'half',
    })

    const res = await worker.fetch(req, env)

    expect(res.status).toBe(201)
    const forwardedReq = pairSpy.mock.calls[0][0]
    expect(forwardedReq.headers.get('x-internal-client-ip')).toBe('203.0.113.50')
  })

  it('usa 0.0.0.0 quando CF-Connecting-IP não está presente', async () => {
    const { env, pairSpy } = createMockEnv()
    const req = new Request('http://localhost/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pub: 'B'.padEnd(87, 'A') }),
      duplex: 'half',
    })

    await worker.fetch(req, env)

    const forwardedReq = pairSpy.mock.calls[0][0]
    expect(forwardedReq.headers.get('x-internal-client-ip')).toBe('0.0.0.0')
  })
})

describe('Worker: ativos estáticos e rota de código', () => {
  it('serve index.html em / e em /<código> com CSP', async () => {
    const { env } = createMockEnv()

    for (const path of ['/', '/K7M2QP', '/k7m2qp']) {
      const req = new Request(`http://localhost${path}`, { method: 'GET' })
      const res = await worker.fetch(req, env)

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/text\/html/)
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await res.text()).toMatch(/<!doctype html/i)
    }
  })

  it('serve scripts e CSS sem CSP', async () => {
    const { env } = createMockEnv()

    const jsRes = await worker.fetch(new Request('http://localhost/app.js'), env)
    expect(jsRes.status).toBe(200)
    expect(jsRes.headers.get('content-type')).toMatch(/javascript/)
    expect(jsRes.headers.get('content-security-policy')).toBeNull()

    const cssRes = await worker.fetch(new Request('http://localhost/app.css'), env)
    expect(cssRes.status).toBe(200)
    expect(cssRes.headers.get('content-type')).toMatch(/css/)
    expect(cssRes.headers.get('content-security-policy')).toBeNull()
  })

  it('responde a HEAD nos ativos estáticos sem corpo', async () => {
    const { env } = createMockEnv()
    const req = new Request('http://localhost/', { method: 'HEAD' })
    const res = await worker.fetch(req, env)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(await res.text()).toBe('')
  })

  it('rejeita métodos que não sejam GET ou HEAD em arquivos estáticos com 405', async () => {
    const { env } = createMockEnv()
    const req = new Request('http://localhost/', { method: 'POST' })
    const res = await worker.fetch(req, env)

    expect(res.status).toBe(405)
  })

  it('responde 404 em rotas desconhecidas sem tocar no Durable Object', async () => {
    const { env, pairSpy } = createMockEnv()

    for (const path of ['/desconhecido', '/api/outra', '/foo/bar', '/12345']) {
      const res = await worker.fetch(new Request(`http://localhost${path}`), env)
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
    expect(pairSpy).not.toHaveBeenCalled()
  })
})
