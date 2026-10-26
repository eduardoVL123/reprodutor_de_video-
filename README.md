# Pulse Player — reprodutor de mídia neutro

Reprodutor genérico (Vue 3 + Vite + Capacitor) para Smart TVs Samsung (Tizen), LG (webOS) e Android TV.
Não contém nem recomenda conteúdo: o usuário cadastra servidores (API compatível com Xtream) ou playlists M3U
e é o único responsável por eles (aviso legal no primeiro acesso, `src/views/FTUE.vue`).

## Requisitos

- Node.js 22+ (Vite 8). No Windows e no Linux os scripts funcionam igual.
- Para o APK: JDK 21 e Android SDK (o CI já faz isso, ver `.github/workflows/build-apk.yml`).

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento em `http://localhost:5173` (com proxy anti-CORS local) |
| `npm run mock` | Servidor Xtream falso em `http://localhost:8787` (usuário `teste123`, senha `senha123`; ajustável por `MOCK_*`) |
| `npm run pair` | Servidor de pareamento em `http://localhost:8788` (Node local, [`server/pair`](server/pair/README.md)) |
| `npm run pair:dev` | Simulação do Cloudflare Worker em `http://localhost:8788` (RFC-017) |
| `npm test` | Testes (Vitest) |
| `npm run lint` | ESLint |
| `npm run build` | Build web em `dist/` (bundle único para `file://`) |
| `npm run build:tizen` / `npm run build:webos` | Build + pasta pronta para empacotar em `build/tizen` e `build/webos` |
| `npm run icons` | Regera os ícones das lojas a partir da marca (`platforms/*/…png`) |
| `npm run cap:sync` | Sincroniza o projeto Android (Capacitor) |

## Suporte e compatibilidade

Piso: **Chromium 63** (Samsung Tizen 5.0+ / LG webOS 5+). O build é ES2017 em um único script clássico (módulos ES
não carregam por `file://`), e `src/utils/compat.js` + o plugin em `tailwind.config.js` trocam `gap` de flexbox por
margens em WebViews sem suporte (Chromium < 84). Modelos mais antigos que isso não são suportados.

## Comportamento por plataforma

| | Samsung / LG | Android TV | Celular / tablet Android | Navegador (PC) |
| --- | --- | --- | --- | --- |
| Voltar na tela inicial | sai do app | sai do app | sai do app | não faz nada |
| App sai da tela (Home) | pausa o vídeo | pausa o vídeo | vídeo vai para o pop-up (PiP) se estiver tocando | continua |
| Teclas de mídia (Play, Pause, Stop, ⏪, ⏩, canal) | sim | sim | — | teclado de mídia |
| Ponteiro (Magic Remote / mouse) | o item sob o ponteiro recebe o foco | — | toque | mouse |
| Sem internet | aviso no topo da tela | igual | igual | igual |

O pop-up (Picture-in-Picture) é um plugin nativo do próprio app
(`android/.../PictureInPicturePlugin.java`): o player liga a entrada automática só enquanto um vídeo está
tocando; dentro do pop-up os controles somem; fechar o pop-up pausa o vídeo. Não é usado em TVs.

## Adicionar lista pelo celular (pareamento, RFC-016 e RFC-017)

Em vez de digitar a URL da lista no controle remoto, o usuário escaneia um QR code (ou abre um endereço curto) no
celular, cola o link recebido por WhatsApp/e-mail e confirma na TV. A lista é cifrada no celular e só a TV abre; o
serviço no meio ([`server/pair`](server/pair/README.md), Cloudflare Workers via [`RFC-017`](docs/rfc/RFC-017-pareamento-cloudflare-workers.md))
guarda apenas texto cifrado por alguns minutos.

