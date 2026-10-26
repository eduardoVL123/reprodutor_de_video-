import { describe, it, expect } from 'vitest'
import { b64u, newTv } from './helpers/pairTv.js'

/** Biblioteca da página do celular (RFC-016): achar o link no texto colado, normalizar o código e cifrar para a TV. */

async function load() {
  await import('../server/pair/public/pair-lib.js')
  return globalThis.PairLib
}

describe('extractUrl — achar o link no que o usuário colou', () => {
  it.each([
    ['mensagem de WhatsApp com texto em volta', 'Sua lista: http://srv.com/get.php?username=a&password=b&type=m3u_plus obrigado', 'http://srv.com/get.php?username=a&password=b&type=m3u_plus'],
    ['link entre parênteses e ponto final', 'veja (https://srv.com/lista.m3u).', 'https://srv.com/lista.m3u'],
    ['link entre sinais de menor e maior', '<http://srv.com:8080>', 'http://srv.com:8080'],
    ['vírgula e aspas no fim', 'use "http://srv.com/x",', 'http://srv.com/x'],
    ['dois links: fica o primeiro', 'http://a.com/x\nhttp://b.com/y', 'http://a.com/x'],
    ['protocolo em maiúsculas é mantido', 'HTTP://SRV.com/x', 'HTTP://SRV.com/x'],
    ['endereço sem protocolo (servidor Xtream com usuário e senha à parte)', '  servidor.com:8080  ', 'servidor.com:8080'],
  ])('%s', async (_nome, texto, esperado) => {
    const { extractUrl } = await load()

    expect(extractUrl(texto)).toBe(esperado)
  })

  it.each([['texto solto sem link', 'meu texto sem link'], ['vazio', ''], ['só espaços', '   '], ['nulo', null], ['indefinido', undefined]])(
    'devolve vazio para %s',
    async (_nome, texto) => {
      const { extractUrl } = await load()

      expect(extractUrl(texto)).toBe('')
    },
  )
})

describe('normalizeCode — código digitado no celular', () => {
  it.each([
    [' k7m-2qp ', 'K7M2QP'],
    ['k7m2qp', 'K7M2QP'],
    ['K7M2QP9999', 'K7M2QP'],
    ['0O1IL', ''],
    ['', ''],
    [undefined, ''],
  ])('%j vira %j', async (entrada, esperado) => {
    const { normalizeCode } = await load()

    expect(normalizeCode(entrada)).toBe(esperado)
  })
})

describe('seal — cifrar a lista para a TV', () => {
  const lista = { dns: 'http://srv.com/get.php?username=a&password=b', username: '', password: '', label: 'Minha lista' }

  it('só a TV dona da chave consegue abrir, e recupera exatamente o que foi enviado', async () => {
    const { seal } = await load()
    const tv = await newTv()

    const box = await seal(tv.pub, 'K7M2QP', lista)

    expect(await tv.open(box, 'K7M2QP')).toEqual(lista)
  })

  it('o resultado é texto base64url sem a lista em claro e cabe no limite do servidor', async () => {
    const { seal } = await load()
    const tv = await newTv()

    const box = await seal(tv.pub, 'K7M2QP', lista)

    expect(box).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(box.length).toBeLessThanOrEqual(3600)
    expect(box).not.toContain('srv.com')
  })

  it('duas cifras da mesma lista são diferentes (chave efêmera e iv novos)', async () => {
    const { seal } = await load()
    const tv = await newTv()

    expect(await seal(tv.pub, 'K7M2QP', lista)).not.toBe(await seal(tv.pub, 'K7M2QP', lista))
  })

  it('não vale em outra sessão: com outro código a TV não consegue abrir', async () => {
    const { seal } = await load()
    const tv = await newTv()
    const box = await seal(tv.pub, 'K7M2QP', lista)

    await expect(tv.open(box, 'ZZZZZZ')).rejects.toBeDefined()
  })

  it('outra TV (outra chave) não consegue abrir', async () => {
    const { seal } = await load()
    const tv = await newTv()
    const intruder = await newTv()
    const box = await seal(tv.pub, 'K7M2QP', lista)

    await expect(intruder.open(box, 'K7M2QP')).rejects.toBeDefined()
  })

  it('um byte alterado no caminho faz a abertura falhar', async () => {
    const { seal } = await load()
    const tv = await newTv()
    const bytes = b64u.decode(await seal(tv.pub, 'K7M2QP', lista))
    bytes[bytes.length - 1] ^= 1

    await expect(tv.open(b64u.encode(bytes), 'K7M2QP')).rejects.toBeDefined()
  })

  it('aceita um link de 1900 caracteres e recusa o que passa de 2000', async () => {
    const { seal, MAX_PLAINTEXT_CHARS } = await load()
    const tv = await newTv()
    const grande = { dns: `http://srv.com/${'a'.repeat(1900)}`, username: '', password: '', label: '' }
    const enorme = { dns: `http://srv.com/${'a'.repeat(2100)}`, username: '', password: '', label: '' }

    const box = await seal(tv.pub, 'K7M2QP', grande)

    expect(MAX_PLAINTEXT_CHARS).toBe(2000)
    expect(box.length).toBeLessThanOrEqual(3600)
    expect((await tv.open(box, 'K7M2QP')).dns).toBe(grande.dns)
    await expect(seal(tv.pub, 'K7M2QP', enorme)).rejects.toThrow('too_long')
  })

  it('chave pública da TV inválida dá erro claro', async () => {
    const { seal } = await load()

    await expect(seal('AAAA', 'K7M2QP', lista)).rejects.toBeDefined()
  })
})
