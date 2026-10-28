# API de ativação do Pulse Player (revendedores e painéis de terceiros)

Endereço: `https://pulse-license.pulseplayer.workers.dev` · Formato: JSON · Erros: `{ "error": "mensagem em português" }`.

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

Datas em milissegundos desde 1970 (UTC). Valores em centavos. `kind` do extrato: `purchase` (compra), `grant`
(cortesia), `refund` (estorno), `activation`, `transfer_in`, `transfer_out`.

## Erros comuns
| Código | Quando |
|---|---|
| 400 | Dados inválidos ou falta `Idempotency-Key` |
| 401 | Chave inválida ou trocada |
| 402 | Saldo de créditos insuficiente |
| 403 | Revenda bloqueada |
| 404 | Código de aparelho inexistente (a TV precisa abrir o Pulse Player uma vez) ou revenda que não é sua |
| 409 | Aparelho suspenso pelo Pulse Player |
| 429 | Muitas chamadas seguidas |

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
