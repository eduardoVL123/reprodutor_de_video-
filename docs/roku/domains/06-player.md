# D6 — Player

## Estado atual
- `src/composables/useVideoEngine.js` (749): hls.js ou nativo L715-726, fallback L480-492, watchdog 10 s e até 3
  recuperações L46-50, erros `PLAYBACK_ERROR`/`NO_SIGNAL_ERROR` L9-14.
- `src/components/VideoPlayerOverlay.vue` (1382): seek ±10 s L598-607 (desligado no live L90/606-607), resume L402-409,
  próximo episódio 20 s antes do fim L74/493-495, zapping, Cast/PiP.
- `src/stores/playerStore.js` (486): janela de 100 itens L13, zapping circular L361-397, progresso ≥ 15 s e remoção a
  95 % L208-217; `src/stores/playerItems.js`: histórico 16 VOD + 4 live L7-8.
- Testes-spec: `tests/videoPlayerOverlay.test.js` (34), `tests/playerStore.test.js` (14), `tests/useVideoEngine*.test.js` (14).

## Estado alvo
- `PlayerScreen` com nó **Video** nativo; `content.streamFormat` vindo de D1; `Live=true` para canais.
- Mapa de erros: `errorCode` -1/-2 → `NO_SIGNAL_ERROR`; -3/-4/-5 → `PLAYBACK_ERROR`; tentar fallback de URL antes de
  mostrar erro (mesma ordem de `src/services/streamUrl.js:73-79`).
- Watchdog sobre `bufferingStatus`/`position` com as mesmas constantes.
- `PlayerState` (histórico, fila, progresso) com as regras de `playerStore` — também é o **bookmark** exigido pela
  cert. 4.10 (guardar ≥ 30 dias).
- Fora: Cast e PiP. Novo: seleção de áudio/legenda (`availableAudioTracks`) — incluída na v1 (passo 5).

## Passos

### 1. PlayerState com regras do playerStore
**Teste**: casos de `tests/playerStore.test.js` portados (resume, 95 %, zapping circular, limites do histórico).

### 2. Tocar live/VOD/série
**Teste**: e2e contra o mock — live toca em ≤ 8 s (cert. 3.x), VOD retoma da posição salva, série oferece próximo episódio.

### 3. Erros e watchdog
**Teste**: e2e com URL quebrada (fallback e depois mensagem); Rooibos do mapa de erros.

### 4. Trick play e replay
**O que muda**: barra de trick play nativa; replay instantâneo 10-25 s (cert. 4.9). Miniaturas só se o servidor IPTV
fornecer (R3 — Q2).
**Rollback**: cada passo é um commit.

### 5. Áudio e legendas (feature nova, pedida em 2026-11-18)
**O que muda**: menu no player com as faixas que o stream já traz — `availableAudioTracks`/`audioTrack` e
`availableSubtitleTracks`/`subtitleTrack` do nó Video (https://developer.roku.com/dev/docs/video); respeitar a
configuração global de legendas da Roku (cert. 4.8). Lembrar o idioma escolhido por perfil.
**Limite**: só aparecem faixas que o servidor IPTV inclui no stream (HLS com áudio alternativo, legendas WebVTT/CEA-608
embutidas, MKV com várias faixas); stream com uma faixa só não terá opção.
**Teste**: e2e com um HLS de teste com 2 áudios e 1 legenda; Rooibos para a escolha de idioma por perfil.

## Riscos
| Risco | Impacto | Mitigação | Evidência |
|---|---|---|---|
| Miniaturas de trick play exigidas (R3) | Alto | pedir isenção à Roku (Q2) | `research/stack-research.md` |
| TS cru e MPEG-2 não tocam (R6) | Médio | `.m3u8` primeiro; erro claro | idem, "Vídeo" |

## Dependências
Depende de D1, D4, D5. Bloqueia Fase 6.
