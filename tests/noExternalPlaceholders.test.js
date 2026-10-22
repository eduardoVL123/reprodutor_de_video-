import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PLAYLIST = '#EXTM3U\n#EXTINF:-1 group-title="Canais",Canal A\nhttp://srv.test/a.m3u8\n'

describe('capas ausentes não buscam imagens de terceiros', () => {
  it('m3uParser deixa a capa vazia quando a playlist não informa logo', async () => {
    const { parseM3u } = await import('@/services/m3uParser')

    expect(parseM3u(PLAYLIST).liveStreams[0].stream_icon).toBe('')
  })

  it('catalogDb devolve itens sem capa com stream_icon vazio', async () => {
    const { saveSection, getItems, ALL_CATEGORIES } = await import('@/services/catalogDb')
    await saveSection('vod', { categories: [], streams: [{ stream_id: 1, name: 'Filme', category_id: '1' }] })

    const [item] = await getItems('vod', ALL_CATEGORIES, 0, 1)

    expect(item.stream_icon).toBe('')
  })

  it('catalogStore deixa a capa de séries vazia quando o painel não informa', async () => {
    vi.doMock('@/services/xtreamApi', async (importOriginal) => ({
      ...(await importOriginal()),
      apiRequest: vi.fn(async () => ({ data: [{ series_id: 5, name: 'Série' }], resolvedUrl: null })),
    }))
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useAuthStore } = await import('@/stores/authStore')
    const { useCatalogStore } = await import('@/stores/catalogStore')
    useAuthStore().session = { id: 'x', type: 'xtream', baseUrl: 'http://srv.test', username: 'u', password: 'p' }

    const [series] = await useCatalogStore().fetchSeriesStreams()

    expect(series.stream_icon).toBe('')
  })

  it('GridItem mostra a inicial do título em vez de uma imagem aleatória', async () => {
    const { default: GridItem } = await import('@/components/GridItem.vue')

    const wrapper = mount(GridItem, { props: { item: { stream_id: 9, name: 'Filme Sem Capa' }, variant: 'poster' } })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('F')
  })
})

describe('guarda de conformidade das lojas (src/)', () => {
  const FORBIDDEN = [
    'picsum.photos',
    'unsplash.com',
    'IPTVSmarter',
    'DESTAQUE DA SEMANA',
    'Escolhidos para você',
    'UMA EXPERIÊNCIA DE CINEMA',
    '4K UHD',
    'EM DESTAQUE',
    'Seu cinema. Sua escolha',
    'Lista VIP',
    'n.tv/vip',
    '>N<',
    'nav-notifications',
    'busca por voz',
    'Remover do histórico',
    'Remover dos favoritos',
  ]

  function listSourceFiles(dir) {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? listSourceFiles(full) : /\.(vue|js)$/.test(name) ? [full] : []
    })
  }

  it.each(FORBIDDEN)('o texto "%s" não aparece no código do app', (text) => {
    const hits = listSourceFiles('src').filter((file) => readFileSync(file, 'utf8').includes(text))

    expect(hits).toEqual([])
  })
})
