# Ativos por parceiro e ativação anual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** contar aparelhos ativos por servidor parceiro e por ciclo, aplicar teste de 7 dias / bloqueio / ativação anual no app, com painel administrativo local.

**Architecture:** serviço `server/license` no padrão do `server/pair`: regras puras (`license-rules.mjs`), núcleo HTTP em Web Standards (`license-core.mjs`) sobre uma interface de banco no formato do Cloudflare D1, adaptador `node:sqlite` para rodar local (Cloudflare fica para depois, mesmo SQL). No app: identidade do aparelho, `licenseApi`, `licenseStore`, contador de entrada de 10 s e tela de ativação, tudo desligado quando `VITE_LICENSE_BASE_URL` está vazia.

**Tech Stack:** Node 24 (`node:sqlite`), Vue 3 + Pinia, Vitest, Capacitor 8 (`@capacitor/device`).

**Spec:** `docs/rfc/RFC-018-ativos-e-ativacao.md` (aprovada; D1–D5 = recomendações da RFC).

## Global Constraints
- Regras R1–R8 e guardrails G1–G9 da RFC valem para todas as tarefas; G3: do app saem só `deviceKey` (hash), `platform`, `host`.
- Fuso `America/Sao_Paulo`; horários só do servidor (G4). Teste = 7 dias; entrada = lista de parceiro carregada > 10 s; ativo = `lastAt − firstAt ≥ 24 h` no mesmo ciclo.
- D3: ciclo 0 = dia da parceria até o mesmo dia do mês seguinte (inclusive); ciclo k começa no dia seguinte ao fim do ciclo k−1 e termina no mesmo dia do mês seguinte (inclusive). Dia inexistente (31/02) vira o último dia do mês.
- D1: ativação liberada à mão no painel. D2: único plano "Anual — R$ 10 por aparelho". D4: com `VITE_LICENSE_STORE_BUILD=1` a tela de bloqueio não mostra preço nem QR de planos.
- Regras de TV do `CLAUDE.md`: foco (`button`/`.tv-focusable` com `id` único, `data-focus-group`), Chromium 63 (sem `gap` manual, sem `aspect-ratio`, sem `import()` dinâmico novo), `text-tv-xs` mínimo, margem `px-24`/`py-14`.
- Nada fixo no código: URLs/portas/tokens em variáveis (`VITE_LICENSE_BASE_URL`, `LICENSE_PORT`, `LICENSE_DB_PATH`, `LICENSE_ADMIN_TOKEN`, `LICENSE_CONTACT_URL`).
- Verificação: `npm run lint`, `npx vitest run --maxWorkers=2`, `npm run build`. Sem commit/push sem pedido do dono.

## Review Focus
1. Relógio do aparelho errado (ano 2020 ou adiantado) → o servidor ignora; teste e ciclos usam `now()` do servidor. Teste em Task 2.
2. Servidor de licença fora do ar ou lento no app → libera (G2), inclusive sem estado salvo. Teste em Task 5.
3. Parceria fechada no dia 31 → ciclos com mês curto não quebram nem pulam dias. Teste em Task 1.
4. Host digitado com maiúsculas, porta ou `www`/caminho, e lista M3U → todos casam com o domínio cadastrado (`www` é diferente de sem `www`; porta é ignorada). Teste em Task 1.
5. App enviando a mesma entrada várias vezes (reabrir, voltar do segundo plano) → idempotente, não infla ativos. Teste em Task 2.

---

### Task 1: Regras puras (`license-rules.mjs`)

**Files:**
- Create: `server/license/license-rules.mjs`
- Test: `tests/licenseRules.test.js`

**Interfaces:**
- Produces:
  - `TRIAL_MS = 7*24*3600e3`, `ACTIVE_GAP_MS = 24*3600e3`, `ACTIVATION_MS` (1 ano = `addYears`), `TIME_ZONE = 'America/Sao_Paulo'`
  - `localDate(at: Date) -> 'YYYY-MM-DD'` (data em Brasília, via `Intl.DateTimeFormat('en-CA', { timeZone })`)
  - `cycleFor(startedOn: 'YYYY-MM-DD', at: Date) -> { index: number, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } | null` (null antes da parceria)
  - `cyclesUntil(startedOn, at: Date) -> Array<{index,start,end}>` (para o painel listar ciclos)
  - `normalizeHost(urlOrHost: string) -> string` (minúsculas, sem esquema, porta, caminho, usuário; '' se inválido)
  - `accessFor({ trialEndsAt: number, activationEndsAt: number|null, isPartner: boolean, now: number }) -> 'activated'|'trial'|'partner'|'blocked'` (nesta ordem de precedência)
  - `isActive({ firstAt: number, lastAt: number }) -> boolean`
  - `extendActivation(currentEndsAt: number|null, now: number) -> number` (soma 1 ano a `max(now, currentEndsAt)`)

