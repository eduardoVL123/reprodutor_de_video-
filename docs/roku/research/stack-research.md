# Pesquisa de stack — Roku (2026-11-18)

> Fase RESEARCH. Fontes oficiais lidas no markdown bruto de `developer.roku.com` (o site bloqueia leitura automática);
> links abaixo na forma canônica. **UNVERIFIED** = não confirmado; só se resolve testando em aparelho.

## Plataforma alvo

| Item | Fato | Fonte |
|---|---|---|
| Roku OS mais recente | 16.0 (nó Effect, `roWebSocket`, SSE no `roUrlTransfer`) | https://developer.roku.com/dev/docs/release-notes |
| Mínimo para a loja | `rsg_version=1.3` e firmware mínimo **15.1.0** (erro bloqueante desde 1º out. 2026) | https://developer.roku.com/dev/docs/static-analysis-tool |
| Aparelhos | todos os que recebem o OS atual (cert. 3.1); RAM de 512 MB a 2 GB; os de 512 MB têm UI 720p | https://developer.roku.com/dev/docs/hardware , https://developer.roku.com/dev/docs/memory-management |
| Resolução da UI | `ui_resolutions=fhd` → coordenadas 1920×1080, escaladas em aparelhos 720p | https://developer.roku.com/dev/docs/channel-manifest |

## Modelo de arquitetura (o que muda em relação ao Vue)

| Conceito no app atual | Roku | Fonte |
|---|---|---|
| Componentes Vue + reatividade | Componentes SceneGraph (XML + `.brs`), campos com observers | https://developer.roku.com/dev/docs/handling-application-events |
| `fetch` em qualquer lugar | `roUrlTransfer` **só em Task node**; `ParseJson`/`ReadAsciiFile` também só em Task | https://developer.roku.com/dev/docs/task , https://developer.roku.com/dev/docs/brightscript-support |
| Render bloqueada = jank | Render bloqueada **mata o app** (10 s produção, 3 s sideload) | https://developer.roku.com/dev/docs/threads |
| HTTPS automático | `SetCertificatesFile("common:/certs/ca-bundle.crt")` obrigatório | https://developer.roku.com/dev/docs/rourltransfer |
| localforage (IndexedDB) | `roRegistry` **32 KB por app** (zlib + cifrado, `Flush()`) + `tmp:` (volátil) e `cachefs:` (RAM, some no reboot) | https://developer.roku.com/dev/docs/roregistry , https://developer.roku.com/dev/docs/file-system |
| `JSON.parse` em streaming (`src/utils/jsonArrayReader.js`) | `ParseJson` inteiro; limite de memória para 50k+ itens **UNVERIFIED**; usar `AsyncGetToFile` para `tmp:` | https://developer.roku.com/dev/docs/global-utility-functions |
| ID da plataforma (`src/services/deviceIdentity.js:47-59`) | `roDeviceInfo.GetChannelClientId()` (persistente, por app); `GetDeviceUniqueId()` obsoleto | https://developer.roku.com/dev/docs/ifdeviceinfo |
| hls.js + `<video>` (`src/composables/useVideoEngine.js`) | nó `Video` nativo | https://developer.roku.com/dev/docs/video |
| Motor de foco geométrico (`src/utils/spatialNavigation.js`) | foco nativo (`setFocus`/`onKeyEvent`), RowList/MarkupGrid/ZoomRowList com foco embutido | https://developer.roku.com/dev/docs/rowlist , https://developer.roku.com/dev/docs/markupgrid |
| Teclado na tela (`src/components/SearchScreen.vue`) | DynamicKeyboard / StandardKeyboardDialog (**exigidos** pela cert. 4.12) | https://developer.roku.com/dev/docs/dynamic-keyboard |

## Vídeo

- `streamFormat`: `mp4`, `hls`, `dash`, `ism`, `mkv`, `mp3`. MPEG-TS só **dentro de HLS**. TS cru por HTTP
  (fallback `.ts` de `src/services/streamUrl.js:53-61`) **UNVERIFIED** — relatos de que não funciona.
  https://developer.roku.com/dev/docs/content-metadata , https://developer.roku.com/dev/docs/media
- Codecs: AVC até 1080p, HEVC até 4K/HDR, AV1 só DASH; MPEG-2 não listado.
- Erros: `errorCode` 0/-1 rede/-2 timeout/-3/-4 sem streams/-5 formato/-6 DRM → mapeiam para `PLAYBACK_ERROR` e
  `NO_SIGNAL_ERROR` (`src/composables/useVideoEngine.js:9-14`). https://developer.roku.com/dev/docs/video
- Faixas de áudio/legenda nativas (`availableAudioTracks`, `availableSubtitleTracks`) — o app atual não tem.

## Criptografia (necessidades em `docs/roku/research/dependency-map.md`)

