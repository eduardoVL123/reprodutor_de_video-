# DS — Servidor (licença e pareamento) para a Roku

**Status (2026-11-25)**: passos 1 a 3 feitos em `server/license/license-roku.mjs` (testes em `tests/licenseRoku.test.js`)
e pareamento `plain` publicado. Segredos novos do Worker, ainda não gravados: `ROKU_API_KEY` (chave de parceiro do
Developer Dashboard) e `LICENSE_RSA_KEY` (`node scripts/make-license-keys.mjs --rsa`; a pública vai em
`PULSE_LICENSE_RSA_PUBLIC_KEY` no build da Roku). UNVERIFIED: formato exato da resposta do validate-transaction
(conferir com a conta de teste). Teto de 10 aparelhos por compra (`ROKU_MAX_DEVICES`).

## Estado atual
- `server/license/license-core.mjs`: `PLATFORMS` L22 (sem `roku`; outro valor vira `web` L115); `/v1/access` L149-155;
  regex de `deviceKey` L39; assinatura com `LICENSE_SIGNING_KEY` (`server/license/license-sign.mjs:29-53`, ECDSA P-256).
- Texto assinado: `server/license/license-rules.mjs:91-95`.
- Pareamento: `server/pair/pair-core.mjs:297-366`.
- Testes: `tests/licenseCore.test.js`, `tests/licenseRules.test.js` (25), `tests/licenseServer.test.js`,
  `tests/pairCore.test.js`, `tests/pairServer.test.js`.

## Estado alvo
1. `'roku'` em `PLATFORMS`.
2. Assinatura **RSA** adicional da resposta de `/v1/access` quando `platform == 'roku'` (campo `sigRsa`), com chave
   `PULSE_LICENSE_RSA_KEY` (segredo fora do Git).
3. Roku Pay: `/v1/access` aceita `transactionId`; servidor chama
   `validate-transaction/{partnerAPIKey}/{transactionId}` (`isEntitled`, validade) com `PULSE_ROKU_API_KEY`; grava
   tipo de acesso `roku_pay` com fim do período; revalida em cada `/v1/access` (com cache curto).
4. Pareamento: variante `roku` sem ECDH (ver D9), se Q3 permitir.
5. Na Roku nunca responder com URL de planos/código de ativação.

## Passos

### 1. Plataforma `roku`
**Teste**: novo caso em `tests/licenseCore.test.js` — `roku` gravado como `roku`. Todos os testes atuais verdes.

### 2. Assinatura RSA
**Teste**: vetores de teste (estado + assinatura) gerados para o Rooibos de D8; assinatura verifica com a pública.

### 3. Validação Roku Pay
**Teste**: cliente HTTP da Roku mockado — `isEntitled` true libera, false bloqueia, erro de rede mantém último estado
válido dentro da carência.
**Rollback**: tudo condicionado a `platform == 'roku'`; outras plataformas inalteradas.

### 4. Deploy
Segredos novos na VPS/Workers (`PULSE_LICENSE_RSA_KEY`, `PULSE_ROKU_API_KEY`); skill `deploy-vps`.

## Riscos
| Risco | Impacto | Mitigação | Evidência |
|---|---|---|---|
| Quebrar licença das outras plataformas | Alto | mudanças atrás de `platform == 'roku'`; suíte atual | `tests/license*.test.js` |
| Vazamento da chave de parceiro Roku | Alto | só no servidor, nunca no app | `CLAUDE.md` do projeto (segredos `PULSE_*`) |

## Dependências
Depende de Q1 (Roku Pay no Brasil). Bloqueia D8 e D9.
