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

describe('parseM3u — auditoria', () => {
  it('vírgula dentro de atributo não corta o nome nem perde o grupo', () => {
    const text = '#EXTM3U\n#EXTINF:-1 tvg-name="Ação, HD" group-title="Filmes, Ação",Rambo\nhttp://h.test/rambo.mp4\n'
    const [item] = parseM3u(text).vodStreams
    expect(item.name).toBe('Rambo')
    expect(parseM3u(text).vodCategories[0].category_name).toBe('Filmes, Ação')
  })

  it('o id vem do endereço: um canal novo no topo não muda o id dos outros', () => {
    const a = '#EXTM3U\n#EXTINF:-1,Canal A\nhttp://h.test/a.m3u8\n'
    const withNewOnTop = '#EXTM3U\n#EXTINF:-1,Novo\nhttp://h.test/novo.m3u8\n#EXTINF:-1,Canal A\nhttp://h.test/a.m3u8\n'
    const before = parseM3u(a).liveStreams[0].stream_id
    const after = parseM3u(withNewOnTop).liveStreams.find((s) => s.name === 'Canal A').stream_id
    expect(after).toBe(before)
    expect(before).not.toContain('h.test') // a URL (que pode ter senha) não vai para o id
  })

  it('a mesma URL repetida ganha ids diferentes', () => {
    const text = '#EXTM3U\n#EXTINF:-1,A\nhttp://h.test/x.m3u8\n#EXTINF:-1,B\nhttp://h.test/x.m3u8\n'
    const ids = parseM3u(text).liveStreams.map((s) => s.stream_id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('parseM3u — fim de linha', () => {
  it('lê igual com \r\n (Windows), sem quebra no final e com linhas em branco', () => {
    const text = '#EXTM3U\r\n\r\n#EXTINF:-1 group-title="Notícias",Canal 1\r\nhttp://h.test/1.m3u8\r\n#EXTINF:-1,Canal 2\r\nhttp://h.test/2.m3u8'
    const { liveStreams } = parseM3u(text)
    expect(liveStreams.map((s) => [s.name, s.directUrl])).toEqual([
      ['Canal 1', 'http://h.test/1.m3u8'],
      ['Canal 2', 'http://h.test/2.m3u8'],
    ])
  })
})
