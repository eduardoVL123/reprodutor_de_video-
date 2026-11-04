import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

/** Controle parental e categorias escondidas (plano, itens 1 e 3). */

const CATS = [
  { category_id: '1', category_name: 'Filmes' },
  { category_id: '2', category_name: 'Adultos +18' },
  { category_id: '3', category_name: 'Esportes' },
]
// 6 itens: posições 0-1 em "1", 2-3 em "2" (adulto), 4-5 em "3"
const STREAMS = Array.from({ length: 6 }, (_, i) => ({ stream_id: i + 1, name: `Filme ${i + 1}`, category_id: String(Math.floor(i / 2) + 1) }))

beforeEach(() => setActivePinia(createPinia()))

describe('parentalStore', () => {
  it('categoria com nome adulto já começa bloqueada; o resto, visível', async () => {
    const { useParentalStore } = await import('@/stores/parentalStore')
    const parental = useParentalStore()
    await parental.load('p1')
    expect(CATS.map((c) => parental.statusOf('vod', c))).toEqual(['visible', 'locked', 'visible'])
    expect(parental.blockedIds('vod', CATS)).toEqual(['2'])
  })

  it('PIN inicial 0000 desbloqueia até fechar o app; PIN errado não', async () => {
    const { useParentalStore } = await import('@/stores/parentalStore')
    const parental = useParentalStore()
    await parental.load('p1')
    expect(await parental.unlock('vod', CATS[1], '1234')).toBe(false)
    expect(parental.isLocked('vod', CATS[1])).toBe(true)
    expect(await parental.unlock('vod', CATS[1], '0000')).toBe(true)
    expect(parental.isLocked('vod', CATS[1])).toBe(false)
    expect(parental.blockedIds('vod', CATS)).toEqual([])
  })

  it('trocar o PIN: precisa do atual, e o novo passa a valer', async () => {
    const { useParentalStore } = await import('@/stores/parentalStore')
    const parental = useParentalStore()
    await parental.load('p1')
    expect(await parental.changePin('9999', '4321')).toMatch(/incorreto/)
    expect(await parental.changePin('0000', '12')).toMatch(/4 a 8/)
    expect(await parental.changePin('0000', '4321')).toBe('')
    expect(await parental.checkPin('0000')).toBe(false)
    expect(await parental.checkPin('4321')).toBe(true)
  })

  it('escolha do usuário vale por perfil e sobrevive a reabrir o app', async () => {
    const { useParentalStore } = await import('@/stores/parentalStore')
    let parental = useParentalStore()
    await parental.load('p1')
    await parental.setStatus('vod', CATS[0], 'hidden')
    await parental.setStatus('vod', CATS[1], 'visible')
    setActivePinia(createPinia())
    parental = useParentalStore()
    await parental.load('p1')
    expect(parental.blockedIds('vod', CATS)).toEqual(['1'])
    await parental.load('p2') // outro perfil: padrão de novo
    expect(parental.blockedIds('vod', CATS)).toEqual(['2'])
  })
})

describe('catálogo com categorias fora da vista', () => {
  it('"Todos", contagem e busca deixam de fora as categorias escondidas/bloqueadas', async () => {
    const db = await import('@/services/catalogDb')
    const { searchCatalog } = await import('@/services/catalogSearch')
    await db.saveSection('vod', { categories: CATS, streams: STREAMS })
    db.setHiddenCategories('vod', ['2'])

    expect((await db.getItems('vod', db.ALL_CATEGORIES, 0, 10)).map((i) => i.stream_id)).toEqual([1, 2, 5, 6])
    expect(await db.visibleCount('vod')).toBe(4)
    const found = await searchCatalog('filme', { sections: ['vod'] })
    expect(found.results.map((r) => r.item.stream_id).sort()).toEqual([1, 2, 5, 6])

    db.setHiddenCategories('vod', [])
    expect(await db.visibleCount('vod')).toBeNull()
    expect(await db.getItems('vod', db.ALL_CATEGORIES, 0, 10)).toHaveLength(6)
  })

  it('lista nova já chega filtrada: a contagem de "Todos" nunca mostra o adulto, nem por um instante', async () => {
    const db = await import('@/services/catalogDb')
    await db.saveSection('vod', { categories: CATS, streams: STREAMS })
    const { useCatalogStore } = await import('@/stores/catalogStore')
    const { useParentalStore } = await import('@/stores/parentalStore')
    const catalog = useCatalogStore()
    const parental = useParentalStore()
    await parental.load('p1')
    catalog.setHiddenResolver((section, cats) => parental.blockedIds(section, cats))

    await catalog.loadSection('vod') // cache: publica direto do IndexedDB

    expect(catalog.countFor('vod')).toBe(4)
    expect((await catalog.getItems('vod', db.ALL_CATEGORIES, 0, 10)).map((i) => i.stream_id)).not.toContain(3)
  })
})
