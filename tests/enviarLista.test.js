import { describe, it, expect, vi } from 'vitest'

/** Script do sócio (scripts/enviar-lista.mjs): a TV de verdade abre o que ele envia, e o servidor só vê texto cifrado. */
describe('scripts/enviar-lista.mjs', () => {
  it('cifra para a chave da TV; a TV abre e recebe endereço, usuário, senha e apelido', async () => {
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const { enviarLista } = await import('../scripts/enviar-lista.mjs')
    const tv = await createPairingKeys()
    let sent = null
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).endsWith('/v1/inbox/ABCD2345/key')) return Response.json({ pub: tv.publicKey })
      sent = JSON.parse(init.body)
      return Response.json({ sent: true }, { status: 201 })
    })
    await enviarLista({ codigo: 'abcd2345', url: ' http://servidor.test:8080 ', usuario: 'joao', senha: 'S3nh@', nome: 'Sala', base: 'https://site.test', fetchImpl })
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(['https://site.test/v1/inbox/ABCD2345/key', 'https://site.test/v1/inbox/ABCD2345'])
    expect(Object.keys(sent)).toEqual(['box'])
    expect(sent.box).not.toContain('S3nh@')
    expect(await tv.open(sent.box, 'ABCD2345')).toEqual({ dns: 'http://servidor.test:8080', username: 'joao', password: 'S3nh@', label: 'Sala' })
  })

  it('código inválido não chama o servidor; erro do servidor vira mensagem clara', async () => {
    const { enviarLista } = await import('../scripts/enviar-lista.mjs')
    const fetchImpl = vi.fn(async () => Response.json({ error: 'Código não encontrado.' }, { status: 404 }))
    await expect(enviarLista({ codigo: '1234', url: 'http://x.test', fetchImpl })).rejects.toThrow(/Código inválido/)
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(enviarLista({ codigo: 'ZZZZ9999', url: 'http://x.test', fetchImpl })).rejects.toThrow('Código não encontrado.')
  })
})
