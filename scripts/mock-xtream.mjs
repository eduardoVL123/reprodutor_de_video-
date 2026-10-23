/**
 * Servidor Xtream Codes FALSO para desenvolvimento e testes locais.
 * Redireciona rotas de stream para vídeos reais (HLS e MP4) e fornece capas reais.
 *
 *   npm run mock
 *
 * Variáveis opcionais: MOCK_PORT (8787), MOCK_USER (teste123), MOCK_PASS (senha123),
 *                      MOCK_LIVE (50000), MOCK_VOD (50000), MOCK_DELAY_MS (0)
 *
 * Rotas:
 *   /player_api.php                              API direta
 *   /curto/player_api.php                        responde 302 -> /player_api.php (simula DNS curto)
 *   /live/:user/:pass/:id.m3u8 (e .ts)           responde 302 -> HLS real (alterna entre 4 streams)
 *   /movie/:user/:pass/:id.:ext                  responde 302 -> .m3u8 (HLS Mux) ou .mp4 (Google sample)
 */
import http from 'node:http'

const PORT = Number(process.env.MOCK_PORT || 8787)
const USER = process.env.MOCK_USER || 'teste123'
const PASS = process.env.MOCK_PASS || 'senha123'
const LIVE_COUNT = Number(process.env.MOCK_LIVE || 50000)
const VOD_COUNT = Number(process.env.MOCK_VOD || 50000)
const DELAY = Number(process.env.MOCK_DELAY_MS || 0)

const LIVE_CATS = 40
const VOD_CATS = 30
const SERIES_CATS = 15
const SERIES_COUNT = Number(process.env.MOCK_SERIES || 500)
const GENRES = ['Ação', 'Comédia', 'Drama', 'Aventura', 'Ficção', 'Animação']

// Streams HLS públicos reais estáveis para TV ao Vivo
const HLS_LIVE_STREAMS = [
  'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
]

// Filmes MP4 de uso livre (Blender Foundation, CC BY) para VOD e Séries. Os do Google passaram a responder 403.
const MP4_MOVIES = [
  'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
  'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4',
]

// Capas de demonstração: fotos livres do picsum.photos (as do Google passaram a responder 403).
// Pôster em retrato para filmes e séries; paisagem para episódios.
const getCoverUrl = (id, type) =>
  type === 'series-ep' ? `https://picsum.photos/seed/${type}-${id}/600/340` : `https://picsum.photos/seed/${type}-${id}/400/600`

const range = (n) => Array.from({ length: n }, (_, i) => i + 1)

const liveCategories = range(LIVE_CATS).map((i) => ({
  category_id: String(i),
  category_name: `Categoria de Teste ${i}`,
  parent_id: 0,
}))
const vodCategories = range(VOD_CATS).map((i) => ({
  category_id: String(i),
  category_name: `Gênero de Teste ${i}`,
  parent_id: 0,
}))
const seriesCategories = range(SERIES_CATS).map((i) => ({
  category_id: String(i),
  category_name: `Séries ${GENRES[(i - 1) % GENRES.length]} ${i}`,
  parent_id: 0,
}))

const cache = {}
const lazy = (key, build) => (cache[key] ??= JSON.stringify(build()))

const liveStreams = () =>
  range(LIVE_COUNT).map((i) => ({
    num: i,
    name: `Canal de Teste ${i}`,
    stream_type: 'live',
    stream_id: i,
    stream_icon: getCoverUrl(i, 'live'),
    epg_channel_id: null,
    added: '1700000000',
    category_id: String(((i - 1) % LIVE_CATS) + 1),
    custom_sid: '',
    tv_archive: 0,
    direct_source: '',
    tv_archive_duration: 0,
  }))

const vodStreams = () =>
  range(VOD_COUNT).map((i) => ({
    num: i,
    name: `Filme de ${GENRES[i % GENRES.length]} ${i}`,
    stream_type: 'movie',
    stream_id: i,
    stream_icon: getCoverUrl(i, 'vod'),
    rating: ((i % 50) / 10).toFixed(1),
    added: '1700000000',
    category_id: String(((i - 1) % VOD_CATS) + 1),
    container_extension: 'mp4',
    direct_source: '',
  }))

