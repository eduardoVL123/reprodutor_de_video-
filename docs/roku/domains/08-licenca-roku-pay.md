# D8 — Licença na Roku com Roku Pay

**Status (2026-11-25)**: passos 1, 2 e 4 feitos no código; passo 3 (compra real) espera os produtos no Developer
Dashboard. `roku/source/license/licensing.bs` (regras, texto assinado, roRSA), `LicenseTask`, `ActivationScreen`
(planos do ChannelStore, "Assinar", "Verificar assinatura", outra lista, demonstração) e o Início abrindo a tela.
Liga com `PULSE_LICENSE_BASE_URL` no build; a assinatura RSA é exigida com `PULSE_LICENSE_RSA_PUBLIC_KEY`.
Conferido no simulador: a consulta registra o aparelho como `roku`. NÃO conferido: a tela de bloqueio desenhada, o
ChannelStore (compra, planos, compras) e o roRSA, que só existem de verdade no aparelho.

## Estado atual
- `src/stores/licenseStore.js` (206): `blockReason` L165-182, carência offline 7 dias e tolerância de relógio 24 h
  L29-32, `checkedAt` limitado L86, nonce L24-28, `entry` para `partner` após 10 s L187-198, lista demo nunca bloqueia
  L41-44.
- `src/services/licenseApi.js` (77): `POST /v1/access` L69, `/v1/entry` L71; links para planos `/a/<code>` L26 (**não
  pode existir na Roku**).
- `src/services/licenseSignature.js` (48): ECDSA P-256 sobre `licenseSignedText`
  (`server/license/license-rules.mjs:91-95`) — **sem equivalente nativo na Roku** (R4).
- `src/composables/useLicenseWatch.js`: reverificação a cada 6 h L5; `src/views/ActivationRequired.vue` (154).
- Testes-spec: `tests/licenseClient.test.js` (38), `tests/licenseWatch.test.js` (8), `tests/activationRequired.test.js` (14),
  `tests/licenseRules.test.js` (25).

## Estado alvo
- **Cobrança só Roku Pay** (decisão de 2026-11-18, `00-roadmap.md`). Produtos de assinatura (mensal/anual, com teste
  grátis) criados no Developer Dashboard, num **grupo de produto**.
- `RokuPayTask` (nó `ChannelStore`): `getCatalog`, `doOrder`, `getAllPurchases` no boot.
- `LicenseTask`: `POST /v1/access` com `platform: 'roku'` + `transactionId` quando houver compra; servidor valida com a
  Roku (DS) e devolve estado assinado em **RSA**, verificado com `roRSA`.
- Mesmas regras de `blockReason`, carência e relógio. Tela de bloqueio mostra **só** "Assinar" (Roku Pay) — sem QR, sem
  código, sem site, sem preço externo.
- Direito vale para todos os aparelhos da conta Roku (RP 4).
- Enhanced Subscription Recovery (assinatura "on hold") tratada como bloqueio com mensagem própria.

## Passos

### 1. Regras de licença portadas
**Teste**: casos de `tests/licenseClient.test.js` relativos a `blockReason`, carência, relógio e nonce, portados.

### 2. Verificação RSA
**O que muda**: `licenseSignedText` reimplementado byte a byte; `roRSA.Verify` com a chave pública empacotada.
**Teste**: vetores gerados pelo servidor (DS passo 2) — assinatura válida aceita, alterada rejeitada.
**Depende**: spike `roRSA` sha256 da Fase 0.

### 3. Compra e restauração
**Teste**: compra de teste no Roku Pay (contas de teste do Dashboard); relançar mantém acesso; outro aparelho da mesma
conta libera sozinho; cancelamento bloqueia ao fim do período.

### 4. Tela de bloqueio e conta
**Teste**: e2e — sem assinatura vê planos da Roku; com assinatura entra direto; nenhuma tela cita site/QR/código
(teste de guarda como `tests/noExternalPlaceholders.test.js`).
**Rollback**: produto Roku Pay pode ser desativado no Dashboard; servidor mantém regras das outras plataformas.

## Riscos
| Risco | Impacto | Mitigação | Evidência |
|---|---|---|---|
| Roku Pay indisponível no Brasil (Q1) | Crítico | confirmar na Fase 0 antes de construir | `research/risk-assessment.md` R1 |
| `roRSA` sem sha256 | Alto | spike da Fase 0; alternativa: atestação + TLS | `research/stack-research.md` |
| Teste grátis exige forma de pagamento (Q5) | Médio | decidir modelo do teste | `00-roadmap.md` |

## Dependências
Depende de D2, D3, DS. Bloqueia D9 e Fase 6.
