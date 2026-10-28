/**
 * Lê uma resposta JSON que chega em pedaços. Se for um array (as listas do Xtream, de dezenas de MB), cada item vira
 * objeto assim que termina de chegar e o texto já lido é descartado: o texto inteiro nunca fica na memória junto com
 * os objetos, o que derrubava TVs com pouca RAM. Outra resposta (false, objeto do login) é guardada e convertida no
 * fim. Erros (resposta cortada, item inválido) aparecem no `finish()`, como no `JSON.parse`.
 */
const HEAD_MAX = 80

export function createJsonArrayReader() {
  let mode = '' // '' até o 1º caractere útil; 'array' ou 'text'
  let text = '' // modo text: a resposta inteira
  let pending = '' // modo array: o item que ainda está chegando
  let head = ''
  let depth = 0
  let inString = false
  let escaped = false
  let closed = false
  let bad = false
  const items = []

  function flush(raw) {
    const item = raw.trim()
    if (!item) return
    try {
      items.push(JSON.parse(item))
    } catch (_) {
      bad = true
    }
  }

  function scanArray(piece) {
    let from = 0
    for (let i = 0; i < piece.length; i++) {
      const c = piece[i]
      if (inString) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') inString = false
      } else if (c === '"') {
        inString = true
      } else if (c === '{' || c === '[') {
        depth++
      } else if (c === '}' || c === ']') {
        depth--
        if (depth === 0) {
          flush(pending + piece.slice(from, i))
          pending = ''
          closed = true
          if (/\S/.test(piece.slice(i + 1))) bad = true // lixo depois do fim da lista
          return
        }
      } else if (c === ',' && depth === 1) {
        flush(pending + piece.slice(from, i))
        pending = ''
        from = i + 1
      }
    }
    pending += piece.slice(from)
  }

  return {
    push(piece) {
      if (head.length < HEAD_MAX) head += piece.slice(0, HEAD_MAX - head.length)
      if (bad) return
      if (mode === 'text') {
        text += piece
      } else if (mode === 'array') {
        if (closed) bad = bad || /\S/.test(piece)
        else scanArray(piece)
      } else {
        const rest = piece.replace(/^\s+/, '') // \s também remove o BOM (marca de ordem de bytes) do início
        if (!rest) return
        if (rest[0] === '[') {
          mode = 'array'
          depth = 1
          scanArray(rest.slice(1))
        } else {
          mode = 'text'
          text = rest
        }
      }
    },
    finish() {
      if (mode === 'text') return JSON.parse(text)
      if (mode !== 'array' || bad || !closed) throw new SyntaxError('JSON inválido ou incompleto')
      return items
    },
    /** Começo da resposta, para a mensagem de erro. */
    head: () => head,
  }
}
