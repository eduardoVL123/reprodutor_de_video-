import { describe, it, expect } from 'vitest'

describe('pickArtwork — fundo do destaque e dos detalhes', () => {
  it('usa o fundo (backdrop) quando o servidor informa um diferente do pôster', async () => {
    const { pickArtwork } = await import('@/utils/artwork')

    const art = pickArtwork({ stream_icon: 'http://img/poster.jpg' }, { backdrop: 'http://img/fundo.jpg', poster: 'http://img/poster.jpg' })

    expect(art).toEqual({ url: 'http://img/fundo.jpg', mode: 'backdrop' })
  })

  it('sem fundo próprio, usa o pôster (a tela aplica desfoque e vinheta)', async () => {
    const { pickArtwork } = await import('@/utils/artwork')

    expect(pickArtwork({ stream_icon: 'http://img/p.jpg' }, null)).toEqual({ url: 'http://img/p.jpg', mode: 'poster' })
    expect(pickArtwork({ cover: 'http://img/c.jpg' }, { backdrop: 'http://img/c.jpg' })).toEqual({ url: 'http://img/c.jpg', mode: 'poster' })
  })

  it('sem nenhuma imagem (listas M3U sem logo), devolve o modo neutro', async () => {
    const { pickArtwork } = await import('@/utils/artwork')

    expect(pickArtwork({ name: 'Canal' }, {})).toEqual({ url: '', mode: 'none' })
    expect(pickArtwork(null, null)).toEqual({ url: '', mode: 'none' })
  })

  it('não aceita endereços que não sejam http(s)', async () => {
    const { pickArtwork } = await import('@/utils/artwork')

    expect(pickArtwork({ stream_icon: 'javascript:alert(1)' }, null)).toEqual({ url: '', mode: 'none' })
  })
})
