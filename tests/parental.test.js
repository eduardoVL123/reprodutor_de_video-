import { describe, it, expect, beforeEach, vi } from 'vitest'
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

  it('sem PIN de fábrica: abrir a categoria não cria PIN (quem cria é o Controle parental); depois só ele desbloqueia', async () => {
    const { useParentalStore } = await import('@/stores/parentalStore')
    const parental = useParentalStore()
    await parental.load('p1')
    expect(parental.needsPin()).toBe(true)
    expect(await parental.unlock('vod', CATS[1], '2580')).toBe(false) // a criança não vira dona do PIN
    expect(parental.needsPin()).toBe(true)
    expect(await parental.checkPin('12')).toBe(false) // curto demais: não cria
    expect(await parental.checkPin('2580')).toBe(true) // Controle parental cria o PIN
    expect(await parental.unlock('vod', CATS[1], '2580')).toBe(true)
    expect(parental.needsPin()).toBe(false)
    expect(parental.isLocked('vod', CATS[1])).toBe(false)
    expect(parental.blockedIds('vod', CATS)).toEqual([])
    expect(await parental.checkPin('0000')).toBe(false)
  })

  it('escolha de uma lista não vale para a categoria de mesmo id em outra lista; desbloqueio some ao trocar', async () => {
    const { useParentalStore } = await import('@/stores/parentalStore')
    const parental = useParentalStore()
    await parental.load('p-lista', 'A')
    await parental.setStatus('vod', CATS[2], 'visible') // "3" = Esportes na lista A
    await parental.checkPin('2580') // cria
    await parental.unlock('vod', CATS[1], '2580')
    await parental.load('p-lista', 'B')
    expect(parental.statusOf('vod', { category_id: '3', category_name: 'XXX Adultos' })).toBe('locked') // "3" na lista B
    expect(parental.isLocked('vod', CATS[1])).toBe(true)
    await parental.load('p-lista', 'A')
    expect(parental.statusOf('vod', CATS[2])).toBe('visible')
  })

  it('5 PINs errados: espera 30 s, e nem o certo abre nesse tempo', async () => {
    const { useParentalStore } = await import('@/stores/parentalStore')
    const parental = useParentalStore()
    await parental.load('p-trava')
    await parental.checkPin('2580') // cria
    for (let i = 0; i < 5; i++) expect(await parental.checkPin('1111')).toBe(false)
    expect(await parental.checkPin('2580')).toBe(false)
    expect(parental.pinError()).toMatch(/Espere \d+ s/)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31e3)
    expect(await parental.checkPin('2580')).toBe(true)
    clock.mockRestore()
  })

  it('storage falhou ao ler: não aceita qualquer PIN nem sobrescreve o PIN salvo', async () => {
    const { useParentalStore } = await import('@/stores/parentalStore')
    const { storage } = await import('@/services/storage')
    const parental = useParentalStore()
    const get = vi.spyOn(storage, 'get').mockRejectedValue(new Error('IndexedDB fora'))
    await parental.load('p-erro')
    get.mockRestore()
    expect(parental.needsPin()).toBe(false)
    expect(await parental.unlock('vod', CATS[1], '9999')).toBe(false)
  })

  it('storage falhou ao ler: o que os pais esconderam não aparece; tudo fica bloqueado (auditoria 2026-11-11, item 15)', async () => {
    const { useParentalStore } = await import('@/stores/parentalStore')
    const { storage } = await import('@/services/storage')
    const parental = useParentalStore()
    const get = vi.spyOn(storage, 'get').mockRejectedValue(new Error('IndexedDB fora'))
    await parental.load('p-erro')
    get.mockRestore()
    expect(CATS.map((c) => parental.statusOf('vod', c))).toEqual(['locked', 'locked', 'locked'])
    expect(parental.blockedIds('vod', CATS)).toEqual(['1', '2', '3'])
    await parental.load('p-erro') // leitura volta a funcionar: escolhas normais
    expect(parental.statusOf('vod', CATS[0])).toBe('visible')
  })

  it('trocar o PIN: precisa do atual, e o novo passa a valer', async () => {
    const { useParentalStore } = await import('@/stores/parentalStore')
    const parental = useParentalStore()
    await parental.load('p1')
    await parental.checkPin('2580') // cria
    expect(await parental.changePin('9999', '4321')).toMatch(/incorreto/)
    expect(await parental.changePin('2580', '12')).toMatch(/4 a 8/)
    expect(await parental.changePin('2580', '4321')).toBe('')
    expect(await parental.checkPin('2580')).toBe(false)
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
    await parental.load('p2') // outro perfil sem escolhas próprias: segue o Principal
    expect(parental.blockedIds('vod', CATS)).toEqual(['1'])
    await parental.setStatus('vod', CATS[0], 'visible') // escolha própria do p2
    await parental.load('p2')
    expect(parental.blockedIds('vod', CATS)).toEqual([]) // herdou o '2' visível do Principal e agora tem o '1' visível
    await parental.load('p1') // o Principal não muda
    expect(parental.blockedIds('vod', CATS)).toEqual(['1'])
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

  it('item em duas categorias: bloqueado em uma, some também da outra (itens e contagem)', async () => {
    const db = await import('@/services/catalogDb')
    const cats = [{ category_id: '1', category_name: 'Ação' }, { category_id: '9', category_name: 'Adultos' }]
    const streams = [
      { stream_id: 1, name: 'Ação comum', category_id: '1' },
      { stream_id: 2, name: 'Duplo', category_id: '1', category_ids: ['1', '9'] },
    ]
    await db.saveSection('vod', { categories: cats, streams })
    db.setHiddenCategories('vod', ['9'])

    expect((await db.getItems('vod', '1', 0, 10)).map((i) => i.stream_id)).toEqual([1])
    expect((await db.visibleCategoryCounts('vod'))['1']).toBe(1)

    db.setHiddenCategories('vod', [])
    expect((await db.getItems('vod', '1', 0, 10)).map((i) => i.stream_id)).toEqual([1, 2])
    expect(await db.visibleCategoryCounts('vod')).toBeNull()
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

describe('parentalStore — perfil novo', () => {
  it('perfil sem escolhas próprias herda as do Principal (a criança não escapa criando outro perfil)', async () => {
    const { useParentalStore } = await import('@/stores/parentalStore')
    const parental = useParentalStore()
    await parental.load('p1', 'L')
    await parental.setStatus('vod', CATS[2], 'hidden')

    await parental.load('p-novo', 'L')

    expect(parental.statusOf('vod', CATS[2])).toBe('hidden')
  })
})
