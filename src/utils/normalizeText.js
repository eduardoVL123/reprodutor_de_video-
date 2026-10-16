const DIACRITICS = /[̀-ͯ]/g
// Mantém letras latinas sem acento, dígitos e alfabetos não latinos (grego, cirílico, árabe,
// CJK...). Símbolos (│ ★ ▶), pontuação geral e emojis (surrogates) viram espaço.
const NON_WORD = /[^0-9a-zͰ-῿Ⰰ-퟿豈-﷿]+/g

/** Remove acentos e passa para minúsculas, sem mexer na pontuação (1 caractere de entrada => 1 de saída na maioria dos casos). */
export function foldText(text) {
  return String(text == null ? '' : text)
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
}

/**
 * Forma canônica para busca: minúsculas, sem acentos, pontuação vira espaço,
 * espaços colapsados. Ex.: "Homem-Aranha: Longe de Casa" => "homem aranha longe de casa".
 */
export function normalizeText(text) {
  return foldText(text).replace(NON_WORD, ' ').trim()
}
