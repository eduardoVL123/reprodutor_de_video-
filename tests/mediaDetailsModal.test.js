import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const MOVIE = { stream_id: 101, name: 'O Último Horizonte', section: 'vod' }
const SERIES = { series_id: 202, stream_id: 202, name: 'Maré Alta', section: 'series' }

const SERIES_INFO_MOCK = {
  info: {
    name: 'Maré Alta',
    plot: 'Uma vila de pescadores...',
    rating: '9.1',
    releasedate: '2023',
    genre: 'Suspense',
    backdrop_path: ['http://srv.test/backdrop.jpg'],
  },
  episodes: {
    1: [
      { id: 1001, season: 1, episode_num: 1, title: 'O Começo', info: { duration_secs: 2880 } },
      { id: 1002, season: 1, episode_num: 2, title: 'O Barco', info: { duration_secs: 3000 } },
    ],
    2: [
      { id: 2001, season: 2, episode_num: 1, title: 'O Farol', info: { duration_secs: 3120 } },
    ],
  },
}

async function setup(props) {
  vi.doMock('@/services/xtreamApi', async (importOriginal) => ({
    ...(await importOriginal()),
    fetchVodInfo: vi.fn(async () => ({
      name: 'O Último Horizonte',
      plot: 'Uma navegadora parte...',
      rating: '8.4',
      year: '2024',
      duration: '2h 14min',
      genre: 'Aventura',
      backdrop: 'http://srv.test/movie_backdrop.jpg',
      poster: 'http://srv.test/movie_poster.jpg',
    })),
    fetchSeriesInfo: vi.fn(async () => SERIES_INFO_MOCK),
  }))

  const { createPinia, setActivePinia } = await import('pinia')
  const pinia = createPinia()
  setActivePinia(pinia)

  const { default: MediaDetailsModal } = await import('@/components/MediaDetailsModal.vue')
  return mount(MediaDetailsModal, {
    props,
    global: { plugins: [pinia] },
    attachTo: document.body,
  })
}

let wrapper
afterEach(() => {
  if (wrapper) wrapper.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('MediaDetailsModal — visual 2.0 e episódios em fileira', () => {
  it('no filme, renderiza os botões de ação e dados do filme', async () => {
    wrapper = await setup({ item: MOVIE, section: 'vod' })
    await flushPromises()

    expect(wrapper.find('#details-play-btn').exists()).toBe(true)
    expect(wrapper.find('#details-fav-btn').exists()).toBe(true)
    expect(wrapper.find('#details-back-btn').exists()).toBe(true)
    expect(wrapper.text()).toContain('O Último Horizonte')
  })

  it('na série, renderiza temporadas e episódios na fileira deslizante com miniaturas 16:9', async () => {
    wrapper = await setup({ item: SERIES, section: 'series' })
    await flushPromises()

    expect(wrapper.find('#series-play-btn').exists()).toBe(true)
    expect(wrapper.find('#series-fav-btn').exists()).toBe(true)
    expect(wrapper.find('#series-back-btn').exists()).toBe(true)

    // Abas de temporadas
    expect(wrapper.find('#season-tab-1').exists()).toBe(true)
    expect(wrapper.find('#season-tab-2').exists()).toBe(true)

    // Episódios em HorizontalRail
    expect(wrapper.find('#episode-card-0').exists()).toBe(true)
    expect(wrapper.find('#episode-card-1').exists()).toBe(true)
    expect(wrapper.text()).toContain('O Começo')
  })

  it('clicar em Voltar emite evento close', async () => {
    wrapper = await setup({ item: MOVIE, section: 'vod' })
    await flushPromises()

    await wrapper.find('#details-back-btn').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
