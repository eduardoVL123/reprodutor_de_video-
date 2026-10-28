# RFC-019 — Revendedores, créditos, API de ativação e controle de acessos

Status: **proposta (decisões do dono registradas em 2026-10-27; aguarda aprovação deste texto)** · Data: 2026-10-27 ·
Depende de: RFC-018 (serviço de licença `server/license`, no ar em `https://pulse-license.pulseplayer.workers.dev`) ·
Ordem do projeto: **019 → 020 (Pix) → 021 (site) → 022 (painel do revendedor)**

> **Como usar:** cole este arquivo inteiro como primeira mensagem num chat novo (Claude Code ou outra IA de código)
> aberto na pasta `reprodutor_de_video`. Tudo o que a IA precisa saber está aqui ou nos arquivos que ele cita.

---

## Prompt para a IA

Você vai construir a camada de **revenda** do serviço de licença do Pulse Player: revendedores com saldo de créditos
pré-pagos, que ativam aparelhos de clientes (1 crédito = 1 aparelho por 1 ano), criam revendas abaixo deles e
repassam créditos; uma **API com chave** para painéis de terceiros fazerem o mesmo; e os **controles de acesso** que o
dono pediu no painel administrativo. Não há pagamento nesta RFC (é a RFC-020); aqui os créditos entram pelo painel
administrativo ("lançar compra").

Antes de qualquer código:
1. Leia o `CLAUDE.md` do projeto, o `CLAUDE.md` global do usuário (se existir), **este arquivo inteiro** e a
   `docs/rfc/RFC-018-ativos-e-ativacao.md` (regras de teste, ativação, parceiros e guardrails G1–G9, que continuam
   valendo).
2. Leia `server/license/` inteiro (README, `license-rules.mjs`, `license-db.mjs`, `license-core.mjs`,
   `license-admin.mjs`, `worker.mjs`) e os testes `tests/license*.test.js`.
3. TDD: teste primeiro, veja falhar, implemente, veja passar. `npm run lint`, `npx vitest run --maxWorkers=2` e
   `npm run build` verdes antes de dizer que terminou (a máquina tem 7,4 GB de RAM; não rode `python` no Bash).
4. Não faça commit, push nem deploy sem pedido explícito do dono. O serviço já está em produção com dados reais:
   toda mudança de tabela é **aditiva** (nunca apagar coluna nem tabela com dados).

Responda em português do Brasil, cite arquivo e linha e explique a causa antes de corrigir algo.

---

## Por quê

O dono vende ativações de três formas (RFC-018 + conversa de 2026-10-27):

| Quem paga | Como | Preço | Onde aparece |
|---|---|---|---|
| Cliente final | Assina o próprio aparelho por 1 ano | **R$ 25** | Site (RFC-021) |
| **Revendedor** | Compra créditos antes (mínimo 10) e ativa os clientes dele | tabela abaixo | Site + painel do revendedor |
| Dono de servidor (parceiro) | Pós-pago mensal pelos ativos da URL dele | tabela abaixo | **Só por fora** (nunca no site) |

