import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

describe('proxy anti-CORS de desenvolvimento', () => {
  it.each([
    ['127.0.0.1', true],
    ['::1', true],
    ['::ffff:127.0.0.1', true],
    ['192.168.0.15', false],
    ['10.0.0.2', false],
    ['', false],
    [undefined, false],
  ])('isLoopbackAddress(%s) = %s', async (address, expected) => {
    const { isLoopbackAddress } = await import('../scripts/dev-cors-proxy.mjs')

    expect(isLoopbackAddress(address)).toBe(expected)
  })

  it('identifica-se com um User-Agent próprio, sem imitar outro aplicativo', async () => {
    const { UPSTREAM_UA } = await import('../scripts/dev-cors-proxy.mjs')
    const native = readFileSync('android/app/src/main/java/com/pulseplayer/app/MainActivity.java', 'utf8')

    expect(UPSTREAM_UA).toMatch(/^PulsePlayer\//)
    expect(native).not.toContain('IPTVSmarter')
    expect(native).toMatch(/USER_AGENT = "PulsePlayer\//)
  })

  it('recusa páginas de outros sites abertas no navegador da própria máquina', async () => {
    const { proxyHandler } = await import('../scripts/dev-cors-proxy.mjs')
    const res = { headersSent: false, writeHead: vi.fn(), end: vi.fn(), on: vi.fn() }
    const req = {
      method: 'GET',
      url: '/__proxy__?url=http%3A%2F%2F192.168.0.1%2F',
      headers: { origin: 'https://site-malicioso.example' },
      socket: { remoteAddress: '127.0.0.1' },
    }

    proxyHandler(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object))
  })

  it.each(['http://localhost:5173', 'http://127.0.0.1:4173', 'http://[::1]:5173'])(
    'aceita a própria página de desenvolvimento (%s)',
    async (origin) => {
      const { proxyHandler } = await import('../scripts/dev-cors-proxy.mjs')
      const res = { headersSent: false, writeHead: vi.fn(), end: vi.fn(), on: vi.fn() }
      const req = { method: 'GET', url: '/__proxy__', headers: { origin }, socket: { remoteAddress: '127.0.0.1' } }

      proxyHandler(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object)) // passou da trava; falta só o parâmetro url
    },
  )

  it('recusa clientes que não estão na própria máquina', async () => {
    const { proxyHandler } = await import('../scripts/dev-cors-proxy.mjs')
    const res = { headersSent: false, writeHead: vi.fn(), end: vi.fn(), on: vi.fn() }
    const req = {
      method: 'GET',
      url: '/__proxy__?url=http%3A%2F%2F10.0.0.1%2Fadmin',
      headers: {},
      socket: { remoteAddress: '192.168.1.50' },
    }

    proxyHandler(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object))
  })
})
