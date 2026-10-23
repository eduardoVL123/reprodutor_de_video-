/**
 * Temporadas e fila de episódios de uma série (resposta de get_series_info). Usado pela tela da série e pelo
 * "Continuar assistindo": a fila tem a série inteira, então o próximo episódio passa de uma temporada para a outra.
 */

/** Episódios de uma temporada: painéis devolvem array ou objeto. */
export function episodesOf(seriesData, seasonKey) {
  const episodes = seriesData && seriesData.episodes
  const list = episodes ? episodes[seasonKey] : null
  if (Array.isArray(list)) return list
  return list && typeof list === 'object' ? Object.values(list) : []
}

/** Número da temporada: campo `season` do episódio (painéis que devolvem array) ou a chave. */
export function seasonNumberOf(seriesData, seasonKey) {
  const first = episodesOf(seriesData, seasonKey)[0]
  const fromEpisode = first ? parseInt(first.season, 10) : NaN
  return isNaN(fromEpisode) ? parseInt(seasonKey, 10) || 0 : fromEpisode
}

/** Temporadas com episódios, em ordem: [{ key, number }]. */
export function seasonsOf(seriesData) {
  const episodes = seriesData && seriesData.episodes
  if (!episodes || typeof episodes !== 'object') return []
  return Object.keys(episodes)
    .filter((key) => episodesOf(seriesData, key).length > 0)
    .map((key) => ({ key, number: seasonNumberOf(seriesData, key) }))
    .sort((a, b) => a.number - b.number)
}

export const episodeTitle = (ep) => ep.title || ep.name || `Episódio ${ep.episode_num}`

/** Itens do player para todos os episódios, temporada após temporada. */
export function buildSeriesPlaylist({ seriesData, seriesName, seriesId, fallbackImage = '' }) {
  return seasonsOf(seriesData).flatMap((season) =>
    episodesOf(seriesData, season.key).map((ep) => ({
      stream_id: ep.id,
      name: `${seriesName} - T${season.number}:E${ep.episode_num} - ${episodeTitle(ep)}`,
      stream_icon: (ep.info && ep.info.movie_image) || fallbackImage,
      container_extension: ep.container_extension || 'mp4',
      section: 'series',
      seriesId,
    })),
  )
}

/** "Maré Alta - T1:E2 - O Barco" → "Maré Alta" (nome salvo no histórico). */
const seriesNameFromEpisode = (name) => String(name || '').split(/\s+-\s+T\d+:E\d+/i)[0].trim()

/**
 * Toca um item do "Continuar assistindo". Episódio: carrega a série e toca a fila inteira a partir dele.
 * Filme, canal ou série que não carregou: toca só o item (a posição salva continua valendo).
 * @param {object} item entrada do histórico
 * @param {{ player: object, loadSeries: (seriesId) => Promise<object> }} deps
 */
export async function playHistoryItem(item, { player, loadSeries }) {
  if (item.section !== 'series' || !item.seriesId) {
    player.playItem(item)
    return
  }
  try {
    const seriesData = await loadSeries(item.seriesId)
    const info = (seriesData && seriesData.info) || {}
    const items = buildSeriesPlaylist({
      seriesData,
      seriesName: info.name || seriesNameFromEpisode(item.name) || 'Série',
      seriesId: item.seriesId,
      fallbackImage: info.cover || item.stream_icon || '',
    })
    const startIndex = items.findIndex((it) => String(it.stream_id) === String(item.stream_id))
    if (startIndex >= 0) {
      player.playPlaylist({ items, startIndex, section: 'series' })
      return
    }
  } catch (err) {
    console.warn('[seriesPlaylist] Série indisponível, tocando só o episódio:', err && err.message)
  }
  player.playItem(item)
}
