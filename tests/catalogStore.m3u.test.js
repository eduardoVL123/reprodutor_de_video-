import { describe, it, expect, vi } from 'vitest'

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-logo="http://img.test/a.png" group-title="Canais",Canal A
http://srv.test/live/a.m3u8
#EXTINF:-1 group-title="Canais",Canal B
http://srv.test/live/b.m3u8
#EXTINF:-1 group-title="Filmes",Filme A
http://srv.test/movie/a.mp4
`

async function setup() {
  const fetchM3uText = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    return { text: PLAYLIST, finalUrl: 'http://srv.test/lista.m3u' }
  })
  vi.doMock('@/services/xtreamApi', async (importOriginal) => ({
    ...(await importOriginal()),
    fetchM3uText,
  }))

  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  const { useAuthStore } = await import('@/stores/authStore')
  const { useCatalogStore } = await import('@/stores/catalogStore')
  const auth = useAuthStore()
  auth.session = {
    id: 'm3u_1',
    type: 'm3u',
    baseUrl: 'http://srv.test/lista.m3u',
    resolvedUrl: 'http://srv.test/lista.m3u',
    username: 'M3U Playlist',
    password: '',
  }
  return { catalog: useCatalogStore(), fetchM3uText }
}

describe('catalogStore — sessão M3U', () => {
  it('carrega a aba Séries vazia, sem erro, porque M3U não tem séries', async () => {
    const { catalog } = await setup()

    await catalog.loadSection('series')

    expect(catalog.status.series.error).toBe('')
    expect(catalog.status.series.state).toBe('ready')
    expect(catalog.totals.series).toBe(0)
  })

  it('baixa a playlist uma única vez ao carregar as três seções juntas', async () => {
    const { catalog, fetchM3uText } = await setup()

    await Promise.all(['vod', 'live', 'series'].map((s) => catalog.loadSection(s, { force: true })))

    expect(fetchM3uText).toHaveBeenCalledTimes(1)
    expect(catalog.totals.live).toBe(2)
    expect(catalog.totals.vod).toBe(1)
  })

  it('não baixa de novo uma seção já carregada', async () => {
    const { catalog, fetchM3uText } = await setup()
    await catalog.loadSection('live')

    await catalog.loadSection('vod')
    await catalog.loadSection('live')

    expect(fetchM3uText).toHaveBeenCalledTimes(1)
  })
})
