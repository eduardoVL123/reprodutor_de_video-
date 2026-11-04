# API de ativação do Pulse Player (revendedores e painéis de terceiros)

Endereço: `https://pulse-license.pulseplayer.workers.dev` · Formato: JSON · Erros: `{ "error": "mensagem em português" }`.

## Em poucas palavras
Com a sua chave `pk_…` o seu sistema faz, sozinho, tudo o que você faz no painel da revenda:

- **Ver seu saldo de créditos**: `GET /api/v1/me`.
- **Ver se uma TV existe e até quando está ativa**: `GET /api/v1/devices/ABCD2345` (o código de 8 letras aparece
  na tela da TV).
- **Ativar uma TV por 1 ano** (gasta 1 crédito; se ela já estava ativa, soma mais 1 ano ao fim):
  `POST /api/v1/activations` com `{"code":"ABCD2345"}`. Leva o cabeçalho `Idempotency-Key`: se a internet cair no
  meio, repita a chamada com a **mesma** `Idempotency-Key` e ela não gasta duas vezes.
- **Listar suas ativações e seu extrato**, 50 de cada vez, das mais novas para as mais antigas:
  `GET /api/v1/activations` e `GET /api/v1/movements`. Para ver os 50 seguintes, acrescente `?before=<id do último>`.
- **Cuidar das revendas abaixo de você**: criar uma revenda, passar créditos para ela (com `Idempotency-Key`) e
  trocar a chave dela.
- **Comprar créditos** por Pix ou cartão: `POST /api/v1/credits/checkout`. Depois, consulte
  `GET /v1/checkout/{orderId}?s={viewSecret}` até o `status` virar `paid`.
- **Trocar a sua chave**: `POST /api/v1/me/key`. A chave antiga para de funcionar na hora.

**Receita comum (ativar depois de vender):** o seu sistema confirma o pagamento do cliente → chama
`POST /api/v1/activations` com o código da TV e uma `Idempotency-Key` igual ao número do seu pedido → guarda o
`activationEndsAt` que voltou e mostra ao cliente. Se voltar `402`, falta crédito; `404`, a TV ainda não abriu o
Pulse Player com internet; `409`, o aparelho está suspenso (fale com o Pulse Player).

**O que a API não faz:** apagar aparelho, desfazer ativação, ver aparelhos ou clientes de outras revendas, ver dados
pessoais de clientes ou mexer em preços. Isso fica só com o Pulse Player.

## Autenticação
Toda chamada leva a chave do revendedor (recebida do Pulse Player ou da revenda acima):

```
Authorization: Bearer pk_...
```

A chave é mostrada **uma única vez** quando é criada ou trocada. Guarde num lugar seguro: quem tiver a chave gasta os
seus créditos. Se vazar, troque (`POST /api/v1/me/key`) ou peça a quem está acima de você.

Limite: 120 chamadas por minuto por chave (acima disso, `429` com `Retry-After`).

## Idempotência (obrigatória onde gasta crédito)
`POST /api/v1/activations` e `POST /api/v1/sub-resellers/{id}/credits` exigem o cabeçalho
`Idempotency-Key: <valor único por operação>` (até 64 caracteres, por exemplo um UUID). Repetir a mesma chave devolve
a mesma resposta **sem gastar de novo** — use isso para refazer a chamada quando a rede cair.

## Rotas

| Método e rota | O que faz | Resposta |
|---|---|---|
| `GET /api/v1/me` | Seus dados e saldo | `{ id, parentId, name, contact, credits, active, keyHint, createdAt }` |
| `GET /api/v1/devices/{código}` | Situação de um aparelho (código de 8 letras que aparece na TV) | `{ code, platform, activationEndsAt, suspended }` |
| `POST /api/v1/activations` `{ "code": "ABCD2345" }` | Ativa o aparelho por **1 ano** gastando **1 crédito** (se já tinha ativação, soma 1 ano ao fim) | `{ code, activationEndsAt, credits }` |
| `GET /api/v1/activations?before={id}` | Suas ativações, 50 por página, mais novas primeiro | `[{ id, code, startsAt, endsAt, revokedAt }]` |
| `GET /api/v1/movements?before={id}` | Extrato de créditos | `[{ id, delta, kind, deviceCode, counterpartId, amountCents, note, createdAt }]` |
| `GET /api/v1/sub-resellers` | Suas revendas diretas | lista no formato de `/me` |
| `POST /api/v1/sub-resellers` `{ "name": "...", "contact": "..." }` | Cria revenda abaixo de você | `{ id, key }` (a chave aparece só aqui) |
| `POST /api/v1/sub-resellers/{id}/credits` `{ "amount": 10 }` | Passa créditos do seu saldo para a revenda | `{ toId, amount, credits }` |
| `POST /api/v1/sub-resellers/{id}/key` | Troca a chave da revenda | `{ key }` |
| `POST /api/v1/me/key` | Troca a sua chave (a atual para na hora) | `{ key }` |
| `POST /api/v1/credits/checkout` `{ "method": "pix", "quantity": 10, "email": "..." }` | Compra créditos pelo Mercado Pago (mínimo 10, preço pela tabela). Cartão: `"method": "card"` e `"card": { "token", "paymentMethodId", "cpf" }` (token do SDK JS do Mercado Pago) | `{ orderId, viewSecret, status, amountCents, expiresAt, pix? , challengeUrl? }`; acompanhe em `GET /v1/checkout/{orderId}?s={viewSecret}` |

