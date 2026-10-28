# Serviço de licença (RFC-018)

Teste de 7 dias por aparelho, aparelhos ativos por servidor parceiro (para a cobrança mensal) e ativação anual.
Regras e guardrails: [`docs/rfc/RFC-018-ativos-e-ativacao.md`](../../docs/rfc/RFC-018-ativos-e-ativacao.md).

## Rodar localmente

```bash
LICENSE_ADMIN_TOKEN=uma-senha-longa npm run license
```

Painel: `http://127.0.0.1:8789/admin/` (pede o token). Página de planos aberta pelo QR: `/a/<código do aparelho>`.
No app, `VITE_LICENSE_BASE_URL=http://127.0.0.1:8789` no `.env.local`.

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `LICENSE_ADMIN_TOKEN` | vazio | Senha do painel. Vazio = painel fechado (503). |
| `LICENSE_CONTACT_URL` | vazio | Link para pagar a ativação (ex.: WhatsApp), na página de planos. |
| `LICENSE_PORT` / `LICENSE_HOST` | `8789` / `127.0.0.1` | Onde o servidor escuta. |
| `LICENSE_DB_PATH` | `server/license/.data/license.db` | Arquivo SQLite (fora do Git). |
| `MP_ACCESS_TOKEN` | vazio | Access Token do Mercado Pago (RFC-020). Vazio = pagamento desligado (503). No Worker: `wrangler secret put`. |
| `MP_WEBHOOK_SECRET` | vazio | Assinatura secreta do webhook (`/webhooks/mercadopago`). Vazio = webhook desligado (503). No Worker: `wrangler secret put`. |
| `MP_PUBLIC_KEY` | vazio | Chave pública do Mercado Pago (cartão na tela `/pagar`, lida em `/v1/mp-config`). Vazio = só Pix. No Worker: `vars`. |

## Arquivos

- `license-rules.mjs` — regras puras (teste, ciclos, ativo, domínio). O app usa `normalizeHost` daqui.
- `license-db.mjs` — tabelas e consultas (SQL de SQLite, compatível com Cloudflare D1).
- `license-core.mjs` — rotas `/v1/hello`, `/v1/access`, `/v1/entry` e página `/a/:code` (Web Standards).
- `license-admin.mjs` — API do painel (`/admin/api/*`), com token: parceiros, relatório (com valor do mês), aparelhos
  (liberar, revogar, bloquear, dias de teste, observação, apagar) e revendedores (RFC-019).
- `license-api.mjs` — API pública dos revendedores (`/api/v1/*`), documentada em [`API.md`](API.md).
- `license-resellers.mjs` — regras de revenda: chaves, créditos, ativação e repasse (débito atômico e idempotente).
- `license-inbox.mjs` — caixa de entrada cifrada da TV (RFC-021): o site manda a lista cifrada, a TV busca e confirma.
- `public/site/` — site público (RFC-021): `/` Enviar lista, `/assinar`, `/creditos` e `/pagar` (RFC-020: Pix e cartão
  pelo Mercado Pago, com CSP própria `PAY_CSP`; os botões de compra do site e do painel da revenda levam para lá).
  `pair-lib.js` é cópia idêntica de `server/pair/public/pair-lib.js` (há teste que exige isso).
- `public/revenda/` — painel do revendedor (RFC-022) em `/revenda/`: entra com a chave da revenda e usa só a API
  `/api/v1/*` (ativar TV, clientes, revendas, extrato, comprar créditos pelo WhatsApp, trocar chave).
- `license-checkout.mjs` — pagamento pelo Mercado Pago (RFC-020): `POST /v1/checkout` (Pix; cartão com 3DS nos
  créditos; assinatura anual no cartão para o aparelho), `GET /v1/checkout/:id`, `POST /webhooks/mercadopago`
  (assinatura validada, consulta na API, entrega única) e a aba Pagamentos do painel do dono: pedidos
  (`/admin/api/orders`, reprocessar) e assinaturas (`/admin/api/subscriptions`, cancelar renovação).
- `mp-client.mjs` — chamadas à API do Mercado Pago com `fetch` (sem SDK), injetável nos testes.
- `pricing.mjs` — tabelas de preço do dono (créditos, assinatura de R$ 25, mensalidade do parceiro), em centavos.
- `sqlite-d1.mjs` — `node:sqlite` com a interface do D1.
- `license-server.mjs` — servidor Node local; `public/admin/` — páginas do painel.

Hospedagem na Cloudflare (Worker + D1 + Cloudflare Access no painel) fica para depois: o núcleo já recebe o banco
pela interface do D1.
