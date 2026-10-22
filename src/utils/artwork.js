const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value)

/**
 * Arte de fundo para o destaque e os detalhes, só com imagens da lista do usuário:
 *  - 'backdrop': fundo próprio informado pelo servidor (diferente do pôster);
 *  - 'poster':   só há pôster/logo — a tela amplia, desfoca e escurece;
 *  - 'none':     sem imagem (comum em M3U) — a tela usa o fundo neutro.
 * @param {object|null} item  item do catálogo (`stream_icon`/`cover`)
 * @param {object|null} info  detalhes normalizados (`backdrop`/`poster`, ver normalizeVodInfo)
 * @returns {{ url: string, mode: 'backdrop'|'poster'|'none' }}
 */
export function pickArtwork(item, info) {
  const poster = [info && info.poster, item && item.stream_icon, item && item.cover].find(isHttpUrl) || ''
  const backdrop = info && isHttpUrl(info.backdrop) ? info.backdrop : ''
  if (backdrop && backdrop !== poster) return { url: backdrop, mode: 'backdrop' }
  if (poster) return { url: poster, mode: 'poster' }
  return { url: '', mode: 'none' }
}
