# RFC-022 — Painel do revendedor

Status: **proposta (aguarda aprovação deste texto)** · Data: 2026-10-27 · Depende de: **RFC-019** (API dos
revendedores) e **RFC-020** (Pix, para comprar créditos pelo painel) · Ordem: 019 → 020 → 021 → **022**

> **Como usar:** cole este arquivo inteiro como primeira mensagem num chat novo aberto na pasta `reprodutor_de_video`.

---

## Prompt para a IA

Você vai construir o **painel web do revendedor** (`/revenda/`), servido pelo Worker do serviço de licença. É só uma
interface sobre a **API pública da RFC-019** (`/api/v1/*`) — nenhuma regra de negócio nova no painel. O revendedor
entra com a **chave** recebida na compra de créditos (RFC-020/021) ou dada pelo dono/revendedor acima dele.

Antes de qualquer código:
1. Leia `CLAUDE.md`, o `CLAUDE.md` global, **este arquivo**, a RFC-019 (API, regras R1–R6, guardrails G10–G14), a
   RFC-020 (compra de créditos pelo painel) e o painel do dono (`server/license/public/admin/*`), que é o modelo.
2. TDD (testes das rotas e do HTML servido; a lógica fica na API, já testada). Lint, testes e build verdes. Sem
   commit/push/deploy sem pedido.

---

## Por quê
O revendedor precisa ativar os clientes sozinho, a qualquer hora, criar as próprias revendas e ver o histórico, sem
pedir nada ao dono. Painéis de terceiros usam a mesma API; este painel é o "oficial".

## Telas (o que o dono pediu)
1. **Entrar:** campo da chave (guardada só na aba, `sessionStorage`, como o painel do dono). Link "Perdi a chave" →
   WhatsApp de suporte (`LICENSE_CONTACT_URL`).
2. **Início:** saldo de créditos em destaque, botão **Comprar créditos** e atalho **Ativar TV**.
3. **Ativar TV:** código do aparelho ("MAC", 8 caracteres) → mostra o aparelho (plataforma, ativado até) →
   **Ativar 1 ano (1 crédito)** com confirmação → resultado "Ativado até dd/mm/aaaa" e saldo novo. Erros claros: sem
   saldo, código inexistente ("abra o Pulse Player na TV uma vez"), aparelho suspenso. Envia `Idempotency-Key` por
   clique (RFC-019 G11), para um duplo clique não gastar 2 créditos.
4. **Meus clientes:** histórico de ativações feitas por ele (código, data, vence em), busca por código, "a vencer em 30
   dias" em destaque, botão "Renovar" (nova ativação = 1 crédito).
5. **Revendas:** lista das revendas diretas (nome, contato, saldo), **Criar revenda** (mostra a chave uma vez, com
   botão Copiar e aviso), **Passar créditos** (quantidade ≤ saldo), **Trocar chave** da revenda.
6. **Extrato:** movimentos de crédito (compras, repasses, ativações) com data e saldo.
7. **Comprar créditos:** quantidade (≥ 10) com o total pela tabela (mostrar a tabela), Pix da RFC-020 (QR + copia e
   cola), status a cada 3 s, crédito no saldo ao pagar.
8. **Minha chave / API:** trocar a própria chave; link para `API.md` (documentação para painéis de terceiros).

## Regras de interface
- Pensado para **celular primeiro** (o revendedor trabalha pelo celular), funcionando bem no PC.
- Visual da marca (RFC-015), mesmo CSS base do painel do dono e do site (RFC-021), sem framework e sem script externo
  (CSP do pareamento).
- Só `textContent` para dados vindos da API (nada vira HTML), como `admin.js`.
- Linguagem neutra (RFC-021 R4): nada de canais/filmes; "aparelho", "ativação", "créditos".

## Não objetivos
Login com senha/2FA, relatórios financeiros, comissão, múltiplos usuários por revenda, app próprio de revendedor.

## Desenho técnico
- Arquivos: `server/license/public/revenda/{index.html, revenda.js, revenda.css}`; o Worker serve `/revenda/` como o
  `/admin/` (mesma lista fixa de arquivos, CSP). Servidor Node local: mesma rota.
- Toda chamada: `fetch('/api/v1/...', { headers: { Authorization: 'Bearer ' + chave } })`; 401 → volta para "Entrar".
- Valores em centavos vindos da API, formatados com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
- Datas em `America/Sao_Paulo`.

## Testes
Worker serve `/revenda/` com CSP e sem `<script>` embutido; o HTML tem as 8 telas; `revenda.js` passa no lint; um
teste de fluxo com a API real em memória (`openSqlite(':memory:')`): entrar → ativar → saldo cai 1 → aparece em
"Meus clientes" → criar revenda → passar créditos → extrato confere.

## Riscos
Chave copiada para lugar inseguro pelo revendedor (mitigação: trocar chave, extrato, bloqueio pelo dono).
