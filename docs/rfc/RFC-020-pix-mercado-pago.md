# RFC-020 — Pagamento pelo Mercado Pago (Pix + cartão, Checkout Transparente)

Status: **proposta revisada em 2026-10-28 — aguarda aprovação do dono** · Depende de: RFC-018, **RFC-019**
(`pricing.mjs`, créditos, revendedores), RFC-021 (site) e RFC-022 (painel da revenda)

> **Como usar:** cole este arquivo inteiro como primeira mensagem num chat novo aberto na pasta `reprodutor_de_video`.

---

## Prompt para a IA

Você vai ligar o **Mercado Pago (Checkout Transparente, API Orders)** ao serviço de licença (`server/license`) para:
a **assinatura do aparelho (R$ 25/ano)** e a **compra de créditos** (mínimo 10, tabela da RFC-019 R1), pelo site e pelo
painel da revenda. Meios: **Pix** e **cartão de crédito** (com 3DS). No cartão, a assinatura do aparelho **renova
sozinha todo ano** (produto Assinaturas do Mercado Pago). Pagou → o serviço entrega sozinho.

Antes de qualquer código:
1. Leia `CLAUDE.md`, o `CLAUDE.md` global, **este arquivo**, a RFC-018, a RFC-019, a RFC-021 e a RFC-022.
2. Confira na documentação **atual** do Mercado Pago os pontos marcados com 🔎 (use o plugin do Mercado Pago:
   `search_documentation`, site MLB, língua pt).
3. TDD; `npm run lint`, `npx vitest run --maxWorkers=2`, `npm run build` verdes. **Nunca** chame o Mercado Pago de
   verdade nos testes (`fetch` injetado e simulado). Sem commit/push/deploy sem pedido do dono.
4. **Credenciais nunca no código nem em `.env` versionado.** `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` são segredos do
   Worker (`wrangler secret put`); a IA não digita token em nenhum lugar. Primeiro credenciais **de teste**.
5. Sem SDK de servidor: o Worker chama a API com `fetch` (decisão do dono em 2026-10-28; o guia oficial faz o mesmo).

---

## Por quê
O dono quer vender sem intermediário humano: o cliente final assina a TV pelo site e o revendedor compra créditos sem
passar pelo WhatsApp. Hoje os três botões de compra abrem o WhatsApp (RFC-021/022).

## Aplicação no Mercado Pago (feita em 2026-10-28)
- **Pulse Player**, App ID `1621294583952670`, país MLB, produto Checkout Transparente, API **Orders**.
- A criação automática do usuário de teste falhou do lado do Mercado Pago (`MP_API_DOWN`): criar o comprador de teste
  antes do teste manual (plugin: `create_test_user`). Sem ele a API Orders responde 422.

## Regras (dono)
- **R1. Assinatura do aparelho (R$ 25, 1 ano)** para o código informado. Aparelho bloqueado (RFC-019) não pode ser
  comprado (o site avisa antes de cobrar).
  - **Pix:** compra avulsa; soma 1 ano ao fim da ativação atual (`extendActivation`). No ano seguinte paga de novo.
  - **Cartão:** **assinatura anual recorrente** (`/preapproval`, 12 meses). Cada cobrança aprovada soma 1 ano.
- **R2. Créditos:** quantidade ≥ 10, preço por `creditTotal`. Pix ou cartão, sempre compra avulsa (sem recorrência).
  Primeira compra pelo site **cria o revendedor** e entrega a **chave do painel** uma vez (RFC-022); compra pelo
  painel credita o revendedor logado.
- **R3. Preço e entrega decididos só no servidor.** Do navegador vem só "o quê" (código ou quantidade), o meio, o
  e-mail/CPF do pagador e o token do cartão.
- **R4. Cartão:** 1 parcela (o servidor força `installments: 1`), 3DS ligado (`on_fraud_risk`).
- **R5. Sem divisão de pagamento (split)**: tudo cai na conta do dono; revendedor recebe créditos, não dinheiro.

