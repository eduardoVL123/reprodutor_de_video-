import { describe, it, expect } from 'vitest'
import { parseM3u } from '@/services/m3uParser'

const list = (group, url) => `#EXTM3U\n#EXTINF:-1 group-title="${group}",Item\n${url}\n`

describe('parseM3u — filme ou canal ao vivo', () => {
  it('grupo "Série A" (futebol) com link de canal continua ao vivo', () => {
    const r = parseM3u(list('Futebol | Série A', 'http://h.test/live/u/p/1.m3u8'))
    expect(r.liveStreams).toHaveLength(1)
    expect(r.vodStreams).toHaveLength(0)
  })

  it('grupo "Série A" mesmo com link sem extensão não vira filme', () => {
    expect(parseM3u(list('Futebol | Série A', 'http://h.test/u/p/1')).vodStreams).toHaveLength(0)
  })

  it('grupo "Séries" com link sem extensão de canal ao vivo ainda vai para VOD', () => {
    expect(parseM3u(list('Séries Netflix', 'http://h.test/series/u/p/9')).vodStreams).toHaveLength(1)
  })

  it('arquivo mp4 é filme mesmo em grupo qualquer', () => {
    expect(parseM3u(list('Geral', 'http://h.test/a.mp4')).vodStreams).toHaveLength(1)
  })
})
