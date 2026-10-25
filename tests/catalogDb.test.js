import { describe, it, expect, vi } from 'vitest'

const streams = (n) =>
  Array.from({ length: n }, (_, i) => ({ stream_id: i + 1, name: `Item ${i + 1}`, category_id: String((i % 2) + 1) }))

describe('catalogDb', () => {
  it('lê janelas de itens por categoria e conta corretamente', async () => {
    const { saveSection, getItems, getMeta, ALL_CATEGORIES } = await import('@/services/catalogDb')

    await saveSection('vod', { categories: [], streams: streams(1200) })

    expect((await getMeta('vod')).count).toBe(1200)
    const all = await getItems('vod', ALL_CATEGORIES, 498, 4)
    expect(all.map((i) => i.stream_id)).toEqual([499, 500, 501, 502])
    const cat1 = await getItems('vod', '1', 0, 3)
    expect(cat1.map((i) => i.stream_id)).toEqual([1, 3, 5])
  })

  it('item em várias categorias (category_ids dos painéis novos) aparece em todas elas', async () => {
    const { saveSection, getItems, getMeta } = await import('@/services/catalogDb')
    const multi = [
      { stream_id: 1, name: 'Ação e Comédia', category_id: '10', category_ids: [10, 20] },
      { stream_id: 2, name: 'Só Comédia', category_id: '20', category_ids: [20] },
      { stream_id: 3, name: 'Lançamento', category_id: '10', category_ids: [10, 30] },
      { stream_id: 4, name: 'Antigo', category_id: '10' },
    ]

    await saveSection('vod', { categories: [], streams: multi })

    const { counts, count } = await getMeta('vod')
    expect(count).toBe(4)
    expect(counts).toMatchObject({ 10: 3, 20: 2, 30: 1 })
    expect((await getItems('vod', '20', 0, 10)).map((i) => i.stream_id)).toEqual([1, 2])
    expect((await getItems('vod', '30', 0, 10)).map((i) => i.stream_id)).toEqual([3])
  })

  it('descarta catálogo salvo por versão anterior do app, forçando novo download', async () => {
    const { default: localforage } = await import('localforage')
    const legacy = localforage.createInstance({ name: 'neutral-media-player', storeName: 'catalog', driver: localforage.INDEXEDDB })
    await legacy.setItem('meta:vod', { count: 1, chunkSize: 500, chunkCount: 1, counts: { 1: 1 } })
    const { getMeta } = await import('@/services/catalogDb')

    expect(await getMeta('vod')).toBeNull()
  })

  it('cota do IndexedDB estoura no meio da gravação: chunks só em memória não somem ao ler os do banco', async () => {
    const data = new Map()
    vi.doMock('localforage', () => ({
      default: {
        INDEXEDDB: 'asyncStorage',
        createInstance: () => ({
          getItem: async (k) => (data.has(k) ? data.get(k) : null),
          setItem: async (k, v) => {
            if (/^chunk:vod:[3-9]$/.test(k)) throw new Error('QuotaExceededError') // chunks 0-2 cabem, o resto não
            data.set(k, v)
          },
          removeItem: async (k) => data.delete(k),
          clear: async () => data.clear(),
        }),
      },
    }))
    const { saveSection, getItems, ALL_CATEGORIES } = await import('@/services/catalogDb')

    await saveSection('vod', { categories: [], streams: streams(4000) }) // 8 chunks de 500 (> 6 do LRU)

    // Ler os chunks do banco (0, 1, 2) enche o LRU e expulsava os chunks que só existiam em memória.
    for (const start of [0, 500, 1000]) await getItems('vod', ALL_CATEGORIES, start, 1)

    expect((await getItems('vod', ALL_CATEGORIES, 1500, 2)).map((i) => i.stream_id)).toEqual([1501, 1502])
    expect((await getItems('vod', ALL_CATEGORIES, 3998, 2)).map((i) => i.stream_id)).toEqual([3999, 4000])
  })

  it('clearCatalog remove tudo', async () => {
    const { saveSection, getMeta, clearCatalog } = await import('@/services/catalogDb')
    await saveSection('live', { categories: [], streams: streams(3) })

    await clearCatalog()

    expect(await getMeta('live')).toBeNull()
  })
})