## Objetivos
1. Tela de pagamento própria `/pagar` (abas Pix | Cartão), aberta pelos três botões de compra.
2. Pix: QR + copia-e-cola, status acompanhado pela tela.
3. Cartão: formulário seguro do Mercado Pago (campos em iframe), 3DS com desafio quando o banco pedir.
4. Assinatura anual no cartão para o aparelho, com renovação automática e cancelamento pelo painel do dono.
5. Confirmação pelo **webhook** (assinatura validada **e** consulta na API), entrega **uma única vez**.
6. Painel do dono: pedidos e assinaturas (pendente, pago, expirado, com erro, cancelada), reprocessar entrega,
   cancelar assinatura.

## Não objetivos
Boleto, parcelamento, split, reembolso/estorno automático (o dono estorna no Mercado Pago e revoga no painel), nota
fiscal, cupom, recorrência de créditos, renovação automática no Pix.

## Anti-objetivos
- Entregar sem pagamento confirmado na API do Mercado Pago, ou entregar duas vezes.
- Valor pago diferente do valor do pedido ser aceito.
- Token do Mercado Pago, token de cartão, chave do revendedor, e-mail ou CPF em log (G17).
- Mostrar a chave do novo revendedor para quem não fez a compra.
- Afrouxar a CSP das outras páginas (a CSP nova vale só para `/pagar`).

## Desenho técnico

### 1. Tabelas (migração aditiva, `license-db.mjs`)
- `orders(id TEXT PK (16 bytes aleatórios base64url), kind 'device_annual'|'credits', method 'pix'|'card',
  device_code NULL, reseller_id NULL, buyer_name NULL, buyer_contact NULL, quantity, amount_cents,
  status 'pending'|'paid'|'delivered'|'expired'|'failed', mp_order_id TEXT UNIQUE NULL, view_secret_hash,
  delivery TEXT NULL (JSON), created_at, paid_at, expires_at)`.
- `subscriptions(id TEXT PK, device_code, mp_preapproval_id TEXT UNIQUE, status 'pending'|'authorized'|'paused'|
  'cancelled', created_at, cancelled_at NULL)`.
- `mp_deliveries(mp_ref TEXT PK, subscription_id, delivered_at)` (etapa 4) — trava de "uma vez só" das parcelas da
  assinatura: a entrega roda no mesmo `batch` do `INSERT` aqui; `mp_ref` repetido falha e nada é entregue de novo
  (G16). Pedidos avulsos usam o `UPDATE` condicional do status (§4).
- `orders.checked_at` — última consulta ao Mercado Pago feita pela tela (webhook perdido, no máximo 1 por minuto).
- Não guardar e-mail nem CPF: vão direto para o Mercado Pago.

### 2. Módulos
- `server/license/mp-client.mjs` — `fetch` injetável, base `https://api.mercadopago.com`, `Authorization: Bearer`,
  `X-Idempotency-Key` em toda criação; funções `createOrder`, `getOrder`, `createPreapproval`, `getPreapproval`,
  `cancelPreapproval`, `getAuthorizedPayment`; valores como texto com 2 casas (`(cents / 100).toFixed(2)`).
- `server/license/license-checkout.mjs` — rotas abaixo, regras de entrega e webhook.

### 3. Rotas
| Rota | Faz |
|---|---|
| `GET /v1/site-config` | acrescenta `mpPublicKey` (chave pública, `Cache-Control: no-store`) |
| `GET /pagar` | página nova (`public/site/pagar.html` + `pagar.js`), CSP própria |
| `POST /v1/checkout` `{kind, method, code \| quantity+name+contact, email, card?}` | valida → cria pedido → Pix: order Pix; cartão+créditos: order com 3DS; cartão+aparelho: preapproval → `{orderId, viewSecret, ...}` |
| `POST /api/v1/credits/checkout` | o mesmo para o revendedor logado (chave da RFC-019) |
| `GET /v1/checkout/:orderId?s=<viewSecret>` | status; quando entregue, o resultado (chave nova uma vez) |
| `POST /webhooks/mercadopago` | valida `x-signature`, consulta a API, entrega |
| `/admin/api/orders*`, `/admin/api/subscriptions*` | lista, detalhe, reprocessar, cancelar assinatura |

