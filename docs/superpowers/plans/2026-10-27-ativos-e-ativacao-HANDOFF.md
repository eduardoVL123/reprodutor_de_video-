# Passagem de bastão — RFC-018 (ativos por parceiro e ativação anual)

> **Para a próxima IA/sessão:** cole este arquivo como primeira mensagem, aberto na pasta `reprodutor_de_video`.
> Leia também, nesta ordem: `CLAUDE.md`, `docs/rfc/RFC-018-ativos-e-ativacao.md` (spec aprovada),
> `docs/superpowers/plans/2026-10-27-ativos-e-ativacao.md` (plano de 7 tarefas). Responda em português do Brasil.
> Não faça commit, push nem deploy sem pedido explícito do dono. Testes: `npx vitest run --maxWorkers=2`
> (a máquina tem 7,4 GB de RAM). Não rode `python` no Bash (abre a Loja do Windows e trava).

Data: 2026-10-27. Execução **inline** (o dono escolheu "eu faço aqui, revisão no final").

## Onde parou (atualizado no fim da sessão)

**As 7 tarefas estão implementadas e cada arquivo de teste passou isolado.** Depois da pausa também entraram:
Tarefa 7 (textos legais), limpeza de 24 meses no servidor (`purgeExpired`, prometida na `PRIVACY.md`) e o ID de TV
Samsung (DUID: `webapis.js` injetado por `scripts/package-tv.mjs` + privilégio público `productinfo` no
`platforms/tizen/config.xml`) e LG (LGUDID via `PalmServiceBridge`, com fallback em 3 s), aprovados pelo dono
"se as lojas permitirem" (Samsung: privilégio público; LG: exige consentimento, dado pelo aviso inicial).
`docs/lojas/PUBLICACAO.md` ganhou a linha de declaração do serviço de licença.

**Atualização final (depois da auditoria `/ponytail-audit`):** corrigidos e testados os achados 1 (entrada só com
a lista carregada: `useLicenseWatch(getSession, isListLoaded)`, o Dashboard passa "alguma seção do catálogo pronta"),
2 (painel recusa com 409 trocar a data de um parceiro que já tem entradas), 3 (`handle.sweep` limpa os contadores
por IP a cada minuto no `license-server.mjs`), 4 (no máximo 20 aparelhos novos por IP por dia;
`createLimiter(now, windowMs)` no `pair-core`, compatível) e 8 (log tardio no `tests/activationRequired.test.js`).
**Verificação completa rodada:** `npm run lint` limpo; `npx vitest run --maxWorkers=2` → 69 arquivos, 703 testes,
0 erros; `npm run build` ok (os avisos `EMPTY_IMPORT_META` do build clássico das TVs já existiam com o
`@capacitor/app`; o `@capacitor/device` gera o mesmo aviso).

**Falta só:** o dono decidir os achados 5, 6 e 7 da auditoria (abaixo) e pedir o commit.
**Nada da RFC-018 está commitado.** As tabelas e listas abaixo são o registro do meio da sessão.

### Achados da auditoria que esperam decisão do dono
- **5. Senha em http quando o https falha** (`src/services/xtreamApi.js:311-320`): a API refaz a chamada em
  `http://` com usuário e senha na URL (decisão antiga, RFC-008). Quem bloquear a porta 443 numa rede pública força
  o envio em texto aberto. Correção sugerida: só cair para http se o usuário digitou http, ou lembrar por servidor.
- **6. `sm:`/`md:` no `CatalogBrowser.vue`** (redesenho 26e3666): mesmo erro do menu (regra por largura, contra o
  CLAUDE.md). Trocar por `phone:`. Sintoma: janela estreita no PC mostra o visual de celular e o logo duplicado.
- **7. `/v1/hello` sem uso no app**: apagar a rota e usar `/v1/access` nos testes (≈5 linhas).

### Commits sugeridos (só com pedido do dono)
1. `feat(license): serviço de licença local (RFC-018)` — `server/license/`, `server/pair/pair-core.mjs`,
   `tests/license{Rules,Core,Admin,Server,Pages}.test.js`, `package.json` (script), `.gitignore`, `.env.example`.
