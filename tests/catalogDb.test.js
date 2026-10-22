import { describe, it, expect } from 'vitest'

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

  it('descarta catálogo salvo por versão anterior do app, forçando novo download', async () => {
    const { default: localforage } = await import('localforage')
    const legacy = localforage.createInstance({ name: 'neutral-media-player', storeName: 'catalog', driver: localforage.INDEXEDDB })
    await legacy.setItem('meta:vod', { count: 1, chunkSize: 500, chunkCount: 1, counts: { 1: 1 } })
    const { getMeta } = await import('@/services/catalogDb')

    expect(await getMeta('vod')).toBeNull()
  })

  it('clearCatalog remove tudo', async () => {
    const { saveSection, getMeta, clearCatalog } = await import('@/services/catalogDb')
    await saveSection('live', { categories: [], streams: streams(3) })

    await clearCatalog()

    expect(await getMeta('live')).toBeNull()
  })
})