Sem `MP_ACCESS_TOKEN` as rotas de checkout respondem 503 "Pagamento indisponível" e os botões voltam a ser WhatsApp
(como hoje).

### 4. Mercado Pago (conferido na documentação oficial em 2026-10-28; 🔎 = reconferir antes de publicar)
- **Pix (Orders):** `POST /v1/orders` `{ type: "online", processing_mode: "automatic", total_amount: "25.00",
  external_reference: <orderId>, payer: { email }, transactions: { payments: [{ amount: "25.00", payment_method:
  { id: "pix", type: "bank_transfer" }, expiration_time: "PT30M" }] } }`. Resposta: `status: "action_required"`,
  `status_detail: "waiting_transfer"`, `transactions.payments[0].payment_method.qr_code` e `qr_code_base64`.
  `payer.email` é **obrigatório** → o formulário pede e-mail. Vencimento do Pix: entre 30 min e 30 dias.
- **Cartão avulso (Orders) com 3DS:** mesmo endpoint; `payer: { email, identification: { type: "CPF", number } }`,
  `config.online.transaction_security: { validation: "on_fraud_risk", liability_shift: "required" }`,
  `payment_method: { id: paymentMethodId, type: "credit_card", token, installments: 1 }` (**sem** `issuer_id`).
  Se o banco pedir desafio, a resposta traz `transactions.payments[0].payment_method.transaction_security.url`: a tela
  abre essa URL num iframe e depois consulta o status. Rejeição do desafio: `cc_rejected_3ds_challenge`.
- **Assinatura anual (cartão, aparelho):** `POST /preapproval` `{ reason: "Pulse Player — ativação anual",
  external_reference: <orderId>, payer_email, card_token_id, auto_recurring: { frequency: 12, frequency_type:
  "months", transaction_amount: 25, currency_id: "BRL" }, back_url: <base>/assinar, status: "authorized" }`.
  O Mercado Pago faz uma cobrança mínima de verificação (estornada) e cobra a primeira parcela em até ~1 h; parcelas
  recusadas têm até 4 novas tentativas em 10 dias; 3 parcelas recusadas cancelam a assinatura. 🔎 Confirmar se
  `frequency: 12` + `months` é aceito (alternativa: `frequency_type: "years"` se existir).
- **Webhook:** tópicos `order` (conferido em 2026-10-28: query `?data.id=ORD...&type=order`, ação `order.processed`),
  `subscription_preapproval` e `subscription_authorized_payment`. Headers `x-signature` (`ts=...,v1=...`, `ts` em
  milissegundos) e `x-request-id`; HMAC-SHA256 com `MP_WEBHOOK_SECRET` sobre
  `id:<data.id da query, em minúsculas>;request-id:<x-request-id>;ts:<ts>;` (parte ausente sai do manifesto),
  comparação em tempo constante. **Sem janela de `ts`** (mudança na implementação): reenvios legítimos chegam horas
  depois, e repetir uma notificação válida não causa nada, porque a entrega sempre consulta a API e é única.
