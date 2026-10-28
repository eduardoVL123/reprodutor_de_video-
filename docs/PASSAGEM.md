# Passagem de bastão — Pulse Player (estado em 2026-10-28)

> **Para a IA que for continuar:** leia este arquivo inteiro, depois `CLAUDE.md`, e só então os documentos citados.
> Responda em português do Brasil. Não faça commit, push nem deploy sem pedido explícito do dono. Não edite `.env*`
> sem pedir. Antes de dizer que terminou: `npm run lint`, `npx vitest run --maxWorkers=2`, `npm run build`
> (a máquina tem 7,4 GB de RAM; **não** rode `python` no Bash — abre a Loja do Windows e trava; use `node -e`).
> Nunca digite token, senha ou chave do Mercado Pago em lugar nenhum: o dono grava os segredos no terminal dele.

## O produto
Pulse Player: reprodutor de listas Xtream/M3U em Vue 3 + Vite + Capacitor 8, para TVs Samsung (Tizen), LG (webOS),
Android TV e celular Android. APK sai do CI do GitHub (`eduardoVL123/reprodutor_de_video-`, workflow
`.github/workflows/build-apk.yml`, Node 24). Não há JDK nesta máquina: Java só compila no CI.

## Monetização — RFCs em `docs/rfc/`
| RFC | O quê | Estado |
|---|---|---|
| 018 | Teste de 7 dias, ativos por servidor parceiro (cobrança mensal), ativação anual, painel `/admin/` | Feita, **no ar** (versão antiga) |
| 019 | Revendedores, créditos, sub-revendas, API `/api/v1/*` (doc `server/license/API.md`) | Commitada, **não publicada** |
| 020 | Pagamento pelo **Mercado Pago**: Pix + cartão (3DS) e assinatura anual no cartão | **Etapas 1–6 commitadas, não publicadas**; falta a etapa 7 (teste com credenciais) |
| 021 | Site: `/` Enviar lista, `/assinar`, `/creditos` | Commitada, **não publicada**; os botões de compra levam a `/pagar` |
| 022 | Painel do revendedor `/revenda/` | Commitado, **não publicado**; botão de compra leva a `/pagar` |

**Site redesenhado em 2026-10-28 (commitado, não publicado)**, aprovado pelo dono: logo oficial em SVG embutido (o guia da marca
proíbe o nome em texto), cores da marca como tokens em `public/site/site.css` (grafite, off-white `#F4F7EE`, limão),
fontes do sistema (a CSP não carrega fontes), o código da TV em 8 casas (`input.code`) como elemento marcante, linha de
pulso que "bate" uma vez quando a lista chega, faixa de créditos marcada ao vivo, `/pagar` com resumo em painel e
Pix/Cartão segmentado. `/revenda/` e `/admin/` não mudaram. Falta: favicon (o site responde 404 em `/favicon.ico`).

Tudo mora em `server/license/` (Cloudflare Worker + D1; o mesmo código roda local com `node:sqlite`).
Mapa de arquivos: `server/license/README.md`.

### Preços do dono (em `server/license/pricing.mjs`, centavos)
- Cliente final: R$ 25/ano por aparelho.
- Créditos de revenda (1 crédito = 1 aparelho por 1 ano): 10–19 R$10 · 20–50 R$9 · 51–99 R$8 · 100–499 R$7 ·
  500–999 R$6 · 1000+ R$5 (mínimo 10).
- Parceiro (pós-pago mensal, **nunca aparece no site**): até 250 ativos R$350 · 251–500 R$600 · 501–1000 R$850 ·
  1001–2000 R$1.500 · 2001–5000 R$3.000 · 5001–10000 R$4.600 · acima: sob consulta.
- WhatsApp de vendas/suporte: `https://wa.me/5516992791692` (`LICENSE_CONTACT_URL` em `server/license/wrangler.jsonc`).

## RFC-020 (Mercado Pago) — onde parou
Leia `docs/rfc/RFC-020-pix-mercado-pago.md` (revisada e aprovada em 2026-10-28; registra cada decisão).

