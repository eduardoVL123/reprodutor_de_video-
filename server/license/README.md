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
| `LICENSE_ADMIN_TOKEN` | vazio | Senha do painel. Vazio = painel fechado (503). Use 32+ caracteres aleatórios; 10 erros travam a rede por 15 min. No Worker, o painel só abre com o Cloudflare Access conferido (abaixo). |
| `LICENSE_SIGNING_KEY` | vazio | Chave privada (JWK) que assina `/v1/access`; o app confere com `VITE_LICENSE_PUBLIC_KEY`. Par novo: `node scripts/make-license-keys.mjs`. No Worker: `wrangler secret put`. |
| `LICENSE_CONTACT_URL` | vazio | Link para pagar a ativação (ex.: WhatsApp), na página de planos. |
| `LICENSE_PORT` / `LICENSE_HOST` | `8789` / `127.0.0.1` | Onde o servidor escuta. |
| `LICENSE_DB_PATH` | `server/license/.data/license.db` | Arquivo SQLite (fora do Git). |
| `MP_ACCESS_TOKEN` | vazio | Access Token do Mercado Pago (RFC-020). Vazio = pagamento desligado (503). No Worker: `wrangler secret put`. |
| `MP_WEBHOOK_SECRET` | vazio | Assinatura secreta do webhook (`/webhooks/mercadopago`). Vazio = webhook desligado (503). No Worker: `wrangler secret put`. |
| `LICENSE_REPORT_TOKEN` | vazio | Chave só de leitura dos relatórios do sócio (`/api/v1/reports/*`, [`API.md`](API.md)). 32+ caracteres aleatórios. Vazio = relatórios desligados (503). No Worker: `wrangler secret put`. |
| `PLAY_URL` | vazio | Link do app na Google Play, mostrado na landing para quem abre no celular Android. Vazio = celular recebe o `/apk`. No Worker: `vars`. |
| `ACCESS_TEAM`, `ACCESS_AUD`, `ACCESS_OWNER_EMAIL` | vazios | Só no Worker (RFC-025 §5): nome da equipe do Cloudflare Zero Trust, a AUD Tag da aplicação do painel e o e-mail do dono. Sem os três, `/admin*` responde 503; com eles, só passa quem chega pelo Access com o e-mail do dono (os outros recebem 404). `ACCESS_TEAM` em `vars`; os outros dois por `wrangler secret put`. |
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
- `public/site/` — site público (RFC-021/025, tema claro): `/` landing de venda, `/enviar` Enviar lista (destino do
  app das lojas, sem preço), `/cliente` Minha TV, `/assinar`, `/creditos` e `/pagar` (RFC-020: Pix e cartão
  pelo Mercado Pago, com CSP própria `PAY_CSP`; os botões de compra do site e do painel da revenda levam para lá).
  `pair-lib.js` é cópia idêntica de `server/pair/public/pair-lib.js` (há teste que exige isso).
- `public/revenda/` — painel do revendedor (RFC-022) em `/revenda/`: entra com a chave da revenda e usa só a API
  `/api/v1/*` (ativar TV, clientes, revendas, extrato, comprar créditos pelo WhatsApp, trocar chave).
- `license-checkout.mjs` — pagamento pelo Mercado Pago (RFC-020): `POST /v1/checkout` (Pix; cartão com 3DS nos
  créditos; assinatura anual no cartão para o aparelho), `GET /v1/checkout/:id`, `POST /webhooks/mercadopago`
  (assinatura validada, consulta na API, entrega única) e a aba Pagamentos do painel do dono: pedidos
  (`/admin/api/orders`, reprocessar) e assinaturas (`/admin/api/subscriptions`, cancelar renovação).
- `license-customer.mjs` — Minha TV (RFC-025 §3): `POST /v1/device-status` (só estado e data; código inexistente,
  vencido ou suspenso dão a mesma resposta) e `POST /v1/subscription/cancel` (código + e-mail do pagamento).
- `license-reports.mjs` — relatórios só de leitura do sócio (`/api/v1/reports/*`, chave `LICENSE_REPORT_TOKEN`).
- `license-access.mjs` — confere o JWT do Cloudflare Access (`Cf-Access-Jwt-Assertion`) do painel do dono.
- `mp-client.mjs` — chamadas à API do Mercado Pago com `fetch` (sem SDK), injetável nos testes.
- `pricing.mjs` — tabelas de preço do dono (créditos, assinatura de R$ 25, mensalidade do parceiro), em centavos.
- `sqlite-d1.mjs` — `node:sqlite` com a interface do D1.
- `license-server.mjs` — servidor Node local; `public/admin/` — páginas do painel.

## Painel do dono na Cloudflare (RFC-025 §5)
O painel fica em `https://dono.pulseplayer.com.br/admin/`, atrás do Cloudflare Access (código no e-mail). O servidor
Node local não tem Access: ele escuta só em 127.0.0.1.

1. Workers & Pages → `pulse-license` → Settings → Domains & Routes → Add → Custom domain: `pulseplayer.com.br` e
   `dono.pulseplayer.com.br`.
2. Zero Trust (menu lateral, plano Free) → escolha o nome da equipe (vira `<equipe>.cloudflareaccess.com`).
3. Zero Trust → Settings → Authentication → Login methods: só **One-time PIN**.
4. Zero Trust → Access → Applications → Add an application → **Self-hosted**: nome "Painel Pulse", domínio
   `dono.pulseplayer.com.br` (sem caminho), Session Duration 24 h.
5. Policy "Só o dono": Action **Allow**, Include → **Emails** → o seu e-mail. Nenhuma outra regra.
6. Copie o **Application Audience (AUD) Tag** da aplicação.
7. No Worker: `ACCESS_TEAM` = nome da equipe (Settings → Variables), e
   `npx wrangler secret put ACCESS_AUD --config server/license/wrangler.jsonc` (a tag) e
   `npx wrangler secret put ACCESS_OWNER_EMAIL --config server/license/wrangler.jsonc` (o seu e-mail).
8. Teste em aba anônima: `https://dono.pulseplayer.com.br/admin/` pede o código do e-mail; depois o painel pede o
   token. `https://pulseplayer.com.br/admin/` e o endereço `*.workers.dev/admin/` dão 404.

Perdeu o acesso ao e-mail: troque o e-mail na policy (passo 5) e em `ACCESS_OWNER_EMAIL`, pela conta da Cloudflare.