O revendedor precisa ativar sozinho, a qualquer hora, e o dono precisa **autorizar painéis de terceiros** ("o usuário
tal pode ativar X TVs") **por API**. Hoje só o painel do dono ativa, à mão.

## Regras de negócio (definidas pelo dono — não alterar)

### R1. Tabela de créditos (revendedor; preço por crédito conforme a quantidade comprada de uma vez)
| Quantidade | Preço por crédito |
|---|---|
| 10 a 19 | R$ 10 |
| 20 a 50 | R$ 9 |
| 51 a 99 | R$ 8 |
| 100 a 499 | R$ 7 |
| 500 a 999 | R$ 6 |
| 1000 ou mais | R$ 5 |
Mínimo de compra: **10 créditos**. Exemplo: 20 créditos = 20 × R$ 9 = **R$ 180**.

### R2. Crédito
- **1 crédito ativa 1 aparelho por 1 ano** (mesma regra de `extendActivation`: soma 1 ano ao fim da ativação atual).
- O crédito é gasto **na hora da ativação** e **não volta** (revogar depois não devolve, salvo estorno manual do dono).
- Créditos não vencem (decisão minha; ver "Calls").

### R3. Sub-revendas
- O revendedor cria **revendas abaixo dele** e **repassa créditos do próprio saldo** para elas (a revenda compra dele,
  não de vocês). O repasse tira do saldo de quem passa e põe no de quem recebe; nunca cria crédito.
- **Níveis livres** (revenda de revenda), mas cada um **só vê e abastece as revendas diretas** dele (decisão minha:
  o dono não respondeu quantos níveis; ver "Calls").
- O dono (painel administrativo) vê a árvore toda.

### R4. Autorizar painéis de terceiros
"Autorizar o usuário tal a ativar X TVs" = o dono (ou um revendedor) **cria uma revenda para esse terceiro com X
créditos** e entrega a **chave de API** dela. O painel do terceiro usa a mesma API pública desta RFC.

### R5. Tabela do parceiro (pós-pago mensal, só por fora do site)
| Ativos no ciclo | Valor do mês |
|---|---|
| 1 a 250 | R$ 350 |
| 251 a 500 | R$ 600 |
| 501 a 1000 | R$ 850 |
| 1001 a 2000 | R$ 1.500 |
| 2001 a 5000 | R$ 3.000 |
| 5001 a 10000 | R$ 4.600 |
| acima de 10000 | **sob consulta** |
Ciclo e regra de ativo: RFC-018 R5/R6. Com 0 ativos no ciclo não há cobrança (decisão minha).

### R6. Cliente final: R$ 25 por 1 ano (o pagamento é a RFC-020; aqui só a constante).

## Objetivos (v1 desta RFC)
1. Tabelas de preço num lugar só (`server/license/pricing.mjs`), usadas pelo painel, pela API e pela RFC-020.
2. Revendedores com saldo, chave de API, sub-revendas e histórico (extrato) de créditos e de ativações.
3. API pública `/api/v1/*` com a chave do revendedor (ativar aparelho, saldo, extrato, ativações, sub-revendas,
   repasse) — idempotente e sem corrida no débito.
4. Painel administrativo: revendedores (criar, lançar créditos com preço da tabela, estornar, bloquear, trocar
   chave, ver árvore e extrato) e **controle de acessos dos aparelhos** (ver abaixo).
5. Relatório do parceiro mostra o **valor do mês** pela tabela R5.

### Controle de acessos (painel → Aparelhos), pedido do dono
- Lista de todos os aparelhos com filtro (em teste, ativados, bloqueados, liberados por parceiro, sem acesso) e busca
  por código; paginação.
- Ações: **Liberar** (1 mês, 3 meses, 1 ano ou até uma data), **Revogar** ativação, **Bloquear/Desbloquear**
  (bloqueado não usa o app nem com parceiro nem com ativação; o app mostra "Aparelho suspenso. Fale com o suporte."),
  **Dar mais dias de teste**, **Apagar dados** (pedido LGPD; o aparelho volta como novo se abrir o app de novo — avisar
  na confirmação), **Observação** (nome do cliente).
- Toda ação vai para um histórico com quem fez e quando.

## Não objetivos
- Pagamento (RFC-020), site (RFC-021), interface do painel do revendedor (RFC-022 — aqui só a API).
- Comissão, cupom, preço diferente por revendedor, crédito com validade, devolução automática.
- Login com usuário e senha para revendedor (a v1 usa a chave; ver RFC-022).

## Anti-objetivos
- Débito duplo (o mesmo pedido repetido gastar 2 créditos) ou saldo negativo.
- Um revendedor ver ou mexer em aparelho, extrato ou revenda que não é dele.
- Chave de API guardada em texto puro no banco ou aparecendo em log.
- Quebrar o app ou a RFC-018 (G1–G9) — o app não muda nesta RFC, exceto a tela de aparelho suspenso.

## Calls que fiz (o dono pode mudar)
- Níveis de sub-revenda livres; cada um vê só as revendas diretas; créditos só descem.
- Créditos não vencem. Crédito gasto não volta ao revogar (o dono estorna à mão no painel se quiser).
- Ativar um aparelho que já tem ativação **soma** 1 ano (como no painel), gastando 1 crédito.
- Aparelho bloqueado pelo dono: a API do revendedor recusa ativar (409) sem gastar crédito.
- Parceiro com 0 ativos no ciclo: R$ 0.

## Desenho técnico

### 1. Preços — `server/license/pricing.mjs` (puro, com testes)
- `CREDIT_TIERS`, `MIN_CREDITS = 10`, `creditUnitPrice(qty) -> centavos`, `creditTotal(qty) -> centavos`
  (inteiros em centavos, nunca float).
- `DEVICE_ANNUAL_PRICE = 2500` (centavos).
- `PARTNER_TIERS`, `partnerMonthlyPrice(actives) -> centavos | null` (`null` = sob consulta; 0 ativos → 0).

### 2. Banco (migrações aditivas em `MIGRATIONS`, `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN` protegido)
- `resellers(id INTEGER PK, parent_id INTEGER NULL, name TEXT, contact TEXT, key_hash TEXT UNIQUE, key_hint TEXT,
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0), active INTEGER DEFAULT 1, created_at INTEGER)`
  — `key_hash` = SHA-256 hex da chave; `key_hint` = últimos 4 caracteres para o dono reconhecer.
- `credit_movements(id PK, reseller_id, delta INTEGER, kind TEXT ('purchase'|'grant'|'refund'|'transfer_in'|
  'transfer_out'|'activation'), device_code TEXT NULL, counterpart_id INTEGER NULL, amount_cents INTEGER NULL,
  note TEXT, created_by TEXT, created_at INTEGER, idempotency_key TEXT NULL, UNIQUE(reseller_id, idempotency_key))`.
- `activations` ganha `reseller_id INTEGER NULL` e `source` passa a aceitar `'reseller'` e `'payment'`.
- `devices` ganha `blocked_at INTEGER NULL`, `note TEXT NULL`.
- `device_events(id PK, device_key, action TEXT, detail TEXT, actor TEXT, created_at INTEGER)` — histórico de ações.
- **Débito atômico:** `UPDATE resellers SET credits = credits - 1 WHERE id = ? AND credits >= 1 AND active = 1`;
  `changes = 0` → 402 (sem saldo). Movimento + ativação no mesmo `db.batch([...])` (D1 roda o batch numa transação;
  no `sqlite-d1.mjs`, implementar `batch` com `BEGIN/COMMIT`). Repasse = débito do pai + crédito do filho no mesmo
  batch.
- **Idempotência:** header `Idempotency-Key` (até 64 caracteres) obrigatório em `POST /api/v1/activations` e
  `POST .../credits`; repetir a mesma chave devolve a mesma resposta sem novo débito (UNIQUE no movimento).

### 3. Acesso do aparelho bloqueado (`license-rules.mjs`)
- `accessFor` ganha `blockedAt`: bloqueado → `'suspended'` antes de tudo (vale sobre teste, parceiro e ativação).
- No app, `'suspended'` bloqueia como `'blocked'` e segue o G2 (sem resposta do serviço, o último estado vale por até
  7 dias). A tela mostra o texto de suspenso, sem QR de planos.

### 4. API pública `/api/v1/*` (núcleo em `server/license/license-api.mjs`)
Autenticação: `Authorization: Bearer <chave do revendedor>` (comparação pelo hash; revendedor inativo → 403).
Limite por chave: 120 req/min. Respostas JSON com `error` em português. CORS liberado (painéis de terceiros).
| Rota | Faz |
|---|---|
| `GET /api/v1/me` | nome, saldo, revendedor pai (nome), data de criação |
| `GET /api/v1/devices/:code` | existe? plataforma, ativado até, bloqueado? (só dados de licença, nunca de outros revendedores) |
| `POST /api/v1/activations {code}` | gasta 1 crédito e ativa 1 ano → `{code, activationEndsAt, credits}`; 404 código inexistente; 409 bloqueado; 402 sem saldo |
| `GET /api/v1/activations?cursor=` | ativações feitas por este revendedor (código, quando, até quando), 50 por página |
| `GET /api/v1/movements?cursor=` | extrato de créditos |
| `GET /api/v1/sub-resellers` | revendas diretas com saldo |
| `POST /api/v1/sub-resellers {name, contact}` | cria revenda direta; devolve a chave **uma única vez** |
| `POST /api/v1/sub-resellers/:id/credits {amount}` | repassa créditos (inteiro ≥ 1) |
| `POST /api/v1/sub-resellers/:id/key` | troca a chave da revenda direta (devolve a nova uma vez) |
| `POST /api/v1/me/key` | troca a própria chave |
Documentação para terceiros: `server/license/API.md` (exemplos `curl`).

### 5. Painel administrativo (`license-admin.mjs` + `public/admin/*`)
- Aba **Revendedores**: árvore, criar (mostra a chave uma vez), lançar compra (`grant` com `amount_cents` pela
  tabela R1, ou valor livre com observação), estornar, bloquear, trocar chave, extrato.
- Aba **Aparelhos**: lista e ações da seção "Controle de acessos".
- Aba **Relatório**: coluna "Valor do mês" (R5); "sob consulta" acima de 10000.

### 6. App (mínimo)
- `licenseStore`: `'suspended'` bloqueia como `'blocked'`; `ActivationRequired.vue` mostra "Aparelho suspenso. Fale com
  o suporte." sem QR quando `access === 'suspended'`.

## Guardrails
- **G1–G9 da RFC-018 valem.**
- **G10 Dinheiro em centavos inteiros**; preço sempre calculado no servidor pela tabela, nunca vindo do cliente.
- **G11 Débito atômico e idempotente** (seção 2); teste de corrida: 5 ativações simultâneas com saldo 3 → 3 ativam, 2
  recebem 402, saldo 0, nunca negativo.
- **G12 Isolamento**: todo acesso da API filtra por `reseller_id` do dono da chave; teste para cada rota tentando o
  recurso de outro revendedor (403/404).
- **G13 Chaves**: geradas com `crypto.getRandomValues` (32 bytes, base64url, prefixo `pk_`), guardadas só como
  SHA-256; mostradas uma vez.
- **G14 Migração aditiva** e testada sobre um banco com dados da RFC-018.

## Plano de implementação (ordem)
1. `pricing.mjs` + testes de tabela (exemplos R1 e R5, bordas 10/19/20/50/51/99/100/499/500/999/1000, 250/251…10001).
2. Migrações + `batch` no `sqlite-d1.mjs` + testes de migração sobre banco da RFC-018.
3. Revendedores no admin (criar, chave, lançar créditos, extrato) + testes.
4. API pública (ativar, saldo, extrato, ativações) com idempotência e corrida + testes G11/G12.
5. Sub-revendas (criar, repassar, trocar chave) + testes.
6. Controle de acessos dos aparelhos (lista, ações, histórico, `suspended` no app) + testes.
7. Valor do mês no relatório do parceiro.
8. `API.md`, README, deploy (`npm run license:deploy`, só com pedido).

## Testes (mínimo)
Tabelas R1/R5; débito, saldo insuficiente, idempotência, corrida (G11); isolamento por revendedor (G12); repasse
nunca cria crédito e não deixa saldo negativo; sub-revenda vê só as próprias; aparelho bloqueado não ativa e não gasta;
`suspended` no app; migração aditiva preserva dados.

## Riscos
- **Chave vazada de um terceiro**: ele gasta os créditos daquela revenda (só dela). Mitigação: trocar chave, bloquear
  revenda, extrato.
- **Limites por isolate no Worker** (RFC-018): débito é seguro (está no banco); só a taxa por minuto é aproximada.
- **D1 batch**: confirmar no Cloudflare que `db.batch` é transacional (🔎).

## Futuro
Login com senha e 2FA para revendedor, comissão por nível, relatórios de vendas, webhooks para painéis de terceiros.