Datas em milissegundos desde 1970 (UTC). Valores em centavos. `kind` do extrato: `purchase` (compra), `grant`
(cortesia), `refund` (estorno), `activation`, `transfer_in`, `transfer_out`.

## Erros comuns
| Código | Quando |
|---|---|
| 400 | Dados inválidos ou falta `Idempotency-Key` |
| 401 | Chave inválida ou trocada |
| 402 | Saldo de créditos insuficiente, ou cartão recusado na compra de créditos |
| 403 | Revenda bloqueada |
| 404 | Código de aparelho inexistente (a TV precisa abrir o Pulse Player uma vez) ou revenda que não é sua |
| 409 | Aparelho suspenso pelo Pulse Player |
| 429 | Muitas chamadas seguidas, ou 30 chaves erradas da mesma rede em 15 minutos (espere o tempo de `Retry-After`) |

## Exemplo
```bash
curl -X POST https://pulse-license.pulseplayer.workers.dev/api/v1/activations \
  -H "Authorization: Bearer pk_SUA_CHAVE" \
  -H "Idempotency-Key: 6f1c2a1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f" \
  -H "Content-Type: application/json" \
  -d '{"code":"ABCD2345"}'
```

Regras: cada revenda só vê as próprias ativações, o próprio extrato e as revendas diretas dela. Créditos só descem
(de quem está acima para quem está abaixo) e não vencem. Crédito gasto não volta se a ativação for revogada.

## Relatórios (chave de leitura, RFC-025)
Para quem acompanha os números do Pulse Player sem poder mudar nada. A chave é outra, entregue pelo dono, e só
serve para **ler** estas três rotas. Ela não funciona no painel do dono nem nas rotas de revenda acima.

```
Authorization: Bearer <chave de leitura>
```

| Rota | O que devolve |
|---|---|
| `GET /api/v1/reports/summary?month=2026-11` | Resumo do mês: `{ month, activeDevices, trials, activations, paidOrders, revenueCents, byKind: { device_annual: { orders, cents }, credits: { orders, cents } } }` |
| `GET /api/v1/reports/partners` | Parceiros e os aparelhos ativos de cada ciclo mensal: `[{ partnerId, name, active, cycles: [{ start, end, actives, monthlyCents }] }]` |
| `GET /api/v1/reports/orders?month=2026-11&before={seq}` | Pedidos do mês, 50 por vez, mais novos primeiro: `[{ seq, id, createdAt, paidAt, kind, method, quantity, amountCents, status }]`. Para os próximos 50, `before` = o `seq` do último |

- `month` é o mês no horário de Brasília (`AAAA-MM`); sem ele, o mês atual.
- `activeDevices`: aparelhos com ativação valendo agora. `trials`: em teste e sem ativação. `activations`: ativações
  que começaram no mês. `paidOrders` e `revenueCents`: pedidos pagos no mês pelo site (Pix e cartão). As renovações
  automáticas do cartão nos anos seguintes ainda não entram nesse total.
- Nenhuma resposta traz código de aparelho, nome, contato ou e-mail de cliente.
- Limites: 60 chamadas por hora; 10 chaves erradas da mesma rede travam por 15 minutos (`429`). `POST` com a chave de
  leitura → `405`. Sem a chave configurada no servidor → `503`.
- Se a chave vazar, o dono troca e a antiga para na hora.

```bash
curl https://pulse-license.pulseplayer.workers.dev/api/v1/reports/summary?month=2026-11 \
  -H "Authorization: Bearer SUA_CHAVE_DE_LEITURA"
```
