import { describe, it, expect } from 'vitest'
import { createJsonArrayReader } from '@/utils/jsonArrayReader'

/** Listas grandes do Xtream: cada item vira objeto assim que chega, sem guardar o texto inteiro da resposta. */

function readInPieces(text, size) {
  const reader = createJsonArrayReader()
  for (let i = 0; i < text.length; i += size) reader.push(text.slice(i, i + size))
  return reader.finish()
}

const LIST = [
  { stream_id: 1, name: 'Filme, com vírgula [e colchete] {chave}', category_ids: [3, 4] },
  { stream_id: 2, name: 'Aspas \\"escapadas\\" e barra \\\\', nested: { a: [1, { b: 'x' }] } },
  { stream_id: 3, name: 'Ação — 漢字 😀', rating: 4.5, direct_source: '', added: null },
  'texto solto',
  42,
  false,
]

describe('createJsonArrayReader', () => {
  it('dá o mesmo resultado do JSON.parse com a resposta chegando em pedaços de qualquer tamanho', () => {
    const text = String.fromCharCode(0xfeff) + '  \n' + JSON.stringify(LIST, null, 1) + '\n '
    for (const size of [1, 2, 3, 7, 64, text.length]) expect(readInPieces(text, size)).toEqual(LIST)
  })

  it('lista vazia e resposta que não é lista (false, objeto do login) seguem o JSON.parse', () => {
    expect(readInPieces('[]', 1)).toEqual([])
    expect(readInPieces(' [ ] ', 1)).toEqual([])
    expect(readInPieces('false', 2)).toBe(false)
    expect(readInPieces('"FEFE"', 1)).toBe('FEFE') // só o BOM sai do começo, nunca letras
    expect(readInPieces('{"user_info":{"auth":1}}', 5)).toEqual({ user_info: { auth: 1 } })
  })

  it('resposta cortada no meio ou com item inválido falha no fim, como o JSON.parse', () => {
    expect(() => readInPieces('[{"a":1},{"b":', 3)).toThrow()
    expect(() => readInPieces('[{"a":1},{oops}]', 3)).toThrow()
    expect(() => readInPieces('', 1)).toThrow()
    expect(() => readInPieces('<html>erro</html>', 4)).toThrow()
  })

  it('guarda o começo da resposta para a mensagem de erro', () => {
    const reader = createJsonArrayReader()
    reader.push('<html><body>Servidor fora do ar')
    reader.push(' e mais texto')
    expect(reader.head()).toBe('<html><body>Servidor fora do ar e mais texto')
  })
})
