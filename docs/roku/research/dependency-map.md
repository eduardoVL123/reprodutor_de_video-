# Mapa de dependências — cliente `src/` (base para o port Roku)

> Fase RESEARCH do plano de migração Roku (ver `../00-roadmap.md`). Grafo de apoio: `graphify-out/` (local, fora do Git;
> regenerar com `/graphify`). Todas as referências são `arquivo:linha` do worktree na data de 2026-11-18.

## Stack atual — `package.json:28-58`

| Dependência | Versão | Papel | Equivalente na Roku |
|---|---|---|---|
| vue | ^3.5.43 (L37) | UI reativa | SceneGraph (XML + BrightScript), observers de campo |
| vue-router | ^4.6.4 (L38) | rotas `/ftue`, `/login`, `/dashboard` (`src/router/index.js:9-28`) | troca de nós-tela na `MainScene` |
| pinia | ^4.0.3 (L35) | stores de estado | nó global `m.global` + campos observáveis |
| hls.js | ^1.7.3 (L33) | HLS no navegador (`src/composables/useVideoEngine.js:715-726`) | nó `Video` nativo (ver `stack-research.md`) |
| localforage | ^1.10.0 (L34) | IndexedDB/localStorage (`src/services/storage.js:8-13`) | `roRegistrySection` + `tmp:/`/`cachefs:` |
| qrcode-generator | ^1.4.4 (L36) | QR do pareamento (`src/utils/qrSvg.js`) | QR em BrightScript ou imagem gerada pelo servidor |
| @capacitor/* | ^8.x (L29-32) | Android (Device, App, Cast, PiP) | não se aplica |

Dev: vite ^8.3.3, vitest ^5.0.5, tailwindcss ^3.4.19, jsdom, fake-indexeddb (`package.json:40-58`). Nenhum deles vai
para a Roku; os testes Vitest continuam valendo como **especificação de comportamento**.

## Entrada e fluxo de boot

- `src/main.js`: polyfills (L1) → `applyCompatClasses()` (L12) → `initSpatialNavigation({router})` (L14) →
  `installErrorCapture` (L17) → Pinia + router + mount (L18).
- `src/App.vue:2-5`: `RouterView` + overlays globais `VideoPlayerOverlay`, `NetworkStatus`, `ExitConfirm`.
- Guarda de rota (`src/router/index.js:49-77`): sem aceite do FTUE só `/ftue`; espera `auth.hydrate()` (L67); `requiresAuth`
  (L69-71); logado em `/login` vai para `/dashboard` (L72-74).

## Camadas e quem depende de quem

```
views (FTUE, Login, Dashboard, ActivationRequired)
  └─ components (CatalogBrowser, MediaDetailsModal, SearchScreen, VideoPlayerOverlay, ListManagerModal, PairPanel…)
       └─ composables (useVideoEngine, usePairing, useSiteInbox, useLicenseWatch, useParentalFilter)
            └─ stores (auth, catalog, player, playerItems, license, parental, profile)
                 └─ services (xtreamApi/Transport/Errors, m3uParser, catalogDb, catalogSearch, streamUrl,
                 │            licenseApi, licenseSignature, pairingApi, pairingCrypto, inboxKeys, crypto,
                 │            deviceIdentity, platform, storage, errorLog, cast, netEnv)
                 └─ utils (spatialNavigation, jsonArrayReader, normalizeText, seriesPlaylist, seriesTitle,
                           formatTime, artwork, railOffset, tabBack, urlSnippets, qrSvg, compat)
```

Nós mais conectados no grafo (`graphify-out/GRAPH_REPORT.md`, seção God Nodes): `useAuthStore` (43 arestas),
`useVideoEngine()` (33), `useCatalogStore` (24), `usePlayerStore` (24).

## Ciclos de import (todos entre stores Pinia)

| Ciclo | Evidência |
|---|---|
| authStore ↔ catalogStore | `src/stores/authStore.js:17` / `src/stores/catalogStore.js:3` |
| authStore ↔ playerStore | `src/stores/authStore.js:16` / `src/stores/playerStore.js:6` |
| playerStore ↔ profileStore | `src/stores/playerStore.js:5` / `src/stores/profileStore.js:4` |
| authStore → playerStore → playerItems → authStore | `src/stores/playerStore.js:8`, `src/stores/playerItems.js:5` |

Seguros no JS porque `useXStore()` roda dentro de funções. **Na Roku não há módulos**: o estado compartilhado vai para
`m.global`, e os ciclos somem — mas a ordem de inicialização (`auth.hydrate()` antes de catálogo/player) precisa ser
explícita na `MainScene`.

## Código compartilhado cliente ↔ servidor

| Import | Evidência | Impacto no port |
|---|---|---|
| `licenseSignedText` de `server/license/license-rules.mjs` | `src/services/licenseSignature.js:1`; texto em `server/license/license-rules.mjs:91-95` | reimplementar em BrightScript **byte a byte** (array JSON) |
| `normalizeHost` do mesmo arquivo | `src/stores/licenseStore.js:8`; `server/license/license-rules.mjs:65-74` | reimplementar; testar com os mesmos casos de `tests/licenseRules.test.js` |
| Formato do `box` (sem código compartilhado) | `src/services/pairingCrypto.js:6-7,54-69` ↔ `server/pair/public/pair-lib.js:53-64` | contrato implícito: pub efêmera 65 B ‖ iv 12 B ‖ AES-GCM, AAD = código |
| base64url duplicado | `src/services/pairingCrypto.js:15-27` ↔ `server/pair/pair-core.mjs` `toBase64Url` | reimplementar |

Nenhum arquivo de `server/` importa de `src/`.

## Integrações externas (saída)

| Integração | Onde | Protocolo / auth | Erros |
|---|---|---|---|
| Xtream `player_api.php` (login + 7 ações) | `src/services/xtreamApi.js:59-69,241-302`; ações em `src/stores/catalogStore.js:21-25` | GET HTTPS→HTTP, usuário/senha na query; retry `:8080` (`xtreamApi.js:225-234`) | `XtreamError` (`src/services/xtreamErrors.js:13-27,74`) |
| Playlist M3U | `src/services/xtreamApi.js:307-327,349-456` | GET, valida `#EXTM3U` (L319), 90 s | idem |
| Streams | `src/services/streamUrl.js:21-92` | live `.m3u8` → fallback `.ts`; VOD `<container_extension>` → `direct_source`/`.mp4`/`.m3u8` | `PLAYBACK_ERROR`/`NO_SIGNAL_ERROR` (`useVideoEngine.js:9-14`) |
| Licença `POST /v1/access`, `/v1/entry`, `/v1/inbox/pull`, `/v1/inbox/ack` | `src/services/licenseApi.js:41-77`; servidor `server/license/license-core.mjs:149-166`, `license-inbox.mjs:64-74` | JSON, sem header de auth, identidade = `deviceKey` | `LicenseError` |
| Pareamento `POST /v1/sessions`, `GET /v1/sessions/<code>/payload` | `src/services/pairingApi.js:76-101`; servidor `server/pair/pair-core.mjs:297-366` | JSON, `X-Pair-Secret` | 204/404/429/403 mapeados |

Configuração por build (`import.meta.env`): `VITE_LICENSE_BASE_URL`, `VITE_LICENSE_PUBLIC_KEY`, `VITE_LICENSE_STORE_BUILD`,
`VITE_PAIR_BASE_URL`, `VITE_DEMO_PLAYLIST_URL`. Na Roku viram constantes geradas no build (BrighterScript `bsconst` ou
arquivo gerado).

## Persistência

| Store | Chaves | Evidência | Na Roku |
|---|---|---|---|
| `app` (localforage) | `ftue:accepted`, `auth:session`, `auth:savedLists`, `license:*`, `parental:*`, `app:profiles`, `player:*`, `search:recent:*`, `diag:errors` | `src/services/storage.js:15-20`; `authStore.js:20-21`; `licenseStore.js:20-21`; `parentalStore.js:14-17`; `profileStore.js:6-7`; `playerItems.js:20-30`; `errorLog.js:9-11` | `roRegistrySection` — limite de tamanho a confirmar (`stack-research.md`) |
| `catalog` (IndexedDB) | `meta/categories/index/chunk/search:<sec>`, chunks de 500 itens, LRU de 6 | `src/services/catalogDb.js:7-29` | arquivos em `cachefs:`/`tmp:` (não cabe no registro) |
| `keys` (IndexedDB) | `aes-gcm-v1` (CryptoKey não extraível), `inbox-ecdh-v1` | `src/services/crypto.js:15-21`; `src/services/inboxKeys.js:10-11` | sem equivalente direto — ver `risk-assessment.md` |

## Ramificações por plataforma (onde entra `roku`)

- `src/services/deviceIdentity.js:19-25,47-59`: `devicePlatform()` e ID por plataforma.
- `src/services/platform.js:20-46,67-73,163-180`: sair, Voltar do sistema, primeiro/segundo plano.
- `server/license/license-core.mjs:22`: `PLATFORMS = ['android','tizen','webos','desktop','web']`; valor fora da lista
  é gravado como `'web'` (L115). **Para a licença distinguir Roku é preciso mudar o servidor.**