- **Depois de validar, consultar e conferir:**
  - Order: `GET /v1/orders/{id}` → `status: "processed"` e `status_detail: "accredited"`, `external_reference` =
    pedido existente cujo `mp_order_id` é essa order, `total_amount` = `amount_cents / 100` com 2 casas e moeda
    `BRL` (a order consultada traz `currency`; a notificação traz `currency_id`: aceitar os dois).
    `failed`/`canceled` → pedido `failed`.
  - Cartão: a resposta da criação já traz o resultado (`processed`, `failed` ou `action_required` +
    `pending_challenge` com a URL do desafio, válida por 40 min); vale como a consulta da G15. Recusa → 402.
  - Parcela da assinatura: `GET /authorized_payments/{id}` (endpoint conferido) → `payment.status: "approved"`,
    `preapproval_id` de uma assinatura nossa, `transaction_amount` 25 e `currency_id: "BRL"` → soma 1 ano ao aparelho.
    🔎 Os nomes desses campos não aparecem na busca da documentação: confirmar no teste manual (se diferirem, nada é
    entregue — falha segura).
  - Assinatura: `GET /preapproval/{id}` → `status` (`authorized`, `paused`, `cancelled`...); `cancelled` antes da
    1ª parcela marca o pedido de adesão como `failed`.
  - O 1º ano do aparelho no cartão é entregue **na 1ª parcela** (o Mercado Pago cobra em até ~1 h depois da adesão),
    não na adesão: a tela mostra "assinatura criada, a ativação chega em até 1 hora".
- **Entrega idempotente:** pedidos (orders): `UPDATE orders SET status = 'paid' WHERE id = ? AND status IN
  ('pending', 'expired')` — só quem muda a linha entrega (ativação ou créditos + movimento `purchase` com
  `amount_cents` + `delivered`, no mesmo `batch`). Parcelas da assinatura (etapa 4), que não têm pedido próprio:
  `INSERT INTO mp_deliveries (mp_ref, ...)` no mesmo `batch`. Webhook repetido, fora de ordem ou consulta simultânea
  → 200 sem nada. Pago mas sem entrega possível (aparelho apagado) fica `paid` para o dono reprocessar (etapa 6).
- **Webhook perdido:** a tela consulta `GET /v1/checkout/:id` a cada 3 s; pedido pendente pode consultar o Mercado
  Pago uma vez por minuto.
- **Expiração:** Pix pendente após `expires_at` vira `expired` (no cron diário que já existe e na consulta).

### 5. Tela `/pagar` (nova, separada das páginas atuais)
- Mostra **o total acima do formulário**, sempre (vindo do servidor, não do navegador).
- Aba Pix: QR (`data:image/png;base64,...`) + campo copia-e-cola + botão copiar + "aguardando pagamento".
- Aba Cartão: SDK JS `https://sdk.mercadopago.com/js/v2`, `mp.cardForm` com número, validade e CVC em iframe, nome,
  CPF e e-mail; seletores `issuer`, `installments` e `identificationType` existem, ocultos (`hidden`,
  `aria-hidden="true"`, `tabindex="-1"`, nunca `disabled`). Chave pública lida de `/v1/site-config` com
  `cache: 'no-store'`. Erro visível se o SDK não carregar (bloqueador de anúncios).
  (Implementado: a chave pública fica em `GET /v1/mp-config` — `no-store`, 503 com o motivo sem `MP_PUBLIC_KEY` —, e
  o `site-config` só diz se há pagamento (`payments`). Sem chave pública o cartão avisa e o Pix continua.)
- Rotas de entrada: `/pagar?tipo=aparelho&codigo=...`, `/pagar?tipo=creditos&qtd=...` (nome, contato e e-mail são
  pedidos na própria tela, nunca na URL) e `/pagar?tipo=revenda&qtd=...` (usa a chave do painel guardada na aba).
- Três estados: carregando, aprovado (pedido e, se for o caso, a chave do revendedor uma vez), erro acionável.
- Botões ligados (texto mantido, só muda o destino; marcados com `data-mp-checkout-cta="checkout-api"`):
  `public/site/assinar.html:30`, `public/site/creditos.html:34`, `public/revenda/index.html:106`.