const seriesStreams = () =>
  range(SERIES_COUNT).map((i) => ({
    num: i,
    name: `Série ${GENRES[i % GENRES.length]} ${i}`,
    series_id: i,
    stream_id: i,
    cover: getCoverUrl(i, 'series'),
    stream_icon: getCoverUrl(i, 'series'),
    plot: `Uma jornada épica de suspense e revelações surpreendentes na temporada desta aclamada série de ${GENRES[i % GENRES.length]}.`,
    rating: ((i % 50) / 10).toFixed(1),
    category_id: String(((i - 1) % SERIES_CATS) + 1),
    container_extension: 'mp4',
  }))

const getSeriesInfo = (seriesId) => {
  const sId = parseInt(seriesId, 10) || 1
  const seasons = [1, 2, 3].map((sNum) => ({
    season_number: sNum,
    name: `Temporada ${sNum}`,
    episode_count: 8,
  }))
  const episodes = {}
  seasons.forEach((season) => {
    episodes[String(season.season_number)] = range(8).map((epNum) => {
      const epId = sId * 100 + season.season_number * 10 + epNum
      return {
        id: epId,
        episode_num: epNum,
        title: `Episódio ${epNum} - Capítulo ${epNum}`,
        container_extension: 'mp4',
        info: {
          movie_image: getCoverUrl(epId, 'series-ep'),
          duration_secs: 2700,
          plot: `No episódio ${epNum} da temporada ${season.season_number}, novos mistérios são revelados e desafios épicos colocam todos à prova.`,
        },
      }
    })
  })
  return {
    seasons,
    episodes,
    info: {
      name: `Série Especial ${sId}`,
      cover: getCoverUrl(sId, 'series'),
      plot: 'Uma trama envolvente com produção cinematográfica e atuações de tirar o fôlego.',
      rating: '9.2',
      releaseDate: '2025',
    },
  }
}

const getVodInfo = (vodId) => {
  const id = parseInt(vodId, 10) || 1
  const genre = GENRES[id % GENRES.length]
  const name = `Filme de ${genre} ${id}`
  return {
    info: {
      name,
      movie_image: getCoverUrl(id, 'vod'),
      backdrop_path: [getCoverUrl(id, 'vod')],
      plot: `Quando um segredo de família vem à tona, uma investigadora precisa atravessar o país em uma corrida contra o tempo. Um longa de ${genre.toLowerCase()} intenso sobre lealdade, escolhas impossíveis e o preço da verdade.`,
      cast: 'Ana Ribeiro, Bruno Carvalho, Camila Duarte, Diego Martins',
      director: 'Helena Costa',
      genre,
      releasedate: '2024-05-17',
      duration: '2h 14min',
      duration_secs: 8040,
      rating: ((id % 50) / 10).toFixed(1),
    },
    movie_data: { stream_id: id, name, container_extension: 'mp4' },
  }
}