- [ ] **Step 1: Testes de tabela (G5), nomes em português.** Casos obrigatórios:
  - `cycleFor('2026-04-02', 05/04)` → `{index:0,start:'2026-04-02',end:'2026-05-02'}`; `02/05 23:59 BRT` → index 0; `03/05 00:00 BRT` → index 1 `{start:'2026-05-03', end:'2026-06-03'}`.
  - Parceria `2026-01-31`: ciclo 0 termina `2026-02-28`; ciclo 1 começa `2026-03-01`. `01/02 02:00 UTC` (= 31/01 23:00 BRT) cai no ciclo 0.
  - `accessFor`: no teste com lista sem parceria → `trial`; após teste, parceiro → `partner`; após teste sem parceiro → `blocked`; ativação válida → `activated` mesmo no teste; ativação vencida → regra normal.
  - `isActive`: 23h59 → false; exatamente 24 h → true.
  - `normalizeHost('HTTP://AppScdd.Top:8080/get.php?x=1')` → `'appscdd.top'`; `'www.a.com'` fica `'www.a.com'`; `'lixo'`/`''` → `''`.
  - `extendActivation(null, t)` = t + 1 ano; com ativação vencendo em 30 dias → fim atual + 1 ano.
- [ ] **Step 2:** `npx vitest run tests/licenseRules.test.js` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar as funções acima. `cycleFor` itera ciclo a ciclo a partir de `startedOn` (datas como strings `YYYY-MM-DD`, aritmética em UTC meio-dia para não sofrer fuso).
- [ ] **Step 4:** Mesmo comando → PASS.

### Task 2: Banco e núcleo HTTP (`license-db.mjs`, `license-core.mjs`, `sqlite-d1.mjs`)

**Files:**
- Create: `server/license/license-db.mjs`, `server/license/license-core.mjs`, `server/license/sqlite-d1.mjs`
- Test: `tests/licenseCore.test.js`

**Interfaces:**
- Consumes: Task 1 inteira; `CODE_ALPHABET`, `generateCode` de `server/pair/pair-core.mjs` (código do aparelho com 8 caracteres: passar o tamanho ou criar `generateDeviceCode()` no mesmo padrão).
- Produces:
  - `MIGRATIONS: string[]` (tabelas da RFC §2: `devices`, `activations`, `partners`, `partner_hosts`, `partner_cycle_entries`) e `migrate(db) -> Promise<void>`
  - `openSqlite(path: string) -> D1Like` em `sqlite-d1.mjs`, onde `D1Like.prepare(sql).bind(...args)` tem `.first()`, `.all() -> {results}`, `.run()` (todos async), igual ao D1
  - `createLicenseHandler({ db: D1Like, now?: () => number, adminToken: string, contactUrl?: string }) -> (req: Request) => Promise<Response>`
  - Rotas: `POST /v1/hello {deviceKey, platform}` → `{code, trialEndsAt, activationEndsAt, serverTime}`; `POST /v1/access {deviceKey, host}` → `{access, code, trialEndsAt, activationEndsAt, serverTime}`; `POST /v1/entry {deviceKey, host}` → `{recorded: boolean}`; `GET /a/:code` → HTML de planos (Task 4); `/admin/api/*` (Task 3). CORS e cabeçalhos de segurança iguais aos do pair-core.
- [ ] **Step 1: Testes com banco em memória (`openSqlite(':memory:')`) e relógio falso:**
  - `hello` duas vezes com a mesma `deviceKey` → mesmo `code` e mesmo `trialEndsAt` (reinstalar não renova o teste).
  - `deviceKey` fora do formato (vazia, > 128 chars, não hex) → 400; corpo > 4 KB → 413.
  - `access` com host de parceiro ativo após o teste → `partner`; parceiro inativo → `blocked`.
  - `entry` no teste → `{recorded:false}`; após teste com parceiro → `true`; com ativação → `false`; host sem parceria → `false`.
  - Repetir `entry` 5 vezes no mesmo minuto não muda a contagem e mantém `first_at`; entradas 05/04 10:00 e 06/04 10:00 → ativo no ciclo 0 (Review Focus 5).
  - `serverTime` vem do `now()` do servidor, nunca do corpo (Review Focus 1).
