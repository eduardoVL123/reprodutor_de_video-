/** Pedaços que mais se repetem nos links de lista: um botão para cada, para digitar menos no controle remoto. */
export const URL_SNIPPETS = ['http://', 'https://', 'www.', '.com', '.net', ':8080', '/']

const PROTOCOL = /^https?:\/\//i

/** Aplica um atalho ao texto: protocolo vai no começo (trocando o que houver), o resto no fim. */
export function applySnippet(value, snippet) {
  const text = value || ''
  if (PROTOCOL.test(snippet)) return snippet + text.replace(PROTOCOL, '')
  return text + snippet
}
