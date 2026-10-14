/**
 * Montagem das URLs de stream do Xtream Codes (módulo puro, sem estado).
 *
 *   live: <base>/live/<user>/<pass>/<stream_id>.m3u8   (fallback: .ts)
 *   vod:  <base>/movie/<user>/<pass>/<stream_id>.<container_extension>
 *
 * SEGURANÇA: as URLs contêm usuário e senha. Elas NUNCA devem ser exibidas na UI
 * nem registradas no console — quem consome deve tratar o descritor como segredo.
 */

/**
 * @typedef {{ primaryUrl: string, fallbackUrl: string|null, isHls: boolean }} StreamDescriptor
 */

/**
 * @param {{ apiBase: string, credentials: {username:string, password:string}|null,
 *           section: 'live'|'vod', item: object }} params
 * @returns {StreamDescriptor|null} `null` se faltar algum dado obrigatório.
 */
export function buildStreamUrl({ apiBase, credentials, section, item } = {}) {
  // Se o item tiver directUrl, reproduz diretamente sem depender de credenciais Xtream
  if (item && item.directUrl) {
    const direct = String(item.directUrl)
    return {
      primaryUrl: direct,
      fallbackUrl: null,
      isHls: direct.indexOf('.m3u8') !== -1,
    }
  }

  const base = String(apiBase || '').replace(/\/+$/, '')
  const username = credentials ? credentials.username : ''
  const password = credentials ? credentials.password : ''
  const streamId = item ? item.stream_id : undefined

  if (!base || !username || !password || streamId === undefined || streamId === null || streamId === '') {
    console.warn('[streamUrl] Dados insuficientes para montar o stream (base/credenciais/stream_id).')
    return null
  }

  const user = encodeURIComponent(String(username))
  const pass = encodeURIComponent(String(password))
  const id = encodeURIComponent(String(streamId))

  if (section === 'live') {
    return {
      primaryUrl: `${base}/live/${user}/${pass}/${id}.m3u8`,
      fallbackUrl: `${base}/live/${user}/${pass}/${id}.ts`,
      isHls: true,
    }
  }

  if (section === 'vod') {
    const ext =
      String(item.container_extension || 'mp4')
        .replace(/^\./, '')
        .toLowerCase() || 'mp4'
    return {
      primaryUrl: `${base}/movie/${user}/${pass}/${id}.${ext}`,
      fallbackUrl: null,
      isHls: ext === 'm3u8',
    }
  }

  if (section === 'series') {
    const ext =
      String(item.container_extension || 'mp4')
        .replace(/^\./, '')
        .toLowerCase() || 'mp4'
    return {
      primaryUrl: `${base}/series/${user}/${pass}/${id}.${ext}`,
      fallbackUrl: null,
      isHls: ext === 'm3u8',
    }
  }

  console.warn('[streamUrl] Seção desconhecida:', section)
  return null
}