- [ ] **Step 2:** `npx vitest run tests/licenseCore.test.js` → FAIL.
- [ ] **Step 3:** Implementar. `entry` faz `INSERT ... ON CONFLICT(device_key, partner_id, cycle_start) DO UPDATE SET last_at = excluded.last_at`. `access`/`entry` sobre `deviceKey` nunca vista executam `hello` implicitamente. Limite por IP em memória como `pair-core` (`hello` 30/min, `access` 60/min, `entry` 60/min).
- [ ] **Step 3b:** Teste de guarda G3 no servidor: `entry`/`access` ignoram e não gravam campos além de `deviceKey`, `platform`, `host`.
- [ ] **Step 4:** PASS.

### Task 3: API do painel e servidor Node local

**Files:**
- Modify: `server/license/license-core.mjs` (rotas `/admin/api/*`)
- Create: `server/license/license-server.mjs`, `server/license/README.md`
- Modify: `package.json` (script `"license": "node server/license/license-server.mjs"`), `.env.example` (variáveis novas, vazias)
- Test: `tests/licenseAdmin.test.js`

**Interfaces:**
- Produces (todas exigem `Authorization: Bearer <LICENSE_ADMIN_TOKEN>`; sem token configurado → 503; token errado → 401):
  - `GET/POST /admin/api/partners`, `PUT /admin/api/partners/:id` `{name, startedOn, active, hosts: string[]}`
  - `GET /admin/api/partners/:id/cycles` → `[{index,start,end,actives}]` (inclui o ciclo em andamento)
  - `GET /admin/api/partners/:id/cycles/:index` → `{start,end,actives,devices:[{code,firstAt,lastAt,active}]}`; `?format=csv` → `text/csv` (`codigo;primeira_entrada;ultima_entrada;ativo`)
  - `GET /admin/api/devices/:code` → `{code, platform, firstSeenAt, trialEndsAt, activationEndsAt, activations:[...]}`
  - `POST /admin/api/devices/:code/activate {note}` (usa `extendActivation`, `source:'manual'`), `POST /admin/api/devices/:code/revoke`
  - `license-server.mjs`: `LICENSE_PORT` (padrão 8789), `LICENSE_HOST` (padrão 127.0.0.1), `LICENSE_DB_PATH` (padrão `server/license/.data/license.db`, pasta no `.gitignore`), `LICENSE_ADMIN_TOKEN`, `LICENSE_CONTACT_URL`; serve `server/license/public/` (Task 4).
- [ ] **Step 1: Testes:** sem token → 401/503; dois aparelhos cobrindo a tabela da RFC (05/04+03/05 não conta, 05/04+02/05 conta) → `actives` = 1 no ciclo 0; host duplicado em dois parceiros → 409; CSV com cabeçalho e uma linha por aparelho; `activate` duas vezes soma 2 anos.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** `npm run license` sobe e `curl -s localhost:8789/v1/hello -d '{"deviceKey":"ab12","platform":"web"}'` devolve `code`.

### Task 4: Páginas do painel e de planos

**Files:**
- Create: `server/license/public/admin/index.html`, `admin.js`, `admin.css`; `plans` gerada no núcleo (`GET /a/:code`)
- Test: `tests/licensePages.test.js`

**Interfaces:**
- Consumes: API da Task 3 (token digitado na página e guardado em `sessionStorage`).
- Produces: painel com três abas (Parceiros, Relatório, Aparelhos), como a RFC §4; página de planos com o código do aparelho, "Anual — R$ 10 por aparelho", instruções de pagamento manual e botão para `LICENSE_CONTACT_URL` (oculto se vazio).
- [ ] **Step 1: Testes:** `GET /a/K7M2QPXA` → 200 HTML com o código e "R$ 10"; código fora do alfabeto → 404; o HTML escapa o código; CSP sem `unsafe-inline` (mesma `PAGE_CSP` do pareamento).
- [ ] **Step 2–4:** FAIL → implementar → PASS. Conferir o painel no navegador com `npm run license` (criar parceiro, ver ciclo, liberar aparelho).

### Task 5: App — identidade, API e store (sem bloquear)

**Files:**
- Create: `src/services/deviceIdentity.js`, `src/services/licenseApi.js`, `src/stores/licenseStore.js`
- Modify: `package.json` (`@capacitor/device` na mesma versão maior do Capacitor), `.env.example` (`VITE_LICENSE_BASE_URL=`, `VITE_LICENSE_STORE_BUILD=`), `.github/workflows/build-apk.yml` (`VITE_LICENSE_BASE_URL: ${{ vars.PULSE_LICENSE_BASE_URL }}`)
- Test: `tests/deviceIdentity.test.js`, `tests/licenseApi.test.js`, `tests/licenseStore.test.js`

