# RFC-020 — Pagamento por Pix (Mercado Pago)

Status: **proposta (provedor escolhido pelo dono: Mercado Pago; aguarda aprovação deste texto e as credenciais)** ·
Data: 2026-10-27 · Depende de: RFC-018 (serviço de licença) e **RFC-019** (créditos, revendedores, `pricing.mjs`) ·
Ordem: 019 → **020** → 021 → 022

> **Como usar:** cole este arquivo inteiro como primeira mensagem num chat novo aberto na pasta `reprodutor_de_video`.

---

## Prompt para a IA

Você vai ligar o **Pix do Mercado Pago** ao serviço de licença (`server/license`) para duas compras: a **assinatura de
1 aparelho por R$ 25 (1 ano)** e a **compra de créditos por revendedor** (mínimo 10, tabela da RFC-019 R1). Pagou →
o serviço entrega sozinho (ativa o aparelho ou põe os créditos no saldo, criando o revendedor se for a primeira
compra). Não há cartão, boleto, assinatura recorrente nem reembolso automático nesta RFC.

Antes de qualquer código:
1. Leia `CLAUDE.md`, o `CLAUDE.md` global, **este arquivo**, a RFC-018 e a **RFC-019** (precisa estar implementada).
2. Confira na documentação **atual** do Mercado Pago os pontos marcados com 🔎 (APIs de pagamento mudam).
3. TDD; `npm run lint`, `npx vitest run --maxWorkers=2`, `npm run build` verdes. Nunca chame o Mercado Pago de verdade
   nos testes (`fetch` simulado). Sem commit/push/deploy sem pedido do dono.
4. **Credenciais nunca no código nem em `.env` versionado**: `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` são segredos do
   Worker (`wrangler secret put`). Primeiro com as **credenciais de teste** do Mercado Pago; produção só com pedido.

---

## Por quê
O dono quer vender sem intermediário humano: o cliente final assina a TV dele pelo site e o revendedor compra créditos
e recebe o painel. "Não precisamos processar pagamento ainda" valia para a primeira versão; agora o pedido é Pix.

## Regras (dono)
- **R1. Assinatura do aparelho:** R$ 25, ativa **1 ano** o aparelho do código informado (soma ao fim da ativação atual,
  `extendActivation`). Aparelho bloqueado pelo dono (RFC-019) não pode ser comprado (o site avisa antes de cobrar).
- **R2. Créditos:** quantidade ≥ 10, preço pela tabela da RFC-019 R1 (`creditTotal`). Primeira compra de alguém **cria o
  revendedor** e entrega a **chave do painel** (RFC-022); compra pelo painel credita o revendedor logado.
- **R3. Preço e entrega decididos só no servidor.** O que vier do navegador é só "o quê" (código ou quantidade).

## Objetivos
1. Criar cobrança Pix (QR + copia-e-cola) e acompanhar o status.
2. Confirmar pelo **webhook** do Mercado Pago, validando a assinatura e **consultando o pagamento na API** (nunca
   confiar no corpo do webhook).
3. Entregar **uma única vez** (idempotente), mesmo com webhook repetido, fora de ordem ou consulta simultânea.
4. Painel do dono: lista de pedidos (pendente, pago, expirado, com erro), reprocessar entrega, ver o pagamento.

## Não objetivos
Cartão, boleto, recorrência, reembolso/estorno automático (o dono estorna no Mercado Pago e revoga no painel),
nota fiscal, cupom, split de pagamento entre revendedores.

## Anti-objetivos
- Entregar sem pagamento confirmado na API do Mercado Pago, ou entregar duas vezes.
- Valor pago diferente do valor do pedido ser aceito.
- Token do Mercado Pago, chave do revendedor ou dados do pagador em log.
- Mostrar a chave do novo revendedor para quem não fez a compra.

## Desenho técnico

### 1. Pedidos (`orders`, migração aditiva)
`orders(id TEXT PK (aleatório, 16 bytes base64url), kind 'device_annual'|'credits', device_code TEXT NULL,
reseller_id INTEGER NULL, buyer_name TEXT NULL, buyer_contact TEXT NULL, quantity INTEGER, amount_cents INTEGER,
status 'pending'|'paid'|'delivered'|'expired'|'failed', mp_payment_id TEXT UNIQUE NULL, view_secret_hash TEXT,
delivery TEXT NULL (JSON: activationEndsAt / créditos / id do revendedor criado), created_at, paid_at, expires_at)`.
- `view_secret`: segredo aleatório devolvido só para quem criou o pedido; é ele que permite ver o resultado (inclusive
  a chave do revendedor novo, mostrada **uma vez**, e depois apagada do `delivery`).

