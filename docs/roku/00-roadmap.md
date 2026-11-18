# Pulse Player na Roku — roadmap de migração

> Plano gerado com a skill `legacy-migration-planner` em 2026-11-18. Pesquisa em `research/`, planos por domínio em
> `domains/`. RFC de referência: `docs/rfc/RFC-027-roku.md`.

## Resumo

**Hoje**: cliente Vue 3 + Vite + Capacitor para Tizen, webOS, Android TV e celular (`package.json:28-39`), ~13 mil linhas
em `src/` (`research/domain-candidates.md`), ~1.000 casos Vitest em `tests/`.
**Alvo**: app Roku nativo (BrighterScript → BrightScript + SceneGraph) em `roku/`, publicado na loja pública Roku, com
cobrança **só por Roku Pay** na Roku. `server/` ganha suporte a Roku (plataforma, Roku Pay, assinatura RSA).
**Direção**: *cross-stack em paralelo* — não é strangler fig: o app Vue continua vivo nas outras plataformas. O que
garante paridade são os **contratos com o servidor** e os **testes Vitest usados como especificação**.
**Domínios**: 10 do cliente (D0-D9) + 1 de servidor (DS).
**Riscos principais** (`research/risk-assessment.md`): R2 política de conteúdo IPTV, R3 deep link/trick play na
certificação, R4 cripto sem ECDSA/ECDH, R5 catálogos grandes em aparelho de 512 MB.

## Decisões do usuário

| Decisão | Valor | Data |
|---|---|---|
| Escopo da v1 | Tudo que a versão TV tem hoje | 2026-11-18 |
| Distribuição | Loja pública Roku | 2026-11-18 |
| Cobrança na Roku | **Roku Pay** (aceita repasse de 20 % à Roku) | 2026-11-18 |
| Local do plano | `docs/roku/` | 2026-11-18 |

## Por que essa direção