**Interfaces:**
- Consumes: rotas `/v1/*` da Task 2.
- Produces:
  - `getDeviceKey() -> Promise<string>`: Android `Device.getId()`; Tizen `webapis.productinfo.getDuid()`; webOS `deviceid/getIDs` (LGUDID); senão UUID salvo em `storage`. Resultado = SHA-256 hex de `'pulse-license:' + id` (Web Crypto; sem cifra disponível → UUID salvo, sem hash).
  - `isLicenseEnabled() -> boolean` (`VITE_LICENSE_BASE_URL` preenchida)
  - `licenseApi.hello({deviceKey, platform})`, `.access({deviceKey, host})`, `.entry({deviceKey, host})` com tempo limite por `Promise.race` (8 s), no padrão de `pairingApi.js`
  - `useLicenseStore()`: estado `{code, access, trialEndsAt, activationEndsAt, checkedAt}` persistido em `storage`; `refresh(host)`; `shouldBlock(now) -> boolean`; `scheduleEntry(host)` / `cancelEntry()`
  - `listHost(session) -> string` (de `session.baseUrl`, importando `normalizeHost` de `server/license/license-rules.mjs`: módulo puro, uma regra só para app e servidor)
- [ ] **Step 1: Testes:**
  - G3: o corpo de cada chamada só tem as chaves permitidas; nunca contém usuário, senha ou caminho da URL (session falsa com senha `S3nh@`).
  - G2 (Review Focus 2): servidor recusa/expira → `shouldBlock` = false sem estado salvo; `blocked` salvo há 6 dias → true; há 8 dias → false.
  - `scheduleEntry` chama `entry` após 10 000 ms; `cancelEntry` aos 9 999 ms → nenhuma chamada; voltar do segundo plano (`onAppBackground` / `visibilitychange`) agenda de novo; app aberto sem parar não repete.
  - Desligado (`VITE_LICENSE_BASE_URL` vazia) → nenhuma chamada de rede.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Ligar no app: `hello` + `refresh` ao entrar no Dashboard e ao trocar de lista (`authStore.switchList`/`login`); `scheduleEntry` só quando `access === 'partner'`. Mostrar "Código do aparelho: XXXXXXXX" no rodapé do `ListManagerModal.vue` (`text-tv-xs`).

### Task 6: Tela de ativação e bloqueio

**Files:**
- Create: `src/views/ActivationRequired.vue`
- Modify: `src/App.vue` ou `src/views/Dashboard.vue` (onde a sessão é aberta: mostrar a tela quando `shouldBlock`), `src/components/VideoPlayerOverlay.vue` (não abrir player com bloqueio; nunca fechar um vídeo já tocando)
- Test: `tests/activationRequired.test.js`

**Interfaces:**
- Consumes: `useLicenseStore()` (Task 5), `qrSvgData` (`src/utils`), visual do `PairPanel.vue`.
- Produces: tela com título "Ative este aparelho", código grande, QR para `${VITE_LICENSE_BASE_URL}/a/${code}` (oculto com `VITE_LICENSE_STORE_BUILD=1`, que mostra "Fale com seu fornecedor"), botões `id="activation-lists"` (abre Gerenciar listas) e `id="activation-retry"` (refaz `refresh`).
- [ ] **Step 1: Testes:** com `access:'blocked'` a tela aparece e o foco vai para `activation-retry`; ids únicos; com `STORE_BUILD` não há QR nem "R$"; vídeo tocando quando chega `blocked` → continua tocando, a tela aparece ao fechar o player; Voltar segue `registerBackHandler` (sai do app como na tela inicial).
- [ ] **Step 2–4:** FAIL → implementar → PASS. `__pulse.audit()` e `__pulse.duplicateIds()` na tela.

### Task 7: Textos legais

**Files:**
- Modify: `PRIVACY.md` (linha da tabela de dados + finalidade, base legal LGPD, guarda de 24 meses), `src/views/FTUE.vue` (menção ao teste de 7 dias e à ativação) e a constante `FTUE_VERSION` (+1)
- Test: o teste de guarda existente da FTUE/versão (ajustar a versão esperada)
- [ ] **Step 1–4:** ajustar teste → FAIL → texto → PASS.

### Verificação final
- [ ] `npm run lint`, `npx vitest run --maxWorkers=2`, `npm run build` verdes.
- [ ] Ensaio local: `npm run license` + `npm run dev` com `VITE_LICENSE_BASE_URL=http://127.0.0.1:8789`: cadastrar parceiro no painel, abrir a lista dele, ver a entrada no relatório; liberar/revogar um aparelho e ver o app mudar. Passagem do tempo (fim do teste, 24 h, ciclos) fica coberta só pelos testes do núcleo.
- [ ] Commit só com pedido do dono.
