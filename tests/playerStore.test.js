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