**Aplicação no Mercado Pago:** "Pulse Player", App ID `1621294583952670`, país MLB, Checkout Transparente, API
**Orders**. Criada pelo plugin do Mercado Pago (MCP `plugin:mercadopago:mcp`, o dono autoriza pelo `/mcp`). A criação
automática do usuário de teste falhou do lado deles (`MP_API_DOWN`): criar de novo com `create_test_user`.
Progresso do assistente do plugin: `.mp-integrate-progress.md` (fora do Git).

**Decisões do dono:** Pix + cartão; cartão do aparelho = assinatura anual que renova sozinha (créditos e Pix são
avulsos); 3DS ligado; sem split; sem SDK de servidor (chamadas com `fetch`); cancelamento da renovação pelo WhatsApp
(o dono cancela no painel); Pix vence em 30 min; `'unsafe-inline'` em `script-src` **só** na `/pagar` (o SDK injeta
o script antifraude, que muda a cada carga).

| Etapa | O quê | Estado |
|---|---|---|
| 1 | Tabela `orders`, `mp-client.mjs`, `POST /v1/checkout` (Pix), `GET /v1/checkout/:id` | Feita |
| 2 | `POST /webhooks/mercadopago` (assinatura `x-signature`, consulta na API, entrega única) + consulta de reserva pela tela | Feita |
| 3 | Cartão com 3DS nos créditos + `POST /api/v1/credits/checkout` (painel da revenda) | Feita |
| 4 | Assinatura anual no cartão (`/preapproval`), parcelas, cancelamento | Feita |
| 5 | Tela `/pagar` (Pix e cartão), CSP própria `PAY_CSP`, `/v1/mp-config`, três botões ligados | Feita, vista no navegador |
| 6 | Aba **Pagamentos** no painel do dono (pedidos, reprocessar, assinaturas) | Feita, vista no navegador |
| 7 | Teste com as credenciais **de teste** do Mercado Pago | **Não começada** |

Arquivos novos: `server/license/license-checkout.mjs`, `server/license/mp-client.mjs`,
`server/license/public/site/pagar.html` e `pagar.js`, `tests/licenseCheckout.test.js`, `tests/payPage.test.js`.
Última verificação: lint ok, 920 testes ok, build ok.

### Como continuar a RFC-020 (etapa 7)
1. **Ajuste antes de testar (falta fazer, com TDD):** no modo de teste, o Mercado Pago só aprova Pix com
   `payer.first_name = "APRO"`. Proposta aprovada em conversa, ainda não feita: variável opcional
   `MP_TEST_PIX_PAYER_NAME`; se preenchida, o pedido Pix manda `payer.first_name` com ela.
2. **Rodada local (sem publicar):** criar o comprador de teste (`create_test_user`); o dono grava no terminal dele
   `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY` (aba "Credenciais de teste"), `MP_TEST_PIX_PAYER_NAME=APRO`,
   `LICENSE_ADMIN_TOKEN` e `LICENSE_PORT=8794`, e roda `npm run license`. Testar no navegador: Pix do aparelho e dos
   créditos (a tela confirma sozinha em até ~1 min, sem webhook), cartão `APRO-AUTH` (aprovado), `APRO-CHOK`
   (desafio 3DS), `OTHE-CHNO`/`OTHE-NAUT` (recusado); cartão Visa `4235 6477 2802 5682`, CVV `123`, `11/30`,
   CPF `12345678909`. O e-mail do pagador é o do comprador de teste (nunca o da conta do dono: erro 4390).
3. **Rodada na Cloudflare (pedir OK do dono):** Worker de teste separado (ex.: `pulse-license-teste`, D1 próprio,
   `--env teste`), segredos com `wrangler secret put --env teste`, publicar só esse Worker, cadastrar o webhook
   (`save_webhook`, tópicos `order`, `subscription_preapproval`, `subscription_authorized_payment`), testar a
   assinatura (1ª parcela em até ~1 h) e conferir `notifications_history`. **Não** testar na produção.