- **CSP só desta página:** `script-src 'self' https://sdk.mercadopago.com`; `img-src 'self' data:` (+ imagens do SDK);
  `frame-src` e `connect-src` com os domínios do Mercado Pago 🔎 (lista oficial de domínios do SDK JS e do 3DS).
  `PAGE_CSP` das outras páginas não muda. Visto no navegador (2026-10-28): o SDK injeta como script embutido a
  identificação do aparelho (antifraude, de `/v1/devices/widgets`), que muda a cada carga; o dono decidiu liberar
  `'unsafe-inline'` em `script-src` **só** na `/pagar`.

### 6. Segredos e variáveis
| Nome | Tipo | Para quê |
|---|---|---|
| `MP_ACCESS_TOKEN` | segredo (`wrangler secret put`) | chamadas à API |
| `MP_WEBHOOK_SECRET` | segredo | validar o webhook |
| `MP_PUBLIC_KEY` | `vars` no `wrangler.jsonc` | SDK JS no navegador |

`LICENSE_PUBLIC_BASE_URL` não foi necessária: o `back_url` da assinatura usa o endereço da própria requisição, e a URL
do webhook (`<base>/webhooks/mercadopago`) é cadastrada no painel do Mercado Pago (`save_webhook`), com os tópicos
`order`, `subscription_preapproval` e `subscription_authorized_payment`.

## Guardrails
- G1–G14 (RFC-018/019) valem.
- **G15** Nada é entregue sem: assinatura válida **e** consulta à API **e** valor/moeda/referência conferidos.
- **G16** Entrega exatamente uma vez (teste: 3 webhooks iguais + 1 consulta simultânea → 1 ativação / 1 crédito;
  e 2 parcelas da mesma assinatura → 2 anos, nunca 3).
- **G17** Logs sem token, token de cartão, chave, e-mail ou CPF; só `orderId`, tipo e `status`.
- **G18** Chave do revendedor novo aparece uma vez, só para quem tem o `viewSecret` do pedido.
- **G19** Preço só do servidor: um teste manda `amount` no corpo e o valor cobrado continua o da tabela.
- **G20** Cartão: `installments` sempre 1 e `issuer_id` nunca dentro de `payment_method`.

## Plano (cada etapa: testes primeiro, lint + testes + build verdes no fim)
1. Tabelas + `mp-client.mjs` + `POST /v1/checkout` Pix + `GET /v1/checkout/:id` (Mercado Pago simulado).
2. Webhook: assinatura, consulta da order, conferência, entrega idempotente (G15/G16/G17).
3. Créditos: cartão com 3DS + revendedor novo na primeira compra + chave uma vez (G18) + rota do painel da revenda.
4. Aparelho no cartão: preapproval, parcelas `subscription_authorized_payment`, cancelamento no painel do dono.
5. Tela `/pagar` + CSP própria + `mpPublicKey` no `site-config` + três botões ligados.
6. Painel do dono: pedidos e assinaturas (aba Pagamentos). Reprocessar: `paid` → entrega agora (trava `delivering`
   contra cliques juntos); `pending`/`expired` → consulta o Mercado Pago. A lista nunca mostra a chave do revendedor.
7. Teste manual com credenciais **de teste**: o dono grava os segredos; criar comprador de teste; registrar o webhook
   (`save_webhook`); Pix, cartão `APRO`/`FUND`, desafio 3DS; conferir `notifications_history`; depois `/mp-review`.

## Perguntas em aberto (dono)
1. Quem pagou no cartão cancela a renovação sozinho (link no site) ou pede pelo WhatsApp e o dono cancela no painel?
   Proposta: pelo WhatsApp, cancelamento no painel (menos tela agora).
2. Vencimento do Pix: 30 min (proposto) ou mais?

## Riscos
- Webhook com URL errada ou bloqueado → a consulta da tela cobre.
- Cartão tem contestação (chargeback); o 3DS com `liability_shift: required` reduz; o dono revoga no painel.
- Pix tem devolução (MED): o dono revoga no painel.
- Mudanças na API do Mercado Pago (🔎 antes de publicar).
- Regras das lojas: o pagamento acontece **no site**, fora do app (RFC-018 D4 continua: versão das lojas sem preço).
