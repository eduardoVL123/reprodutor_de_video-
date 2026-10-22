import { saveSection } from '@/services/catalogDb'

/**
 * Parser leve e compatível com ES2017 para playlists #EXTM3U.
 * Extrai canais ao vivo e filmes/séries VOD, agrupando por categorias e
 * persistindo diretamente no IndexedDB em chunks via catalogDb.
 */

function extractAttribute(attrString, attrName) {
  if (!attrString) return ''
  const regex = new RegExp(`${attrName}=(?:"([^"]*)"|'([^']*)'|([^\\s,]+))`, 'i')
  const match = attrString.match(regex)
  return match ? (match[1] || match[2] || match[3] || '').trim() : ''
}

export function parseM3u(text) {
  if (!text || typeof text !== 'string') {
    return { liveStreams: [], vodStreams: [], liveCategories: [], vodCategories: [] }
  }

  const lines = text.split(/\r?\n/)
  const liveStreams = []
  const vodStreams = []

  const liveCategoryMap = new Map()
  const vodCategoryMap = new Map()

  let currentMeta = null
  let count = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    if (line.startsWith('#EXTINF:')) {
      const commaIdx = line.indexOf(',')
      let attrPart = ''
      let namePart = ''

      if (commaIdx !== -1) {
        attrPart = line.slice(8, commaIdx).trim()
        namePart = line.slice(commaIdx + 1).trim()
      } else {
        attrPart = line.slice(8).trim()
      }

      const logo = extractAttribute(attrPart, 'tvg-logo')
      let group = extractAttribute(attrPart, 'group-title')
      const tvgName = extractAttribute(attrPart, 'tvg-name')
      const displayName = namePart || tvgName || `Canal ${count + 1}`

      if (!group) {
        group = 'Geral'
      }

      currentMeta = {
        name: displayName,
        logo,
        group,
      }
    } else if (!line.startsWith('#')) {
      // É uma URL de stream
      if (currentMeta) {
        count++
        const url = line
        const groupTitle = currentMeta.group || 'Geral'

        // Classificação: se extensão típica de filme ou se group-title indica VOD/Filmes/Séries
        const isVodUrl = /\.(mp4|mkv|avi|mov|wmv|webm)(\?.*)?$/i.test(url)
        const isVodGroup = /filmes?|movies?|vod|s[eé]ries?/i.test(groupTitle)
        const isVod = isVodUrl || isVodGroup
        const section = isVod ? 'vod' : 'live'

        const catMap = isVod ? vodCategoryMap : liveCategoryMap
        if (!catMap.has(groupTitle)) {
          catMap.set(groupTitle, String(catMap.size + 1))
        }
        const categoryId = catMap.get(groupTitle)

        const extMatch = url.match(/\.([a-zA-Z0-9]{3,4})(\?.*)?$/)
        const ext = extMatch ? extMatch[1].toLowerCase() : (isVod ? 'mp4' : 'm3u8')

        const streamItem = {
          stream_id: `m3u_${section}_${count}`,
          num: count,
          name: currentMeta.name,
          stream_icon: currentMeta.logo,
          category_id: categoryId,
          directUrl: url,
          container_extension: ext,
          section,
        }

        if (isVod) {
          vodStreams.push(streamItem)
        } else {
          liveStreams.push(streamItem)
        }

        currentMeta = null
      }
    }
  }

  const liveCategories = Array.from(liveCategoryMap.entries()).map(([name, id]) => ({
    category_id: id,
    category_name: name,
  }))

  const vodCategories = Array.from(vodCategoryMap.entries()).map(([name, id]) => ({
    category_id: id,
    category_name: name,
  }))

  return { liveStreams, vodStreams, liveCategories, vodCategories }
}

/**
 * Processa a lista M3U e salva as seções 'live', 'vod' e 'series' (sempre vazia) no IndexedDB.
 */
export async function importM3uCatalog(m3uText, { onProgress } = {}) {
  const { liveStreams, vodStreams, liveCategories, vodCategories } = parseM3u(m3uText)

  // Salva 'live'
  await saveSection('live', {
    categories: liveCategories,
    streams: liveStreams,
    onProgress: (p) => {
      if (onProgress) onProgress({ section: 'live', progress: p })
    },
  })

  // Salva 'vod'
  await saveSection('vod', {
    categories: vodCategories,
    streams: vodStreams,
    onProgress: (p) => {
      if (onProgress) onProgress({ section: 'vod', progress: p })
    },
  })

  // M3U não tem séries: grava a seção vazia para as três terem catálogo válido.
  await saveSection('series', { categories: [], streams: [] })
  if (onProgress) onProgress({ section: 'series', progress: 1 })

  return {
    liveCount: liveStreams.length,
    vodCount: vodStreams.length,
    liveCategories,
    vodCategories,
  }
}
