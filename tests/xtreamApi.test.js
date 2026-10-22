import { describe, it, expect, vi } from 'vitest'

const jsonResponse = (body, init) => new Response(JSON.stringify(body), init)

describe('xtreamApi — normalizeBaseUrl', () => {
  it('aceita domínio sem protocolo e remove player_api.php e barra final', async () => {
    const { normalizeBaseUrl } = await import('@/services/xtreamApi')

    expect(normalizeBaseUrl('servidor.com:8080/')).toBe('http://servidor.com:8080')
    expect(normalizeBaseUrl('https://servidor.com/painel/player_api.php?x=1')).toBe('https://servidor.com/painel')
  })

  it('rejeita protocolos que não sejam http/https', async () => {
    const { normalizeBaseUrl } = await import('@/services/xtreamApi')

    expect(() => normalizeBaseUrl('ftp://servidor.com')).toThrow()
    expect(() => normalizeBaseUrl('   ')).toThrow()
  })
})

describe('xtreamApi — apiRequest e fallback para http', () => {
  it('não rebaixa para http quando o servidor https respondeu com erro HTTP', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, { status: 401, statusText: 'Unauthorized' }))
    vi.stubGlobal('fetch', fetchMock)
    const { apiRequest } = await import('@/services/xtreamApi')

    await expect(apiRequest('https://srv.test', { username: 'u', password: 'p' })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    })

    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.some((u) => u.startsWith('http://srv.test'))).toBe(false)
  })

  it('tenta http quando o https falha por rede/certificado', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).startsWith('http://srv.test')) return jsonResponse({ user_info: { auth: 1 } })
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { apiRequest } = await import('@/services/xtreamApi')

    const { data } = await apiRequest('https://srv.test', { username: 'u', password: 'p' })

    expect(data.user_info.auth).toBe(1)
  })
})