2. `feat(app): teste de 7 dias, entrada de parceiro e tela de ativação (RFC-018)` — `src/services/{deviceIdentity,licenseApi,platform}.js`,
   `src/stores/licenseStore.js`, `src/composables/useLicenseWatch.js`, `src/views/{ActivationRequired,Dashboard}.vue`,
   `src/components/ListManagerModal.vue`, `package*.json` (`@capacitor/device`), `android/*.gradle`, workflow do CI,
   `scripts/package-tv.mjs`, `platforms/tizen/config.xml`, testes do app.
3. `docs(legal): privacidade e aviso inicial da licença (RFC-018)` — `PRIVACY.md`, `src/views/FTUE.vue`,
   `src/services/storage.js` (`FTUE_VERSION` 5), `docs/lojas/PUBLICACAO.md`, `docs/rfc/RFC-018-*`,
   `docs/superpowers/plans/*`, testes legais.
Ainda há 3 commits locais antigos sem push (`9b703eb`, `61f7b2c`, `d69b61a`).

```bash
npm run lint
npx vitest run --maxWorkers=2
npm run build
```

| Tarefa | Estado |
|---|---|
| 1. Regras puras (`server/license/license-rules.mjs`) | ✅ 24 testes (`tests/licenseRules.test.js`) |
| 2. Banco + núcleo HTTP (`license-db.mjs`, `license-core.mjs`, `sqlite-d1.mjs`) | ✅ 17 testes (`tests/licenseCore.test.js`) |
| 3. API do painel + servidor Node (`license-admin.mjs`, `license-server.mjs`, `npm run license`) | ✅ (`tests/licenseAdmin.test.js`, `tests/licenseServer.test.js`) |
| 4. Painel `/admin/` + página de planos `/a/:code` (`public/admin/*`, `license-pages.mjs`) | ✅ testes + conferido no navegador |
| 5. App: identidade, API, store, entrada de 10 s, código no Gerenciar listas | ✅ (`tests/licenseClient.test.js`, `licenseWatch`, `listManagerLicense`) |
| 6. Tela "Ative este aparelho" + bloqueio no Dashboard | ✅ código e 6 testes (`tests/activationRequired.test.js`); conferido no navegador (foco no "Já paguei, verificar", `__pulse.audit()` differ 0, `duplicateIds()` = []). Falta só a linha no ledger. |
| 7. Textos legais (`PRIVACY.md`, FTUE, `FTUE_VERSION` 4→5) | ⏳ não começada |
| Verificação final (`npm run lint`, suíte inteira, `npm run build`) | ⏳ só rodei arquivos de teste isolados desde a Tarefa 1 |
| Revisão final (skill executing-plans: revisor do branch inteiro) | ⏳ |

Ledger detalhado (com todas as decisões): `C:\Users\victo\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_12d82b0d-e4b2-4c42-aa17-89554e87320c\progress-ativos.md`
(fora do repositório porque `.superpowers/` não está no `.gitignore`).

## O que falta, em ordem

1. **Fechar a Tarefa 6 no ledger** (decisões abaixo, itens 9 e 10).
2. **Tarefa 7 — textos legais** (TDD: ajustar o teste de guarda da FTUE/versão primeiro):
   - `PRIVACY.md`: nova linha na tabela "Dados que o aplicativo trata": identificador do aparelho (hash SHA-256 do ID
     do Android/da TV, ou código aleatório), domínio (só o host) da lista em uso, datas das entradas, código do aparelho;
     finalidade: licença (teste de 7 dias, ativação anual) e cobrança de servidores parceiros; base legal LGPD
     (execução de contrato / legítimo interesse — dono confirma com o jurídico); guarda de 24 meses; nunca usuário,
     senha ou URL completa. Corrigir a frase "Não envia dados ... para o desenvolvedor" (linha ~28) com a exceção.
   - `src/views/FTUE.vue`: mencionar o teste grátis de 7 dias e a ativação; subir `FTUE_VERSION` em
     `src/services/storage.js` (hoje 4 → 5, comentário "5: licença e teste de 7 dias (RFC-018)").
   - Procurar testes que fixam o texto/versão: `grep -rn "FTUE_VERSION\|legal" tests/`.