4. **Pontos 🔎 a confirmar no teste:** campos de `GET /authorized_payments/{id}` (`payment.status`,
   `preapproval_id`, `transaction_amount`, `currency_id`) — se diferirem, nada é entregue; `frequency: 12` +
   `months` aceito; se `APRO` puro funciona com 3DS ligado; estreitar os domínios da `PAY_CSP`.
5. Depois: `/mp-review` (checklist oficial) + formulário de homologação → credenciais de produção → publicar.

## Estado do Git e da produção
- Branch `main`, **tudo enviado ao GitHub em 2026-10-28** (RFC-019, 021, 022, RFC-020 etapas 1–6, novo visual do
  site e as correções da auditoria ponytail). O push dispara o CI do APK. **Nada foi publicado no Worker**: a
  produção segue na versão da RFC-018 até `npm run license:deploy` (com pedido do dono).
- Produção: `https://pulse-license.pulseplayer.workers.dev` (painel `/admin/`), ainda a versão da RFC-018. Token do
  painel em `server/license/.data/admin-token.txt` (fora do Git). Publicar: `npm run license:deploy` (wrangler já
  logado). As tabelas novas são criadas sozinhas na primeira chamada (migrações só acrescentam).
- Variável do GitHub `PULSE_LICENSE_BASE_URL` já existe: todo APK novo vem com a licença ligada.
- Ferramenta de visualização local: `.claude/launch.json` da pasta **de cima** (fora do Git) tem `license-pagar`
  (porta 8792, chaves **falsas** do Mercado Pago, token de painel `token-local-de-teste`, banco temporário
  `pulse-license-pagar.db` no `%TEMP%`, com 3 pedidos e 2 assinaturas de exemplo). O painel de navegador aceita no
  máximo 5 servidores nesta pasta; outras conversas usam as portas 8790/8791.

## Outros próximos passos (pergunte ao dono a ordem)
1. Push + `npm run license:deploy` (o dono ainda não autorizou).
2. Testar nas TVs reais: caixa de entrada do site (chave no IndexedDB nunca rodou em Tizen/webOS), ID da TV
   (Samsung DUID / LG LGUDID), tela de ativação.
3. Problemas de vídeo antigos: E-AC3 sem som (limite da WebView; solução real = player nativo Media3 + ffmpeg, não
   aprovado); falhas de VOD só no celular aguardam a foto do erro com a "linha do tempo".
4. Guarda de 24 meses (PRIVACY.md) ainda não apaga pedidos antigos (`orders`): decisão do dono (registro fiscal).
5. Auditoria ponytail (2026-10-28) feita e corrigida: erro ambíguo do Mercado Pago não perde pedido pago, assinatura
   exige o segredo do webhook, aparelho com renovação ativa não pode ser apagado, `delivering` preso é retomado.

## Regras que o dono já fixou (não reabrir)
- Celular se reconhece por `html.is-phone` (variante Tailwind `phone:`), **nunca** por largura de janela.
- Regras de TV do `CLAUDE.md` (foco, Chromium 63, margem segura).
- Site é majoritariamente "enviar lista"; só duas abas de venda; nada de parceria/conteúdo no site.
- Sub-revendas: níveis livres, cada um vê só as revendas diretas, créditos só descem, não vencem.
- Queda de https para http com a senha na URL **fica como está** (RFC-008): `apiRequest` e `authenticate`
  (variante `http://host:8080`) em `src/services/xtreamApi.js`. O selo "sem criptografia" avisa depois.
- Rota `/v1/hello` **fica** (o app não usa, mas o dono preferiu manter).
- Mercado Pago: decisões listadas na seção da RFC-020 acima.

## Histórico e decisões detalhadas
- `docs/rfc/RFC-020-pix-mercado-pago.md` (pagamento) e `docs/superpowers/plans/2026-10-27-ativos-e-ativacao-HANDOFF.md` (RFC-018).
- Notas de sessão fora do repo: `C:\Users\victo\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\`.
- `git log` tem mensagens detalhadas de cada mudança.
