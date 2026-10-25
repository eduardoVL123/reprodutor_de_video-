import { describe, it, expect } from 'vitest'

async function setup() {
  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  const { storage } = await import('@/services/storage')
  const { usePlayerStore } = await import('@/stores/playerStore')
  return { storage, usePlayerStore }
}

describe('playerStore — histórico persistido', () => {
  it('descarta entradas corrompidas ao ler o histórico salvo', async () => {
    const { storage, usePlayerStore } = await setup()
    await storage.set('player:watchHistory:p1', [
      { currentTime: 5 },
      null,
      { stream_id: 7, name: 'Filme', section: 'vod', currentTime: 120, duration: 3600, progressPct: 3 },
    ])

    const player = usePlayerStore()
    await player.hydrate(true)

    expect(player.watchHistory).toHaveLength(1)
    expect(player.watchHistory[0]).toMatchObject({ stream_id: 7, name: 'Filme', currentTime: 120 })
  })

  it('descarta itens inválidos da Minha Fila salva', async () => {
    const { storage, usePlayerStore } = await setup()
    await storage.set('player:customQueue:p1', [{ name: 'sem id' }, { stream_id: 1, name: 'ok', section: 'vod' }])

    const player = usePlayerStore()
    await player.hydrate(true)

    expect(player.customQueue.map((q) => q.stream_id)).toEqual([1])
  })
})

describe('playerStore — dados anteriores aos perfis', () => {
  const LEGACY_ITEM = { stream_id: 9, name: 'Antigo', section: 'vod', currentTime: 100, duration: 3000, progressPct: 3 }

  it('migra fila e histórico antigos para o perfil Principal e apaga as chaves antigas', async () => {
    const { storage, usePlayerStore } = await setup()
    await storage.set('player:customQueue', [LEGACY_ITEM])
    await storage.set('player:watchHistory', [LEGACY_ITEM])

    const player = usePlayerStore()
    await player.hydrate(true)

    expect(player.customQueue.map((q) => q.stream_id)).toEqual([9])
    expect(player.watchHistory.map((h) => h.stream_id)).toEqual([9])
    expect(await storage.get('player:customQueue')).toBeFalsy()
    expect(await storage.get('player:watchHistory')).toBeFalsy()
  })

  it('limpar a fila e o histórico não faz o conteúdo antigo voltar na próxima abertura', async () => {
    const { storage, usePlayerStore } = await setup()
    await storage.set('player:customQueue', [LEGACY_ITEM])
    await storage.set('player:watchHistory', [LEGACY_ITEM])
    const player = usePlayerStore()
    await player.hydrate(true)

    await player.clearCustomQueue()
    await player.clearHistory()
    await player.hydrate(true)

    expect(player.customQueue).toHaveLength(0)
    expect(player.watchHistory).toHaveLength(0)
  })
})

describe('playerStore — "Continuar assistindo"', () => {
  const MOVIE = { stream_id: 50, name: 'Filme', section: 'vod', container_extension: 'mp4' }
  const channel = (n) => ({ stream_id: 1000 + n, name: `Canal ${n}`, section: 'live' })

  it('trocar de canal várias vezes não expulsa filmes e episódios do histórico', async () => {
    const { usePlayerStore } = await setup()
    const player = usePlayerStore()
    await player.hydrate(true)
    player.playItem(MOVIE)
    player.saveProgress(900, 5400)

    for (let n = 0; n < 20; n++) {
      player.playItem(channel(n))
      player.saveProgress(0, 0)
    }

    expect(player.watchHistory.some((h) => h.section === 'vod' && h.stream_id === 50)).toBe(true)
    expect(player.watchHistory.filter((h) => h.section === 'live').length).toBeLessThanOrEqual(4)
  })

  it('salva o progresso no item indicado, mesmo que o player já esteja em outro', async () => {
    const { usePlayerStore } = await setup()
    const player = usePlayerStore()
    await player.hydrate(true)
    player.playItem(MOVIE)

    player.playItem({ stream_id: 60, name: 'Outro', section: 'vod' })
    player.saveProgress(900, 5400, MOVIE)

    expect(player.getSavedTime(50, 'vod')).toBe(900)
    expect(player.getSavedTime(60, 'vod')).toBe(0)
  })

  it('guarda um único card por série: o episódio mais recente substitui o anterior', async () => {
    const { usePlayerStore } = await setup()
    const player = usePlayerStore()
    await player.hydrate(true)
    const ep = (id, n) => ({ stream_id: id, name: `Série - T1:E${n} - Ep`, section: 'series', seriesId: 'S9' })

    player.playItem(ep(901, 1))
    player.saveProgress(1200, 2700)
    player.playItem(ep(902, 2))
    player.saveProgress(300, 2700)

    const series = player.watchHistory.filter((h) => h.section === 'series')
    expect(series.map((h) => h.stream_id)).toEqual([902])
    expect(series[0].seriesId).toBe('S9')
  })
})
