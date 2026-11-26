# Domínios candidatos — port Roku

> Fase RESEARCH. Agrupamento a partir das comunidades do grafo (`graphify-out/GRAPH_REPORT.md`) e dos imports reais.
> Classe: **P** = lógica pura (porta como algoritmo), **UI** = tela/componente (reescrita em SceneGraph),
> **PB** = presa à plataforma web (precisa de substituto Roku). Complexidade 1-10 conforme
> `assessment-framework` (tamanho, dependências, testes, criticidade).

## Resumo

| # | Domínio | LOC aprox. | Classe dominante | Testes Vitest que viram spec | Complexidade | Ordem |
|---|---|---|---|---|---|---|
| D0 | Fundação Roku (projeto, build, foco, Voltar/Sair) | ~1.150 | PB | spatialNavigation (23), exitConfirm (5) | 6 | 1º |
| D1 | Cliente Xtream/M3U e URLs de stream | ~1.300 | P | xtreamApi (21), m3uGroups (13), jsonArrayReader (4), streamUrl (2) | 5 | 2º |
| D2 | Identidade, plataforma e armazenamento | ~420 | PB | platform (18), errorLog (6), crypto (2) | 5 | 2º |
| D3 | Sessão, listas, login e FTUE | ~1.200 | P + UI | authStore (16), login (6), legal* (15), router (7) | 7 | 3º |
| D4 | Catálogo e busca | ~1.400 | P + PB (dados) | catalogDb (8), catalogStore.m3u (6), parental (12) | 8 | 3º |
| D5 | Telas de navegação (home, catálogo, detalhes, busca) | ~3.800 | UI | sideMenu (13), horizontalRail (13), catalogBrowser (7), mediaDetailsModal (7), searchScreen (3), dashboardHome (6) | 8 | 4º |
| D6 | Player | ~2.700 | UI + PB | videoPlayerOverlay (34), playerStore (14), useVideoEngine* (14) | 9 | 4º |
| D7 | Perfis e controle parental | ~770 | P + UI | profileStore (5), profileGate (5), parental (12) | 4 | 5º |
| D8 | Licença | ~700 | P + PB (cripto) | licenseClient (38), licenseWatch (8), activationRequired (14), licenseRules (25) | 9 | 5º |
| D9 | Pareamento por celular e inbox do site | ~900 | PB (cripto) | usePairing (27), pairPanel (27), siteInbox (13), pairingApi (10), pairingCrypto (6) | 9 | 6º |

LOC somadas a partir do inventário (`wc -l`) feito na pesquisa; números arredondados.

## D0 — Fundação Roku

**Módulos**: `src/utils/spatialNavigation.js` (1017 LOC), `src/components/ExitConfirm.vue` (80), `src/utils/tabBack.js`
(14), `src/services/platform.js:20-73` (sair/Voltar), `src/App.vue`, `src/router/index.js`.
**Regra a preservar**: prioridade de tecla (`spatialNavigation.js:5-10`) — edição de texto → handlers de tecla →
Voltar em pilha (`registerBackHandler`, L276) → setas. Em rota raiz o Voltar chama o handler de saída (L856-868).
Diálogo "Sair do Pulse Player?" com foco inicial em Cancelar (`ExitConfirm.vue:29-30`).
**Observação**: na Roku o foco é nativo do SceneGraph (`setFocus`/`onKeyEvent`); o motor geométrico **não é portado**,
só o comportamento (pilha de Voltar, memória de foco por grupo, confirmação de saída).

## D1 — Cliente Xtream/M3U

**Módulos**: `src/services/xtreamApi.js` (456), `xtreamTransport.js` (177), `xtreamErrors.js` (117),
`src/services/m3uParser.js` (202), `src/utils/jsonArrayReader.js` (91), `src/services/streamUrl.js` (92).
**Acoplamento**: baixo — só depende de `netEnv.maskSecrets`. É folha do grafo: **bom primeiro alvo**.
**Regras críticas**: retry `:8080` (`xtreamApi.js:225-234`); downgrade https→http só em falha de transporte/525/526
(L94-100, 123-135); validação `auth=='1'` e `status=='active'` (L283-287); `resolveShortInput` (L349-456);
classificação M3U VOD (`m3uParser.js:105-110`) e ids `djb2` (L113-128); fallbacks de URL (`streamUrl.js:53-79`).
**Diferença Roku**: sem `fetch` com stream; `roUrlTransfer` em Task node. O leitor JSON incremental não tem equivalente
direto — ver risco R3.

## D2 — Identidade, plataforma e armazenamento

**Módulos**: `src/services/deviceIdentity.js` (113), `platform.js` (181), `storage.js` (47), `errorLog.js` (84),
`crypto.js` (80), `netEnv.js` (51).
**Regras**: `deviceKey = sha256Hex("pulse-license:" + platformId)` (`deviceIdentity.js:61-64,103`); servidor só aceita
`^[A-Za-z0-9_-]{16,128}$` (`server/license/license-core.mjs:39`). Segredos (senha Xtream, URL M3U, `directUrl`) cifrados
em repouso com AES-GCM (`crypto.js:38-61`; `authStore.js:37-56`; `playerItems.js:61-71`).

## D3 — Sessão, listas, login e FTUE

