import { describe, it, expect } from 'vitest'
import { buildStreamUrl } from '@/services/streamUrl'

const creds = { username: 'joao', password: 'segredo' }
const build = (apiBase, section, item) => buildStreamUrl({ apiBase, credentials: creds, section, item: { stream_id: 7, ...item } })

describe('buildStreamUrl: o formato alternativo nunca rebaixa https para http (senha vai na URL)', () => {
  it.each([
    ['live', {}],
    ['vod', { container_extension: 'mkv' }],
    ['vod', { container_extension: 'mp4' }],
    ['series', { container_extension: 'avi' }],
  ])('lista https, %s %o: principal e alternativo em https', (section, item) => {
    const d = build('https://painel.test:443', section, item)
    expect(d.primaryUrl.startsWith('https://')).toBe(true)
    expect(d.fallbackUrl.startsWith('https://')).toBe(true)
  })

  it('alternativos: ao vivo em .ts, mkv em .mp4, mp4 em .m3u8', () => {
    expect(build('https://p.test', 'live', {}).fallbackUrl).toBe('https://p.test/live/joao/segredo/7.ts')
    expect(build('https://p.test', 'vod', { container_extension: 'mkv' }).fallbackUrl).toBe('https://p.test/movie/joao/segredo/7.mp4')
    expect(build('http://p.test', 'vod', { container_extension: 'mp4' }).fallbackUrl).toBe('http://p.test/movie/joao/segredo/7.m3u8')
  })

  it('o descritor leva a seção: o motor decide a reconexão do canal ao vivo por ela', () => {
    expect(build('https://p.test', 'live', {}).section).toBe('live')
    expect(build('https://p.test', 'vod', {}).section).toBe('vod')
    expect(build('', 'live', { directUrl: 'http://m3u.test/live/1.m3u8' }).section).toBe('live')
  })
})
