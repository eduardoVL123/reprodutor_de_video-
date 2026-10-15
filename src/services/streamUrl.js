/**
 * Montagem das URLs de stream do Xtream Codes (módulo puro, sem estado).
 *
 *   live:   <base>/live/<user>/<pass>/<stream_id>.m3u8   (fallback: .ts)
 *   vod:    <base>/movie/<user>/<pass>/<stream_id>.<ext> (fallback: direct_source, http ou mp4)
 *   series: <base>/series/<user>/<pass>/<stream_id>.<ext>
 *
 * SEGURANÇA: as URLs contêm usuário e senha. Elas NUNCA devem ser exibidas puras na UI.
 * Use sempre maskSecrets() antes de registrar ou exibir qualquer diagnóstico.
 */

/**
 * @typedef {{ primaryUrl: string, fallbackUrl: string|null, isHls: boolean, containerExtension: string }} StreamDescriptor
 */

/**
 * @param {{ apiBase: string, credentials: {username:string, password:string}|null,
 *           section: 'live'|'vod'|'series', item: object }} params
 * @returns {StreamDescriptor|null} `null` se faltar algum dado obrigatório.
 */
export function buildStreamUrl({ apiBase, credentials, section, item } = {}) {
  // Se o item tiver directUrl, reproduz diretamente sem depender de credenciais Xtream
  if (item && item.directUrl) {
    const direct = String(item.directUrl)
    const isHls = direct.indexOf('.m3u8') !== -1
    const extMatch = direct.match(/\.([a-zA-Z0-9]{3,4})(\?.*)?$/)
    const ext = extMatch ? extMatch[1].toLowerCase() : (isHls ? 'm3u8' : 'mp4')
    return {
      primaryUrl: direct,
      fallbackUrl: null,
      isHls,
      containerExtension: ext,
    }
  }

  let base = String(apiBase || '').replace(/\/+$/, '')
  const username = credentials ? credentials.username : ''
  const password = credentials ? credentials.password : ''
  const streamId = item ? (item.stream_id !== undefined && item.stream_id !== null ? item.stream_id : item.id) : undefined

  if (!base || !username || !password || streamId === undefined || streamId === null || streamId === '') {
    console.warn('[streamUrl] Dados insuficientes para montar o stream (base/credenciais/stream_id).')
    return null
  }

  const user = encodeURIComponent(String(username))
  const pass = encodeURIComponent(String(password))
  const id = encodeURIComponent(String(streamId))

  if (section === 'live') {
    const isHttps = base.startsWith('https://')
    return {
      primaryUrl: `${base}/live/${user}/${pass}/${id}.m3u8`,
      fallbackUrl: isHttps
        ? `${base.replace(/^https:\/\//i, 'http://')}/live/${user}/${pass}/${id}.m3u8`
        : `${base}/live/${user}/${pass}/${id}.ts`,
      isHls: true,
      containerExtension: 'm3u8',
    }
  }

  if (section === 'vod' || section === 'series') {
    const sectionPath = section === 'series' ? 'series' : 'movie'
    const ext =
      String(item.container_extension || 'mp4')
        .replace(/^\./, '')
        .toLowerCase() || 'mp4'

    const primaryUrl = `${base}/${sectionPath}/${user}/${pass}/${id}.${ext}`
    let fallbackUrl = null

    if (item.direct_source && /^https?:\/\//i.test(item.direct_source)) {
      fallbackUrl = String(item.direct_source)
    } else if (primaryUrl.startsWith('https://')) {
      const httpBase = base.replace(/^https:\/\//i, 'http://')
      const targetExt = ext === 'mkv' || ext === 'avi' ? 'mp4' : ext
      fallbackUrl = `${httpBase}/${sectionPath}/${user}/${pass}/${id}.${targetExt}`
    } else if (ext === 'mkv' || ext === 'avi') {
      fallbackUrl = `${base}/${sectionPath}/${user}/${pass}/${id}.mp4`
    } else {
      fallbackUrl = `${base}/${sectionPath}/${user}/${pass}/${id}.m3u8`
    }

    return {
      primaryUrl,
      fallbackUrl,
      isHls: ext === 'm3u8',
      containerExtension: ext,
    }
  }

  console.warn('[streamUrl] Seção desconhecida:', section)
  return null
}