3. **Verificação completa:** `npm run lint`, `npx vitest run --maxWorkers=2` (eram 594 antes da RFC-018; agora
   devem ser ~700), `npm run build`. Ler a saída inteira; qualquer vermelho entra no relatório pelo nome.
4. **Revisão final** do diff inteiro (não há commits da RFC-018: revisar com `git diff` + arquivos novos). Itens do
   "Review Focus" do plano: relógio do aparelho errado, servidor fora do ar, parceria no dia 31, host com
   maiúsculas/porta/M3U, entrada repetida. Corrigir Critical/Important com teste RED→GREEN.
5. **Ensaio local ponta a ponta** (opcional, ajuda o dono): `.claude/launch.json` (na pasta-mãe) tem `license-server`
   (porta 8789, token aleatório impresso no log, banco em `%TEMP%\pulse-license-dev.db`). Rodar o app com
   `VITE_LICENSE_BASE_URL=http://127.0.0.1:8789` (não editar `.env.local` sem pedir; usar variável no comando).
6. Perguntar ao dono se quer o commit (sugestão: 3 commits — serviço `server/license`; app; textos legais).

## Arquivos

**Novos (não versionados ainda):**
- `docs/rfc/RFC-018-ativos-e-ativacao.md` (spec, status aprovada), `docs/superpowers/plans/2026-10-27-ativos-e-ativacao.md` (plano), este arquivo.
- `server/license/`: `license-rules.mjs`, `license-db.mjs`, `sqlite-d1.mjs`, `license-core.mjs`, `license-admin.mjs`,
  `license-pages.mjs`, `license-server.mjs`, `README.md`, `public/admin/{index.html,admin.js,admin.css}`.
- `src/services/deviceIdentity.js`, `src/services/licenseApi.js`, `src/stores/licenseStore.js`,
  `src/composables/useLicenseWatch.js`, `src/views/ActivationRequired.vue`.
- Testes: `licenseRules`, `licenseCore`, `licenseAdmin`, `licenseServer`, `licensePages`, `licenseClient`,
  `licenseWatch`, `listManagerLicense`, `activationRequired` (todos em `tests/`).

**Alterados:**
- `server/pair/pair-core.mjs`: `generateCode(taken, length = CODE_LENGTH)` e `export function createLimiter` (compatível).
- `src/services/platform.js`: `export const isWebOS`; `onAppForeground` novo; `onAppBackground` agora usa o helper
  `onAppStateChange(active, cb)` (mesmo comportamento, um só `import('@capacitor/app')`).
- `src/views/Dashboard.vue`: `useLicenseWatch(() => auth.session)`; `showActivation` (= sem player aberto, sem
  escolha de perfil aberta e `license.shouldBlock(auth.session)`); `<ActivationRequired>` antes do `ListManagerModal`;
  **`<main>` corrigido para `pl-[7rem] phone:pl-0 phone:pb-16`** (regressão do commit 61f7b2c).
- `src/components/ListManagerModal.vue`: rodapé `#device-code` com o código do aparelho.
- `package.json`/`package-lock.json`: script `license`; dependência `@capacitor/device@^8.0.3`.
- `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle`: plugin device (`npx cap update android`).
- `.github/workflows/build-apk.yml`: `VITE_LICENSE_BASE_URL: ${{ vars.PULSE_LICENSE_BASE_URL }}`.
- `.env.example`: `VITE_LICENSE_BASE_URL`, `VITE_LICENSE_STORE_BUILD` e as variáveis do servidor (comentadas).
- `.gitignore`: `server/license/.data/`.
- `tests/dashboardHome.test.js` (mock ganhou `onAppForeground`), `tests/sideMenu.test.js` (guarda do `<main>`).
- Fora do repo: `../.claude/launch.json` ganhou a configuração `license-server`.

## Como funciona (resumo para não reler tudo)

- **Servidor** (`npm run license`, Node 24 `node:sqlite`, mesmo SQL do Cloudflare D1): `POST /v1/access
  {deviceKey, platform, host}` cria o aparelho na 1ª vez (teste = agora + 7 dias, código de 8 letras) e responde
  `{access: 'activated'|'trial'|'partner'|'blocked', code, trialEndsAt, activationEndsAt, serverTime}`;
  `POST /v1/entry` grava só no estado `partner` (1 linha por aparelho/parceiro/ciclo com `first_at`/`last_at`;
  ativo = `last_at − first_at ≥ 24 h`, calculado na consulta). `GET /a/:code` = página de planos (R$ 10/ano, contato
  em `LICENSE_CONTACT_URL`). `/admin/api/*` com `Authorization: Bearer LICENSE_ADMIN_TOKEN` (vazio = 503).