| Necessidade | Uso no app | Roku nativo | Fonte |
|---|---|---|---|
| SHA-256 | deviceKey, PIN (`deviceIdentity.js:61-64`, `parentalStore.js:27-34`) | ✅ `roEVPDigest` | https://developer.roku.com/dev/docs/roevpdigest |
| AES-256-GCM em repouso | senha Xtream (`crypto.js:38-61`) | ❌ só **AES-128-GCM** (OS 15.2+); ✅ `roDeviceCrypto` (chave do app/aparelho) serve para repouso | https://developer.roku.com/dev/docs/roevpcipher , https://developer.roku.com/dev/docs/rodevicecrypto |
| ECDSA P-256 verify | licença (`licenseSignature.js:39-48`) | ❌ não existe; ✅ `roRSA.Verify` (RSA; "sha256" **UNVERIFIED**) | https://developer.roku.com/dev/docs/ifrsa |
| ECDH P-256 + AES-256-GCM | pareamento e inbox (`pairingCrypto.js:54-69`) | ❌ não existe | idem |
| Atestação do aparelho | — | ✅ `ChannelStore.getDeviceAttestationToken` (JWT RS256 assinado pela Roku) | https://developer.roku.com/dev/docs/channelstore |

Nenhuma biblioteca ECC em BrightScript puro encontrada; desempenho de aritmética de 256 bits **UNVERIFIED**.

## Loja e certificação (critérios out. 2026) — https://developer.roku.com/dev/docs/certification

- Home pronta em **15 s**; troca de tela 3 s; resposta a tecla **250 ms**; vídeo começa em **8 s**; pacote ≤ **4 MB**.
- Voltar (4.6): volta um nível; na home sai do app com no máximo um diálogo — bate com `ExitConfirm.vue`.
- **Deep linking obrigatório** (5.1/5.2) com `contentId`/`mediaType`. https://developer.roku.com/dev/docs/implementing-deep-linking
- **Miniaturas de trick play obrigatórias** em VOD > 15 min (4.7) — servidores IPTV não fornecem.
  https://developer.roku.com/dev/docs/trick-mode
- Bookmark obrigatório em VOD > 15 min por 30 dias (4.10); replay instantâneo 10-25 s (4.9).
- Teclados de voz Roku para e-mail/PIN/senha (4.12). Ativos: ícone 540×405 e 290×218, splash 1920×1080 e 1280×720.
- Beta: até **20 testadores**, **120 dias**. Canais não certificados ("private") **acabaram em 23 fev. 2022**.
  https://developer.roku.com/dev/docs/channel-publishing-guide , https://cordcuttersnews.com/rip-roku-non-certified-channels-aka-private-channels-set-to-go-dark-feb-23/

## Cobrança e política de conteúdo

- Distribution Agreement §10.3 (28 ago. 2026): "You must use Roku Pay exclusively for all end-user payments related to
  your Product"; proíbe direcionar o usuário a pagar fora da plataforma.
  https://docs.roku.com/api/v1/published/developerdistribution/en/us/text
- Certificação 2.2/2.5: login e cadastro **no aparelho**; proibido mecanismo de ativação externo. A página de Roku Pay
  proíbe expressamente "rendezvous linking" (código/QR). https://developer.roku.com/dev/docs/roku-pay-requirements
- Repasse: apps pagos recebem 80 % (Exhibit C do Agreement). Definição de "Subscription Services" (50 %) **UNVERIFIED**.
- Conteúdo: §13.1/§14.2 proíbem material que infrinja direitos de terceiros; em 2018 a Roku removeu o "M3u Playlist
  Player". Não há regra que cite M3U/Xtream; presença atual de players IPTV na loja **UNVERIFIED**.
  https://roku.com/about/content-policy , https://cordcuttersnews.com/roku-bans-m3u-playlist-player-as-their-piracy-crackdown-continues/

## Ferramentas (npm/GitHub em 2026-11-18)

| Ferramenta | Versão estável | Papel | Fonte |
|---|---|---|---|
| BrighterScript | 0.73.8 | compilador/linguagem (tipos, classes, namespaces) | https://github.com/rokucommunity/brighterscript |
| bslint | 0.8.47 | lint | https://github.com/rokucommunity/bslint |
| Rooibos (`rooibos-roku`) | 5.17.0 | testes unitários no aparelho | https://github.com/rokucommunity/rooibos |
| roku-deploy | 3.18.4 | sideload/pacote por CLI (CI) | https://github.com/rokucommunity/roku-deploy |
| roku-test-automation | 2.2.2 | e2e via Node | https://github.com/rokucommunity/roku-test-automation |
| ropm | 0.11.11 | pacotes | https://github.com/rokucommunity/ropm |
| brs-engine (`brs-node` + `brs-scenegraph`) | 2.7.0 / 0.7.0 | simulador: roda os testes Rooibos no PC e no CI sem aparelho; `roRSA` e vídeo são simulados (não servem para os spikes) | https://github.com/lvcabral/brs-engine/blob/master/docs/rooibos-testing.md |
| Extensão VS Code BrightScript Language | v3.0.1 | debug | https://github.com/rokucommunity/vscode-brightscript-language |

Descartados: maestro-roku (parado desde 2025-06), roku-requests (parado), Roku WebDriver no GitHub (arquivado, mudou para
GitLab). Sideload: modo dev no aparelho + instalador web; ECP na porta 8060, console de debug na 8085.
https://developer.roku.com/dev/docs/developer-setup