- Não existe caminho de código compartilhado: Roku não roda HTML/JS (`research/stack-research.md`, "Modelo de
  arquitetura").
- A lógica pura (Xtream, M3U, URLs, busca, regras de licença/parental/player) está isolada em services/stores/utils e
  coberta por testes (`research/domain-candidates.md`) — porta como algoritmo, função por função, teste antes do código
  (método da skill `code-migration`, sem a ferramenta `jscpd`, que não lê BrightScript).
- UI e plataforma (Vue, hls.js, IndexedDB, WebCrypto) são reescritas com os nós nativos.

## Estratégia de cobrança (híbrida por plataforma)

| Plataforma | Como paga | Como ativa |
|---|---|---|
| Roku | Roku Pay (assinatura com teste grátis pela Roku) | compra na TV; vale para todos os aparelhos da conta Roku |
| Tizen, webOS, Android, PC | site, Pix, revendedores (como hoje) | código/QR do aparelho (como hoje) |

Na Roku **não pode** haver código de ativação, QR para o site, preço do site nem revendedor (§10.3 e RP 4,
`research/risk-assessment.md` R1). Login de cliente que pagou fora da Roku só seria permitido **no aparelho** (e-mail via
RFI + senha) e só se existir conta Pulse — o Pulse hoje identifica por aparelho, não por conta. Fica para depois da v1
(Questão aberta Q4).

## Estrutura do código

```
roku/                      # app Roku (BrighterScript)
  manifest
  source/                  # main.brs, utilitários puros (Xtream, M3U, URLs, busca, regras)
  components/              # MainScene, telas, Tasks (rede, catálogo, licença, Roku Pay)
  images/ fonts/
  tests/                   # Rooibos (unitários no aparelho)
  e2e/                     # roku-test-automation (Node) contra o mock
bsconfig.json  package.json (scripts roku:*)
```

Ferramentas: BrighterScript 0.73.x, bslint, Rooibos 5.x, roku-deploy 3.x, roku-test-automation 2.x
(`research/stack-research.md`, "Ferramentas"). Scripts novos no `package.json` raiz: `roku:build`, `roku:lint`,
`roku:test`, `roku:deploy`, `roku:e2e`.

## Fases

### Fase 0 — Decisões, spikes e base (antes de qualquer tela)

**Objetivo**: matar os riscos que podem invalidar o projeto.
1. Conta de desenvolvedor Roku; confirmar no Developer Dashboard que **Roku Pay está disponível no Brasil** (e quais
   países) — Q1.
2. Contato com o suporte de parceiros Roku: app player sem conteúdo próprio (R2), isenção de deep link e miniaturas de
   trick play (R3) — Q2.
3. Spike em aparelho real (de preferência um de 512 MB): `roRSA.Verify` com SHA-256, `roEVPCipher` aes-128-gcm, TS cru
   por HTTP, `ParseJson` de uma lista de 50k itens gerada pelo `npm run mock` (R4, R5, R6).
4. Projeto `roku/` com BrighterScript, bslint, Rooibos, roku-deploy e CI no GitHub Actions (lint + build + pacote ≤ 4 MB).
5. Skill de projeto `roku-brightscript` com as regras desta pesquisa (threads, foco, certificação, convenções).
**Saída**: `domains/00-fundacao.md` passos 1-3 concluídos; respostas de Q1/Q2 registradas aqui.
**Critério**: canal "olá Pulse" sideloaded, testes Rooibos rodando no CI, decisões Q1-Q3 respondidas.

### Fase 1 — Lógica pura e plataforma

Domínios: **D1** Xtream/M3U (`domains/01-xtream-m3u.md`), **D2** identidade e armazenamento
(`domains/02-identidade-armazenamento.md`).
**Por que primeiro**: são folhas do grafo (sem dependência de UI) e têm muitos testes para portar.
**Critério**: login Xtream e M3U do `npm run mock` funcionando num Task, com os casos de `tests/xtreamApi.test.js`,
`tests/m3uGroups.test.js` e `tests/streamUrl.test.js` reescritos em Rooibos e verdes.

### Fase 2 — Sessão e catálogo

Domínios: **D3** sessão/login/FTUE (`domains/03-sessao-login-ftue.md`), **D4** catálogo e busca
(`domains/04-catalogo-busca.md`).
**Critério**: do FTUE ao catálogo carregado com a lista grande do mock em menos de 15 s até a home (cert. 3.2).

### Fase 3 — Telas e player (primeiro beta)

Domínios: **D5** telas (`domains/05-telas.md`), **D6** player (`domains/06-player.md`).
**Critério**: assistir live/filme/série com resume e próximo episódio; **beta Roku** com até 20 testadores
(`research/stack-research.md`, "Loja e certificação").

### Fase 4 — Perfis, parental, licença e Roku Pay

Domínios: **D7** perfis e parental (`domains/07-perfis-parental.md`), **D8** licença Roku Pay
(`domains/08-licenca-roku-pay.md`), **DS** servidor (`domains/10-servidor.md`).
**Critério**: compra de teste no Roku Pay libera o app; cancelamento bloqueia após a validade; testes do servidor verdes.

### Fase 5 — Pareamento e inbox do site

Domínio: **D9** (`domains/09-pareamento-inbox.md`). Depende da resposta da Roku (Q3) sobre o celular enviar a lista.
**Critério**: celular envia a lista para a Roku pelo servidor (TLS), sem código de ativação de licença.

### Fase 6 — Certificação e lançamento

Deep link, bookmarks, trick play, tempos de performance, ativos da loja, Static Analysis sem erros, submissão.
**Critério**: app publicado; checklist de `research/stack-research.md` ("Loja e certificação") todo verde.

## Ordem e dependências

```
D0 ─┬─ D1 ─┐
    └─ D2 ─┼─ D3 ─┬─ D4 ─┬─ D5 ─┬─ D7
           │      │      └─ D6 ─┤
           └──────┴── DS ── D8 ─┴─ D9 ── Fase 6
```

## Rede de segurança (testes)

| Camada | Como | Onde |
|---|---|---|
| Especificação | casos dos testes Vitest de cada módulo, portados um a um | `roku/tests/` (Rooibos) |
| Contrato com servidor | mesmos endpoints e formatos do cliente web, contra `npm run mock`, `npm run license`, `npm run pair` | `roku/e2e/` |
| Servidor | testes Vitest novos para `roku` e Roku Pay | `tests/` |
| E2E na TV | roteiros de controle remoto (RTA) | `roku/e2e/` |
| Certificação | Static Analysis da Roku no CI | CI |

**Rollback**: o app Roku é independente; até a Fase 6 nada vai para o público. Mudanças no servidor ficam atrás da
plataforma `roku` e não alteram o comportamento das outras plataformas (testes atuais continuam verdes).

## Questões abertas

| # | Questão | Dono | Bloqueia |
|---|---|---|---|
| Q1 | Roku Pay funciona no Brasil? Em quais países vamos publicar? | Eduardo (Dashboard Roku) | D8, Fase 6 |
| Q2 | Roku aceita player sem conteúdo próprio e isenta deep link/trick play? | Eduardo (suporte de parceiros) | Fase 6 |
| Q3 | Enviar a lista pelo celular conta como "mecanismo externo" proibido? (objetivo: **manter**, ver D9) | Eduardo (suporte de parceiros) | D9 |
| Q4 | Criar contas Pulse (e-mail) para quem pagou fora poder entrar na Roku? | Eduardo | pós-v1 (adiado em 2026-11-18) |

Feature nova na v1 Roku: escolha de áudio e legenda no player (`domains/06-player.md`, passo 5).
| Q5 | Teste grátis: pela Roku (exige forma de pagamento na conta) ou sem cartão? | Eduardo | D8 |