- **Ciclo (D3):** do dia da parceria até o mesmo dia do mês seguinte, inclusive; o próximo começa no dia seguinte;
  dia inexistente vira o último do mês; datas em `America/Sao_Paulo`.
- **App:** `VITE_LICENSE_BASE_URL` vazia = recurso desligado. `useLicenseWatch` consulta ao abrir/trocar lista e ao
  voltar ao app, agenda a entrada de 10 s só no estado `partner`, cancela ao sair. `shouldBlock` só bloqueia com
  `blocked` salvo para a MESMA lista e com menos de 7 dias (G2, falha aberta). Do app saem só `deviceKey` (hash),
  `platform`, `host`.

## Decisões tomadas (o dono precisa saber)

1. Sem commits por tarefa (CLAUDE.md); ledger fora do repo.
2. `generateCode` com tamanho opcional e `createLimiter` exportado no `pair-core` (compatível).
3. Rotas do painel em `license-admin.mjs` separado do núcleo.
4. `.env.example` documentado com as variáveis novas (é documentação, não segredo).
5. `launch.json` com `license-server` e token aleatório por partida (nada fixo).
6. **Samsung/LG:** o ID da TV só é usado se `webapis`/`webOS.service` já existirem; o pacote das TVs não carrega essas
   bibliotecas, então nelas reinstalar = aparelho novo (novo teste). Comentário `shortcut:` em `deviceIdentity.js`.
   Custo: abuso de teste por reinstalação nas TVs até carregar `webapis.js` + privilégio `productinfo` e `webOSTV.js`.
7. O app não usa `/v1/hello` (o `/v1/access` já cria o aparelho); a rota existe no servidor.
8. Bloqueio salvo vale só para a mesma lista (senão trocar para lista de parceiro sem internet bloquearia).
9. A tela de ativação espera o player fechar **e** a escolha de perfil fechar (bug achado no navegador: o foco ia
   para um botão escondido atrás do seletor de perfil; coberto por teste).
10. `VideoPlayerOverlay.vue` não foi alterado: a tela de ativação (z-40) cobre o Dashboard e prende o foco, então não
    há como abrir um vídeo novo bloqueado; um vídeo já tocando continua.
11. Regressão minha corrigida: `<main>` do Dashboard ainda usava `md:` para o espaço do menu.

## Bugs achados e corrigidos durante a execução

- `license-server.mjs`: arquivo do painel faltando deixava a resposta pendurada (`writeHead` antes do `readFileSync`).
- Dashboard: `<main>` com `md:pl-[7rem]` (menu lateral cobria o conteúdo no PC estreito).
- Dashboard: tela de ativação roubava o foco do seletor de perfil.

## Pendências fora desta RFC (follow-ups para o dono)

- **3 commits locais não enviados** (feitos antes, a pedido): `9b703eb` tela cheia em WebView antiga, `61f7b2c` menu
  inferior só no celular, `d69b61a` linha do tempo no erro do player. Push só com pedido do dono.
- `CatalogBrowser.vue` ainda tem vários `sm:`/`md:` (tamanhos por largura) do redesenho 26e3666 — contra a regra do
  CLAUDE.md; decidir com o dono.
- Investigação dos vídeos que falham no celular: aguarda a foto do erro com a linha do tempo (APK novo).
- Sem som = áudio E-AC3 (confirmado); correção real é player nativo (Media3 + ffmpeg), não aprovado.
- Hospedar `server/license` na Cloudflare (Worker + D1 + Cloudflare Access no painel) — o dono pediu para deixar
  para depois.
- Carregar `webapis.js`/`webOSTV.js` no pacote das TVs (decisão 6).
- D4 (lojas): validar a política de pagamento antes de publicar; build das lojas com `VITE_LICENSE_STORE_BUILD=1`.
