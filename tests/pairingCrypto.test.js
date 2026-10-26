import { describe, it, expect } from 'vitest'
import { b64u } from './helpers/pairTv.js'

/** Lado da TV da cifra do pareamento (RFC-016). O celular é a `PairLib` de verdade, então isto testa o contrato. */

async function phone() {
  await import('../server/pair/public/pair-lib.js')
  return globalThis.PairLib
}

const lista = { dns: 'http://srv.com/get.php?username=a&password=b', username: 'ana', password: 'segredo', label: 'Casa' }

describe('createPairingKeys', () => {
  it('gera uma chave pública de 65 bytes (P-256, base64url) diferente a cada sessão', async () => {
    const { createPairingKeys } = await import('@/services/pairingCrypto')

    const a = await createPairingKeys()
    const b = await createPairingKeys()

    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(b64u.decode(a.publicKey)).toHaveLength(65)
    expect(a.publicKey).not.toBe(b.publicKey)
  })

  it('abre o que o celular cifrou e devolve exatamente a lista enviada', async () => {
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const { seal } = await phone()
    const keys = await createPairingKeys()

    const box = await seal(keys.publicKey, 'K7M2QP', lista)

    expect(await keys.open(box, 'K7M2QP')).toEqual(lista)
  })

  it('completa usuário, senha e apelido que faltarem com texto vazio', async () => {
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const { seal } = await phone()
    const keys = await createPairingKeys()

    const box = await seal(keys.publicKey, 'K7M2QP', { dns: 'servidor.com:8080' })

    expect(await keys.open(box, 'K7M2QP')).toEqual({ dns: 'servidor.com:8080', username: '', password: '', label: '' })
  })

  it('recusa outro código de sessão (a cifra não vale em outra sessão)', async () => {
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const { seal } = await phone()
    const keys = await createPairingKeys()
    const box = await seal(keys.publicKey, 'K7M2QP', lista)

    await expect(keys.open(box, 'ZZZZZZ')).rejects.toThrow('BAD_DATA')
  })

  it('recusa o que foi cifrado para outra TV', async () => {
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const { seal } = await phone()
    const tv = await createPairingKeys()
    const other = await createPairingKeys()
    const box = await seal(other.publicKey, 'K7M2QP', lista)

    await expect(tv.open(box, 'K7M2QP')).rejects.toThrow('BAD_DATA')
  })

  it('recusa dado adulterado no caminho', async () => {
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const { seal } = await phone()
    const keys = await createPairingKeys()
    const bytes = b64u.decode(await seal(keys.publicKey, 'K7M2QP', lista))
    bytes[bytes.length - 1] ^= 1

    await expect(keys.open(b64u.encode(bytes), 'K7M2QP')).rejects.toThrow('BAD_DATA')
  })

  it.each([
    ['lixo', 'isto não é um box!'],
    ['curto demais', 'AAAA'],
    ['vazio', ''],
    ['nulo', null],
  ])('recusa box %s', async (_nome, box) => {
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const keys = await createPairingKeys()

    await expect(keys.open(box, 'K7M2QP')).rejects.toThrow('BAD_DATA')
  })

  it.each([
    ['sem endereço', { username: 'a' }],
    ['endereço que não é texto', { dns: 42 }],
    ['endereço vazio', { dns: '   ' }],
  ])('recusa conteúdo válido na cifra mas %s', async (_nome, conteudo) => {
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const { seal } = await phone()
    const keys = await createPairingKeys()
    const box = await seal(keys.publicKey, 'K7M2QP', conteudo)

    await expect(keys.open(box, 'K7M2QP')).rejects.toThrow('BAD_DATA')
  })
})