### 2. Rotas novas (núcleo `server/license/license-checkout.mjs`)
| Rota | Faz |
|---|---|
| `POST /v1/checkout/device {code}` | valida o código (existe, não bloqueado) → cria pedido R$ 25 → cria pagamento Pix → `{orderId, viewSecret, qrCode, qrCodeBase64, expiresAt}` |
| `POST /v1/checkout/credits {quantity, name, contact}` | valida (≥ 10, nome e contato) → pedido com `creditTotal` → Pix |
| `POST /api/v1/credits/checkout {quantity}` | mesma coisa para o revendedor logado (chave da RFC-019) |
| `GET /v1/checkout/:orderId?s=<viewSecret>` | status; quando entregue, o resultado (chave nova uma vez) |
| `POST /webhooks/mercadopago` | valida `x-signature`, consulta o pagamento, entrega |
| `/admin/api/orders*` | lista, detalhe, reprocessar entrega |

### 3. Mercado Pago (🔎 confirmar na documentação atual)
- Criar: `POST https://api.mercadopago.com/v1/payments` com `Authorization: Bearer MP_ACCESS_TOKEN`,
  `X-Idempotency-Key: <orderId>`, corpo `{ transaction_amount, description: "Pulse Player — ...", payment_method_id:
  "pix", payer: { email }, external_reference: <orderId>, notification_url: <base>/webhooks/mercadopago,
  date_of_expiration: agora + 30 min }`. Resposta: `id`, `status`, `point_of_interaction.transaction_data.qr_code` e
  `qr_code_base64`.
  - `payer.email` é exigido: pedir e-mail no formulário (ou usar um e-mail técnico do dono, 🔎 se o MP aceita).
- Webhook: corpo `{ type: "payment", data: { id } }`; headers `x-signature` (`ts=...,v1=...`) e `x-request-id`. Validar
  HMAC-SHA256 com `MP_WEBHOOK_SECRET` sobre o manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (🔎 formato
  exato) em tempo constante; rejeitar `ts` com mais de 10 min.
- Depois de validar: `GET /v1/payments/{id}` → aceitar só `status === 'approved'`, `external_reference` = pedido
  existente, `transaction_amount * 100 === amount_cents` e `currency_id === 'BRL'`.
- Entrega idempotente: `UPDATE orders SET status = 'paid', mp_payment_id = ?, paid_at = ? WHERE id = ? AND status =
  'pending'` → só quem mudou a linha entrega (no mesmo `batch`: ativação ou créditos + movimento `purchase` com
  `amount_cents`) e marca `delivered`. Webhook repetido → 200 sem fazer nada.
- O site também consulta o status (`GET /v1/checkout/:id`) a cada 3 s; se o pedido estiver pendente e passou do tempo
  normal, essa rota pode consultar o MP uma vez por minuto (cobre webhook perdido).
- Expiração: pedido pendente após `expires_at` vira `expired` (cron diário já existente + na consulta).

### 4. Segredos e variáveis
`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` (segredos), `LICENSE_PUBLIC_BASE_URL` (para a `notification_url`).
Sem `MP_ACCESS_TOKEN` as rotas de checkout respondem 503 "Pagamento indisponível" (recurso desligado, como o G9).

## Guardrails
- G1–G14 (RFC-018/019) valem.
- **G15** Nada é entregue sem: assinatura válida **e** consulta à API **e** valor/moeda/referência conferidos.
- **G16** Entrega exatamente uma vez (teste: 3 webhooks iguais + 1 consulta simultânea → 1 ativação / 1 crédito).
- **G17** Logs sem token, chave, e-mail ou CPF; só `orderId` e `status`.
- **G18** Chave do revendedor novo aparece uma vez, só para quem tem o `viewSecret` do pedido.

## Plano
1. Tabela `orders` + `license-checkout.mjs` com o Mercado Pago simulado (criar pedido, status).
2. Webhook: assinatura, consulta, conferência, entrega idempotente (testes G15/G16).
3. Revendedor novo na primeira compra de créditos + chave uma vez (G18).
4. Painel: pedidos e reprocessar.
5. Teste manual com credenciais **de teste** do Mercado Pago (o dono cria a conta e cola os segredos com
   `wrangler secret put` — a IA não digita senha nem token em nenhum site).

## Riscos
- Webhook com URL errada ou bloqueado → a consulta periódica do site cobre.
- Fraude de chargeback em Pix é rara, mas existe devolução (MED): o dono revoga no painel.
- Mudanças na API do Mercado Pago (🔎 antes de publicar).
- Regras das lojas: o pagamento acontece **no site**, fora do app (RFC-018 D4 continua: versão das lojas sem preço).