**Módulos**: `src/stores/authStore.js` (539), `src/views/Login.vue` (264), `src/views/FTUE.vue` (179),
`src/components/ListManagerModal.vue` (493), `src/utils/urlSnippets.js`, `src/router/index.js` (106).
**Acoplamento**: alto — `useAuthStore` é o nó mais conectado (43 arestas) e está nos ciclos com catálogo/player.
**Regras**: login (`authStore.js:176`), troca de lista (L362), remoção (L470), logout (L491); FTUE versão 6
(`src/services/storage.js:20`) obrigatório antes de tudo (`router/index.js:56-63`).

## D4 — Catálogo e busca

**Módulos**: `src/services/catalogDb.js` (430), `src/stores/catalogStore.js` (276), `src/services/catalogSearch.js`
(153), `src/utils/normalizeText.js` (20), `src/composables/useParentalFilter.js` (33).
**Regras**: cache-first por seção; chunks de 500 (`catalogDb.js:25`), LRU de 6 (L29); versão 3 força re-download
(L28,132); itens em várias categorias contam em cada uma (L52-61); busca mínima de 3 caracteres e ranking 0-3
(`catalogSearch.js:11-26`); `foldText` usa NFD (`normalizeText.js:1-20`).
**Diferença Roku**: sem IndexedDB e sem `String.normalize` — ver R3 e R6.

## D5 — Telas de navegação

**Módulos**: `src/views/Dashboard.vue` (1149), `src/components/CatalogBrowser.vue` (806), `MediaDetailsModal.vue` (618),
`SearchScreen.vue` (535), `SideMenu.vue` (284), `GridView.vue` (235), `ui/HorizontalRail.vue` (185), `GridItem.vue`
(126), `AccountScreen.vue` (207), `NetworkStatus.vue` (42); utils `seriesPlaylist.js`, `seriesTitle.js`,
`formatTime.js`, `artwork.js`, `railOffset.js`.
**Visual**: layout B aprovado em `docs/design-2.0/mockups.html` (RFC-014). Cores de marca na `CLAUDE.md` do projeto.
**Observação**: `Dashboard (tela)` tem coesão 0,036 no grafo — candidata a ser dividida em várias telas SceneGraph.

## D6 — Player

**Módulos**: `src/components/VideoPlayerOverlay.vue` (1382), `src/composables/useVideoEngine.js` (749),
`src/stores/playerStore.js` (486), `src/stores/playerItems.js` (108).
**Regras**: watchdog de travamento 10 s, até 3 recuperações (`useVideoEngine.js:46-50`); resume a partir de 15 s e
remoção do histórico a 95 % (`playerStore.js:208-217`); próximo episódio 20 s antes do fim
(`VideoPlayerOverlay.vue:74,493-495`); zapping circular (`playerStore.js:361-397`); seek ±10 s só em VOD
(`VideoPlayerOverlay.vue:598-607`).
**Fora do escopo Roku**: Cast e PiP (`src/services/cast.js`, `platform.js:79-86`). **Faixas de áudio/legenda não existem
hoje** (busca por `audioTracks|textTracks|subtitle` em `src/` sem resultado) — não é paridade, seria feature nova.

## D7 — Perfis e controle parental

**Módulos**: `src/stores/profileStore.js` (152), `src/stores/parentalStore.js` (150), `ProfileGate.vue` (208),
`ParentalModal.vue` (135), `PinDialog.vue` (89).
**Regras**: até 5 perfis, padrões p1/p2/p3 (`profileStore.js:8,27-31`); categoria visível/bloqueada/oculta, bloqueio
automático por `ADULT_NAME` (`parentalStore.js:23,72-78`); PIN 4-8 dígitos, 5 erros → 30 s
(`parentalStore.js:15,20-21,119-124`); PIN em SHA-256 com prefixo `pulse-pin:` (L27-34).

## D8 — Licença

**Módulos**: `src/stores/licenseStore.js` (206), `src/services/licenseApi.js` (77), `licenseSignature.js` (48),
`src/composables/useLicenseWatch.js` (47), `src/views/ActivationRequired.vue` (154), `DiagnosticsDialog.vue` (107).
**Regras**: `blockReason` (`licenseStore.js:165-182`), carência offline 7 dias e tolerância de relógio 24 h (L29-32),
reverificação a cada 6 h (`useLicenseWatch.js:5`), `entry` só para acesso `partner` após 10 s (`licenseStore.js:187-198`).
Resposta assinada ECDSA P-256 em formato P1363 (r‖s) sobre `licenseSignedText` (`licenseSignature.js:39-48`;
`server/license/license-rules.mjs:91-95`).
**Bloqueador provável**: verificação ECDSA sem WebCrypto — ver R1.

## D9 — Pareamento e inbox do site

**Módulos**: `src/composables/usePairing.js` (184), `useSiteInbox.js` (113), `src/services/pairingApi.js` (101),
`pairingCrypto.js` (72), `inboxKeys.js` (34), `PairPanel.vue` (219), `SiteInboxPrompt.vue` (114), `src/utils/qrSvg.js`.
**Regras**: sessão nova a cada pareamento, poll a cada 2 s, até 5 falhas (`usePairing.js:16-17,118,135`); inbox a cada
60 s (`useSiteInbox.js:17`); `box` = ECDH P-256 + AES-256-GCM com AAD (`pairingCrypto.js:6-7,54-69`).
**Bloqueador provável**: ECDH + AES-GCM sem WebCrypto — ver R1.