const send = (res, status, body, extra = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    ...extra,
  })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    })
    return res.end()
  }

  // Rota 302 de teste para DNS curto
  if (url.pathname === '/curto/player_api.php') {
    return send(res, 302, '', { Location: `/player_api.php${url.search}` })
  }

  // Rota de teste para link ultra-curto (RFC-005): /v ou /vip
  if (url.pathname === '/v' || url.pathname === '/vip') {
    res.writeHead(302, {
      'Location': `/player_api.php?username=${USER}&password=${PASS}`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    })
    return res.end()
  }

  // Rota de teste para lista M3U universal (RFC-005): /lista.m3u
  if (url.pathname === '/lista.m3u') {
    const m3uContent = `#EXTM3U
#EXTINF:-1 tvg-id="1" tvg-name="Globo SP" tvg-logo="https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerFun.jpg" group-title="Canais Abertos",Globo SP HD
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-id="2" tvg-name="ESPN Brasil" tvg-logo="https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerJoyBlazes.jpg" group-title="Esportes",ESPN Brasil 4K
https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8
#EXTINF:-1 tvg-id="3" tvg-name="CNN Brasil" tvg-logo="https://storage.googleapis.com/gtv-videos-bucket/sample/images/Sintel.jpg" group-title="Notícias",CNN Brasil Ao Vivo
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-id="4" tvg-name="Big Buck Bunny" tvg-logo="https://storage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg" group-title="Filmes / Aventura",Big Buck Bunny (2026)
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4
#EXTINF:-1 tvg-id="5" tvg-name="Elephants Dream" tvg-logo="https://storage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg" group-title="Filmes / Ficção",Elephants Dream 4K
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4
#EXTINF:-1 tvg-id="6" tvg-name="For Bigger Blazes" tvg-logo="https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerBlazes.jpg" group-title="Filmes / Ação",For Bigger Blazes (2025)
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4
`
    res.writeHead(200, {
      'Content-Type': 'audio/x-mpegurl; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    })
    return res.end(m3uContent)
  }

  // 1. Rota de reprodução Live TV: /live/:user/:pass/:id.m3u8 e .ts
  const liveMatch = url.pathname.match(/^\/live\/([^/]+)\/([^/]+)\/([^/.]+)\.(m3u8|ts)$/)
  if (liveMatch) {
    const streamId = parseInt(liveMatch[3], 10) || 0
    const targetUrl = HLS_LIVE_STREAMS[Math.abs(streamId) % HLS_LIVE_STREAMS.length]
    res.writeHead(302, {
      'Location': targetUrl,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    })
    return res.end()
  }

  // 2. Rota de reprodução VOD (Filmes): /movie/:user/:pass/:id.:ext
  const movieMatch = url.pathname.match(/^\/movie\/([^/]+)\/([^/]+)\/([^/.]+)\.([a-zA-Z0-9]+)$/)
  if (movieMatch) {
    const streamId = parseInt(movieMatch[3], 10) || 0
    const ext = movieMatch[4].toLowerCase()
    const targetUrl = ext === 'm3u8'
      ? 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
      : MP4_MOVIES[Math.abs(streamId) % MP4_MOVIES.length]

    res.writeHead(302, {
      'Location': targetUrl,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    })
    return res.end()
  }

  // 3. Rota de reprodução Séries (Episódios): /series/:user/:pass/:id.:ext
  const seriesMatch = url.pathname.match(/^\/series\/([^/]+)\/([^/]+)\/([^/.]+)\.([a-zA-Z0-9]+)$/)
  if (seriesMatch) {
    const streamId = parseInt(seriesMatch[3], 10) || 0
    const ext = seriesMatch[4].toLowerCase()
    const targetUrl = ext === 'm3u8'
      ? 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
      : MP4_MOVIES[Math.abs(streamId) % MP4_MOVIES.length]

    res.writeHead(302, {
      'Location': targetUrl,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    })
    return res.end()
  }

  // API Xtream Codes
  if (url.pathname !== '/player_api.php') return send(res, 404, '{}')

  setTimeout(() => {
    const ok = url.searchParams.get('username') === USER && url.searchParams.get('password') === PASS
    const action = url.searchParams.get('action')

    if (!action) {
      return send(
        res,
        200,
        JSON.stringify({
          user_info: ok
            ? { username: USER, auth: 1, status: 'Active', exp_date: null, max_connections: '1' }
            : { auth: 0 },
          server_info: { server_protocol: 'http', timezone: 'America/Sao_Paulo' },
        }),
      )
    }
    if (!ok) return send(res, 200, '{"user_info":{"auth":0}}')

    switch (action) {
      case 'get_live_categories': return send(res, 200, JSON.stringify(liveCategories))
      case 'get_vod_categories': return send(res, 200, JSON.stringify(vodCategories))
      case 'get_series_categories': return send(res, 200, JSON.stringify(seriesCategories))
      case 'get_live_streams': return send(res, 200, lazy('live', liveStreams))
      case 'get_vod_streams': return send(res, 200, lazy('vod', vodStreams))
      case 'get_series': return send(res, 200, lazy('series', seriesStreams))
      case 'get_series_info': {
        const sId = url.searchParams.get('series_id')
        return send(res, 200, JSON.stringify(getSeriesInfo(sId)))
      }
      case 'get_vod_info': {
        const vodId = url.searchParams.get('vod_id')
        return send(res, 200, JSON.stringify(getVodInfo(vodId)))
      }
      default: return send(res, 200, '[]')
    }
  }, DELAY)
})

server.listen(PORT, () => {
  console.log(`[mock-xtream] http://localhost:${PORT}  usuário=${USER} senha=${PASS}`)
  console.log(`[mock-xtream] ${LIVE_COUNT} canais, ${VOD_COUNT} filmes, ${SERIES_COUNT} séries (com capas e redirects reais)`)
})
