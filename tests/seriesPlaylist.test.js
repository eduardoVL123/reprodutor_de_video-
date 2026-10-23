import { describe, it, expect, vi } from 'vitest'

// Painéis Xtream devolvem as temporadas fora de ordem e às vezes como objeto em vez de array.
const SERIES_DATA = {
  episodes: {
    2: [{ id: 201, season: 2, episode_num: 1, title: 'Volta', container_extension: 'mkv' }],
    1: {
      a: { id: 101, season: 1, episode_num: 1, title: 'Começo', info: { movie_image: 'http://srv.test/e101.jpg' } },
      b: { id: 102, season: 1, episode_num: 2, title: '' },
    },
    3: [],
  },
}

describe('seriesPlaylist — fila da série inteira', () => {
  it('ordena as temporadas e ignora as vazias', async () => {
    const { seasonsOf } = await import('@/utils/seriesPlaylist')

    expect(seasonsOf(SERIES_DATA).map((s) => s.number)).toEqual([1, 2])
  })

  it('junta todas as temporadas em ordem, para o próximo episódio passar de uma para a outra', async () => {
    const { buildSeriesPlaylist } = await import('@/utils/seriesPlaylist')

    const items = buildSeriesPlaylist({ seriesData: SERIES_DATA, seriesName: 'Maré', seriesId: 9, fallbackImage: 'http://srv.test/poster.jpg' })

    expect(items.map((it) => it.stream_id)).toEqual([101, 102, 201])
    expect(items[0]).toEqual({
      stream_id: 101,
      name: 'Maré - T1:E1 - Começo',
      stream_icon: 'http://srv.test/e101.jpg',
      container_extension: 'mp4',
      section: 'series',
      seriesId: 9,
    })
    expect(items[1].name).toBe('Maré - T1:E2 - Episódio 2')
    expect(items[1].stream_icon).toBe('http://srv.test/poster.jpg')
    expect(items[2].container_extension).toBe('mkv')
  })
})

describe('playHistoryItem — "Continuar assistindo"', () => {
  const player = () => ({ playItem: vi.fn(), playPlaylist: vi.fn() })

  it('episódio: toca a série inteira a partir dele (o próximo segue sozinho)', async () => {
    const { playHistoryItem } = await import('@/utils/seriesPlaylist')
    const p = player()
    const loadSeries = vi.fn(async () => SERIES_DATA)

    await playHistoryItem({ stream_id: 102, name: 'Maré - T1:E2', section: 'series', seriesId: 9 }, { player: p, loadSeries })

    expect(loadSeries).toHaveBeenCalledWith(9)
    expect(p.playPlaylist).toHaveBeenCalledTimes(1)
    const { items, startIndex, section } = p.playPlaylist.mock.calls[0][0]
    expect(items.map((it) => it.stream_id)).toEqual([101, 102, 201])
    expect(startIndex).toBe(1)
    expect(section).toBe('series')
    expect(items[0].name.startsWith('Maré - T1:E1')).toBe(true)
  })

  it('filme, canal ou série sem dados: toca só o item, como antes', async () => {
    const { playHistoryItem } = await import('@/utils/seriesPlaylist')
    const p = player()
    const movie = { stream_id: 5, name: 'Filme', section: 'vod' }
    const failing = vi.fn(async () => {
      throw new Error('fora do ar')
    })

    await playHistoryItem(movie, { player: p, loadSeries: failing })
    await playHistoryItem({ stream_id: 999, section: 'series', seriesId: 9 }, { player: p, loadSeries: failing })

    expect(failing).toHaveBeenCalledTimes(1)
    expect(p.playItem).toHaveBeenCalledTimes(2)
    expect(p.playPlaylist).not.toHaveBeenCalled()
  })
})
