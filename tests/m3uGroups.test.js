import { describe, it, expect } from 'vitest'
import { parseM3u } from '@/services/m3uParser'

const list = (group, url) => `#EXTM3U\n#EXTINF:-1 group-title="${group}",Item\n${url}\n`

describe('parseM3u — filme ou canal ao vivo', () => {
  it('grupo "Série A" (futebol) com link de canal continua ao vivo', async () => {
    const r = (await parseM3u(list('Futebol | Série A', 'http://h.test/live/u/p/1.m3u8')))
    expect(r.liveStreams).toHaveLength(1)
    expect(r.vodStreams).toHaveLength(0)
  })

  it('grupo "Série A" mesmo com link sem extensão não vira filme', async () => {
    expect((await parseM3u(list('Futebol | Série A', 'http://h.test/u/p/1'))).vodStreams).toHaveLength(0)
  })

  it('grupo "Séries" com link sem extensão de canal ao vivo ainda vai para VOD', async () => {
    expect((await parseM3u(list('Séries Netflix', 'http://h.test/series/u/p/9'))).vodStreams).toHaveLength(1)
  })

  it('arquivo mp4 é filme mesmo em grupo qualquer', async () => {
    expect((await parseM3u(list('Geral', 'http://h.test/a.mp4'))).vodStreams).toHaveLength(1)
  })
})

describe('parseM3u — auditoria', () => {
  it('vírgula dentro de atributo não corta o nome nem perde o grupo', async () => {
    const text = '#EXTM3U\n#EXTINF:-1 tvg-name="Ação, HD" group-title="Filmes, Ação",Rambo\nhttp://h.test/rambo.mp4\n'
    const [item] = (await parseM3u(text)).vodStreams
    expect(item.name).toBe('Rambo')
    expect((await parseM3u(text)).vodCategories[0].category_name).toBe('Filmes, Ação')
  })

  it('o id vem do endereço: um canal novo no topo não muda o id dos outros', async () => {
    const a = '#EXTM3U\n#EXTINF:-1,Canal A\nhttp://h.test/a.m3u8\n'
    const withNewOnTop = '#EXTM3U\n#EXTINF:-1,Novo\nhttp://h.test/novo.m3u8\n#EXTINF:-1,Canal A\nhttp://h.test/a.m3u8\n'
    const before = (await parseM3u(a)).liveStreams[0].stream_id
    const after = (await parseM3u(withNewOnTop)).liveStreams.find((s) => s.name === 'Canal A').stream_id
    expect(after).toBe(before)
    expect(before).not.toContain('h.test') // a URL (que pode ter senha) não vai para o id
  })

  it('a mesma URL repetida ganha ids diferentes', async () => {
    const text = '#EXTM3U\n#EXTINF:-1,A\nhttp://h.test/x.m3u8\n#EXTINF:-1,B\nhttp://h.test/x.m3u8\n'
    const ids = (await parseM3u(text)).liveStreams.map((s) => s.stream_id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('parseM3u — fim de linha', () => {
  it('lê igual com \r\n (Windows), sem quebra no final e com linhas em branco', async () => {
    const text = '#EXTM3U\r\n\r\n#EXTINF:-1 group-title="Notícias",Canal 1\r\nhttp://h.test/1.m3u8\r\n#EXTINF:-1,Canal 2\r\nhttp://h.test/2.m3u8'
    const { liveStreams } = (await parseM3u(text))
    expect(liveStreams.map((s) => [s.name, s.directUrl])).toEqual([
      ['Canal 1', 'http://h.test/1.m3u8'],
      ['Canal 2', 'http://h.test/2.m3u8'],
    ])
  })
})

describe('parseM3u — lista grande', () => {
  it('cede a vez durante o parse: a TV consegue tratar teclas do controle no meio', async () => {
    const text = '#EXTM3U\n' + Array.from({ length: 5000 }, (_, i) => `#EXTINF:-1 group-title="G",C${i}\nhttp://h.test/${i}.ts`).join('\n')
    let ranDuringParse = false
    const parsing = parseM3u(text).then((r) => ({ r, ranDuringParse }))
    setTimeout(() => {
      ranDuringParse = true
    }, 0)
    const { r, ranDuringParse: ran } = await parsing
    expect(r.liveStreams).toHaveLength(5000)
    expect(ran).toBe(true)
  })
})