- **Ligar:** defina `VITE_PAIR_BASE_URL` (endereço https do serviço, sem barra final; local: `http://localhost:8788`
  com `npm run pair`) ao gerar o build. No CI, é a variável do repositório `PULSE_PAIR_BASE_URL`. Como publicar o
  serviço (Docker + HTTPS automático): [`server/pair/README.md`](server/pair/README.md#publicar). Vazio = o app não mostra essa opção, não contacta nenhum serviço e o login
  fica só com o teclado do controle.
- **Privacidade:** com o serviço ligado, o aviso legal (`src/views/FTUE.vue`) e a política ([`PRIVACY.md`](PRIVACY.md))
  precisam descrevê-lo; o texto do aviso já muda sozinho conforme o build. O endereço do serviço também deve constar
  nos formulários das lojas ([`docs/lojas/PUBLICACAO.md`](docs/lojas/PUBLICACAO.md), seção 7).
- **Sem o serviço no ar** o app continua funcionando: a tela mostra o erro e "Digitar manualmente".

## Publicação

### Android TV / Play

1. Crie uma chave de publicação (fora do repositório) e cadastre nos *Secrets* do GitHub:
   `PULSE_KEYSTORE_BASE64`, `PULSE_KEYSTORE_PASSWORD`, `PULSE_KEY_ALIAS`, `PULSE_KEY_PASSWORD`.
2. O CI gera APK/AAB *release* assinado quando esses segredos existem. Localmente, defina as variáveis
   `PULSE_KEYSTORE_FILE`, `PULSE_KEYSTORE_PASSWORD`, `PULSE_KEY_ALIAS`, `PULSE_KEY_PASSWORD` e rode
   `./gradlew assembleRelease bundleRelease` em `android/`.
3. A chave `android/app/pulse-debug.p12` é só de *debug* (pública) e não serve para publicar.
4. O link fixo para a TV (Release `v2.0.0`, app Downloader) só é atualizado com o APK *release* assinado, ou seja,
   depois de cadastrar os segredos do passo 1. O APK de debug fica apenas como artefato do CI (30 dias), porque
   qualquer pessoa pode assinar uma "atualização" falsa com a chave pública.

### Samsung (Tizen)

1. `PULSE_TIZEN_PACKAGE_ID=<id do seu certificado, 10 caracteres> npm run build:tizen`
2. `tizen package -t wgt -s <perfil de certificado> -- build/tizen` (Tizen Studio CLI).
3. Envie o `.wgt` no Samsung Seller Office.

### LG (webOS)

1. `npm run build:webos`
2. `ares-package build/webos` (webOS TV CLI) e envie o `.ipk` no LG Seller Lounge.
3. Opcional: inclua a biblioteca `webOSTV.js` da LG para que `webOS.platformBack()` encerre o app com a tecla Voltar
   (sem ela o app usa `window.close()`).

> Os manifestos em `platforms/` e os ícones gerados são pontos de partida: **nenhum pacote foi testado em
> aparelho ou emulador** neste repositório. Valide em Tizen Studio / webOS Studio antes de submeter.

### Checklist das lojas

Passo a passo, textos da loja, informações para o revisor, checklist da Samsung item a item e roteiro de teste na TV:
[`docs/lojas/PUBLICACAO.md`](docs/lojas/PUBLICACAO.md). A lista de demonstração para os revisores está em
[`docs/demo`](docs/demo).

## Estrutura

- `src/services` — API Xtream, M3U, catálogo em IndexedDB, cifra da senha, plataforma (sair do app).
- `src/stores` — Pinia: sessão, catálogo, player, perfis.
- `src/composables/useVideoEngine.js` — `<video>` + hls.js com fallback e watchdog.
- `src/utils/spatialNavigation.js` — navegação por controle remoto (D-pad).
- `android/` — projeto Capacitor (WebView com requisições nativas para evitar CORS).
- `scripts/` — servidor mock, proxy de desenvolvimento, empacotamento para TVs.
- `server/pair/` — servidor de pareamento no Cloudflare Workers e página do celular (RFC-016 / RFC-017).
- `tests/` — Vitest (jsdom + IndexedDB falso).

## Segurança

- A senha das listas é guardada cifrada (AES-GCM, chave não extraível). Sem WebCrypto, o app cai para texto puro
  (comportamento de último recurso).
- Pareamento pelo celular: cifra de ponta a ponta (ECDH P-256 + AES-GCM); a chave privada fica só na memória da TV e
  a TV pede confirmação do servidor recebido antes de importar. Sem WebCrypto, a opção não é oferecida.
- O APK usa validação TLS padrão do Android; um painel com https inválido é tentado em http (ver `xtreamApi.js`).
- `usesCleartextTraffic` continua ativo porque servidores de mídia de usuários costumam ser só http.
- `npm audit --omit=dev` deve ficar sem vulnerabilidades; os avisos restantes estão na cadeia de build do Tailwind 3
  (ferramenta de desenvolvimento, nada vai para o app).
