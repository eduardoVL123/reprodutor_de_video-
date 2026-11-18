# D9 — Pareamento pelo celular e inbox do site

## Estado atual
- `src/composables/usePairing.js` (184): sessão nova L135, poll 2 s L16/118, até 5 falhas L17, abrir box L89.
- `src/services/pairingApi.js` (101): `POST /v1/sessions` L76-89, `GET /v1/sessions/<code>/payload` com
  `X-Pair-Secret` L92-101; servidor `server/pair/pair-core.mjs:297-366`.
- `src/services/pairingCrypto.js` (72): box = ECDH P-256 + AES-256-GCM, AAD = código L6-7/54-69; celular cifra em
  `server/pair/public/pair-lib.js:53-64`.
- Inbox do site: `src/composables/useSiteInbox.js` (poll 60 s L17, AAD = `license.code` L45), `src/services/inboxKeys.js`;
  servidor `server/license/license-inbox.mjs:64-74`.
- Testes-spec: `tests/usePairing.test.js` (27), `tests/pairPanel.test.js` (27), `tests/siteInbox.test.js` (13),
  `tests/pairingApi.test.js` (10), `tests/pairingCrypto.test.js` (6).

## Estado alvo
- **Só envio de lista** (DNS/usuário/senha), nunca ativação de licença — a licença na Roku é só Roku Pay (D8).
- Sem ECDH na Roku (R4): variante `roku` do pareamento em que o servidor entrega o payload em texto dentro do TLS,
  protegido pelo `X-Pair-Secret` que só a TV conhece, ou cifrado com AES-128-GCM se o spike provar suporte a AAD.
  A cifra fim a fim continua nas outras plataformas.
- QR exibido na TV aponta para a página de envio de lista (não de pagamento).
- Inbox do site: hoje usa `license.code` como AAD e o código do aparelho — **revisar**: na Roku não há código de
  ativação; usar só o código de pareamento.

## Passos

### 1. Confirmar com a Roku (Q3)
**Objetivo do usuário (2026-11-18): manter o envio pelo celular e a inbox do site na Roku.** Argumento para a Roku: é
só uma forma de digitar os dados da lista (que o usuário também pode digitar na TV); não autentica conta, não ativa
licença e não leva a pagamento. Para reforçar: a tela de pareamento não mostra preço, plano nem site de vendas, e a
página aberta pelo QR só tem o formulário da lista. Se a Roku recusar, D9 fica fora da Roku e a entrada é só pelo
teclado/voz (D3).

### 2. Variante de pareamento sem ECDH
**O que muda**: servidor (DS) aceita sessão `roku`; app faz poll e recebe o payload.
**Teste**: casos de `tests/usePairing.test.js` portados (expiração, BUSY, 5 falhas); e2e com `npm run pair`.

### 3. Inbox
**Teste**: equivalentes de `tests/siteInbox.test.js` sem `license.code`.
**Rollback**: desligar a variante `roku` no servidor; o app volta a só aceitar digitação.

## Riscos
| Risco | Impacto | Mitigação | Evidência |
|---|---|---|---|
| Roku considerar o celular mecanismo externo (Q3) | Alto | perguntar antes; manter digitação/voz | `research/stack-research.md`, "Cobrança" |
| Perda da cifra fim a fim na Roku | Médio | TLS + segredo da sessão; TTL 10 min | `server/pair/pair-core.mjs:7-9` |

## Dependências
Depende de D3, D8, DS. Última fase antes da certificação.
