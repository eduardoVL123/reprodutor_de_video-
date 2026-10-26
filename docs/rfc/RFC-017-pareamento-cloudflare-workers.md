# RFC-017 — Servidor de pareamento no Cloudflare Workers (grátis)

Status: **implementada no código (aguardando passos manuais do dono: DNS no Cloudflare, wrangler login, pair:deploy e variável no GitHub)** · Data: 2026-10-25 · Substitui a decisão D2 da RFC-016 (VM paga)

> **Como usar:** cole este arquivo inteiro como primeira mensagem num chat novo (Claude Code ou outra IA de código)
> aberto na pasta `reprodutor_de_video`. Tudo o que a IA precisa saber está aqui ou nos arquivos que ele cita.

---

## Prompt para a IA

Você vai portar o **servidor de pareamento pelo celular** do Pulse Player, que hoje é um servidor Node (`node:http`)
pensado para rodar numa VM, para **Cloudflare Workers + Durable Objects no plano grátis**. O protocolo, a página do
celular e o app da TV **não mudam**: só o lugar onde o servidor roda. O dono não quer pagar VM.

Antes de qualquer código:

1. Leia o `CLAUDE.md` do projeto, o `CLAUDE.md` global do usuário (se existir) e **este arquivo inteiro**.
2. Leia a RFC original: `docs/rfc/RFC-016-pareamento-pelo-celular.md` (por quê, protocolo, formato do `box`, limites).
3. Leia o servidor atual: `server/pair/pair-server.mjs`, `server/pair/README.md` e a pasta `server/pair/public/`.
4. **O repositório tem ~40 arquivos alterados e sem commit** (todo o trabalho da RFC-016, na branch `main`).
   Pergunte ao dono se ele quer commitar isso antes de você começar. Não descarte nada. Não faça commit, push ou
   deploy sem pedido explícito.
5. Rode `npm install`, `npm run lint` e `npm test` e confirme que está tudo verde (eram 512 testes) antes de mexer.
6. Confira na documentação **atual** do Cloudflare os pontos marcados com 🔎 abaixo (planos grátis mudam sem aviso).
7. Siga TDD: teste primeiro, veja falhar, implemente, veja passar. Lint e testes verdes antes de dizer que terminou.

Responda em português do Brasil, cite arquivo e linha e explique a causa antes de corrigir algo.

---

## Contexto

### O produto
Pulse Player é um reprodutor de mídia para Smart TVs (Samsung Tizen, LG webOS, Android TV). O usuário recebe o link
da lista dele por WhatsApp/e-mail; digitar isso no controle remoto é o pior momento do app. O **pareamento** resolve:
a TV mostra um QR code + código de 6 letras, o celular abre a página do serviço, cola o link e envia; a TV recebe e
pergunta "Adicionar esta lista?". Tudo isso já está pronto e testado (RFC-016, fases 1 a 5). Falta só hospedar.

### O que já existe (não reescreva o que não precisa)
| Arquivo | O que é | Muda nesta RFC? |
|---|---|---|
| `server/pair/pair-server.mjs` | API + arquivos estáticos em `node:http`, sessões num `Map` em memória, limites por IP | **Sim:** separar a lógica num núcleo sem `node:http` |
| `server/pair/public/` (`index.html`, `app.js`, `app.css`, `pair-lib.js`) | Página do celular, cifra no navegador | **Não** |
| `src/services/pairingApi.js`, `pairingCrypto.js`, `src/composables/usePairing.js`, `src/components/PairPanel.vue` | Lado da TV | **Não** (só o endereço em `VITE_PAIR_BASE_URL`) |
| `server/pair/Dockerfile`, `server/pair/deploy/` (Caddy + compose) | Deploy em VM | **Sim:** remover (a história do git guarda) |
| `.github/workflows/build-apk.yml` job `pair-server` | Monta a imagem Docker | **Sim:** trocar por uma checagem do Worker |
| `tests/pairServer.test.js` (35 testes) | Testa a API pelo HTTP real | **Continua valendo** pelo adaptador Node |
| `tests/pairingFlow.test.js` | Contrato TV ↔ servidor ↔ celular | **Continua valendo** |
| `tests/pairDeploy.test.js` | Guarda do Docker/Caddy | **Sim:** reescrever para o Worker |
| `PRIVACY.md`, `README.md`, `docs/lojas/PUBLICACAO.md`, `server/pair/README.md` | Textos | **Sim:** o Cloudflare entra como quem processa as requisições |

### O protocolo (contrato, NÃO mudar)
```
TV  POST /v1/sessions                 { pub }   -> 201 { code, secret, expiresIn: 600 }
Cel GET  /v1/sessions/:code                     -> 200 { pub }
Cel POST /v1/sessions/:code/payload   { box }   -> 204
TV  GET  /v1/sessions/:code/payload   cabeçalho X-Pair-Secret -> 204 (esperando) | 200 { box } (uma vez, depois apaga)
GET /healthz -> 200 "ok" · GET / e GET /<código> -> index.html · GET /app.js /pair-lib.js /app.css
```
Regras que os testes já cobrem e que o port tem que manter **idênticas** (valores em `pair-server.mjs:18-62`):
- Código: 6 letras de `ABCDEFGHJKMNPQRSTUVWXYZ23456789`; segredo: 16 bytes aleatórios em base64url, comparado em tempo constante.
- Validade 10 min; depois do envio, no máximo 60 s; leitura única (apaga ao entregar); segundo envio → `409`.
- Erros: `400` dado inválido, `403` segredo errado, `404` código desconhecido/expirado/lido, `405` método,
  `413` corpo > 4096 bytes, `429` com `Retry-After`, `503` com mais de 10.000 sessões.
- `pub` ≤ 128 e `box` ≤ 3600 caracteres base64url; o servidor nunca abre o `box` (cifra de ponta a ponta).
- Limites por IP e por minuto: 10 sessões novas, 120 consultas da TV, 30 chamadas do celular, 20 códigos errados.
- Cabeçalhos: API com CORS `*` (`GET, POST, OPTIONS`, `Content-Type, X-Pair-Secret`), tudo com `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`; HTML com a CSP de `pair-server.mjs:34`.
- `HEAD` funciona na página e no `/healthz`. **Nada de corpo nem segredo em log.**

---

## Decisões já tomadas (pelo dono e nesta RFC)

| Tema | Decisão |
|---|---|
| Hospedagem | Cloudflare Workers + Durable Objects, plano **grátis** |
| Domínio | `par.pulseplayer.com.br` (domínio ativo no Registro.br). Exige mover o DNS do domínio para o Cloudflare (o dono faz, passo a passo abaixo). Enquanto isso, o endereço `*.workers.dev` serve para testar |
| Estado | **Um único Durable Object** ("hub") com o mesmo `Map` em memória de hoje. É o port mais curto: a lógica e os testes atuais continuam valendo. Perder as sessões num reinício/deploy é aceitável (a TV gera outro código), como já era na VM |
| IP do cliente | Cabeçalho `CF-Connecting-IP` (o Cloudflare põe; o cliente não consegue falsificar). Some a opção `trustProxy`/`X-Forwarded-For` no Worker |
| Logs | Observabilidade/Logpush do Worker **desligados** na configuração; nenhum `console.log` com corpo ou segredo |
| Deploy | Manual pelo dono (`wrangler deploy`). Deploy automático pelo CI fica para depois |
| Docker/Caddy | Removidos (não há mais VM) |

## Não objetivos
- Não mudar protocolo, página do celular, app da TV, cifra ou textos da tela.
- Não guardar sessão em disco/SQLite do Durable Object (fica em memória, como hoje).
- Não criar conta, login ou painel.

## Anti-objetivos (seria falha mesmo funcionando)
- Qualquer log, analytics ou trace do Cloudflare gravando o corpo das requisições ou o cabeçalho `X-Pair-Secret`.
- Aceitar IP vindo de cabeçalho que o cliente controla.
- Quebrar `npm run pair` (dev local) ou qualquer um dos 512 testes atuais.
- Estourar o plano grátis por descuido (ex.: duas chamadas ao Durable Object por requisição sem necessidade).

---

## Desenho técnico

### 1. Separar o núcleo do transporte (`server/pair/pair-core.mjs`)
Hoje a lógica e o `node:http` estão juntos em `createPairHandler`. Mova a lógica para um núcleo que fala
**Request/Response da Web** (existem no Node 22 e no Workers), sem `node:http`, `node:fs` nem `node:crypto`:

```js
// pair-core.mjs — roda igual no Node e no Workers
export function createPairCore({ now = Date.now, ttlMs, deliveryTtlMs, maxSessions, limits } = {}) {
  // mesmo Map de sessões, mesmo limitador, mesmas regras de hoje
  return { handleApi /* (request: Request, ip: string) => Promise<Response> */, sweep }
}
```
- Aleatoriedade e comparação: use `crypto.getRandomValues` (Web Crypto, existe nos dois) no lugar de
  `randomInt`/`randomBytes`; comparação em tempo constante feita à mão (XOR acumulado em laço de tamanho fixo).
  Sorteio do código **sem viés de módulo** (rejeite bytes ≥ 248 para o alfabeto de 31 letras).
- Leitura do corpo com limite de 4096 bytes: leia `request.body` em pedaços e pare no limite (não use
  `request.json()` direto, que lê tudo).
- `server/pair/pair-server.mjs` vira só o **adaptador Node**: converte `req/res` ↔ `Request/Response`, serve
  `public/` do disco, `PAIR_TRUST_PROXY`, `startPairServer`, `npm run pair`. Os testes atuais
  (`tests/pairServer.test.js`, `tests/pairingFlow.test.js`) devem passar **sem mudança** por esse adaptador.

### 2. Worker + Durable Object (`server/pair/worker.mjs`)
- `export default { fetch(request, env) }`:
  - `/v1/*` → encaminha para o Durable Object hub: `env.PAIR.get(env.PAIR.idFromName('hub')).fetch(request)`,
    passando o IP de `request.headers.get('CF-Connecting-IP')` (num cabeçalho interno que o hub lê; o cliente não
    pode injetar esse cabeçalho, então **apague** qualquer valor recebido de fora antes de definir o seu).
  - `/healthz` → `ok` direto no Worker (sem gastar requisição do Durable Object).
  - `/`, `/<código>`, `/app.js`, `/pair-lib.js`, `/app.css` → `env.ASSETS.fetch(...)` (arquivos de `public/`) e
    acrescente os cabeçalhos de segurança (CSP só no HTML). Outras rotas → 404.
- `export class PairHub` (Durable Object): guarda um `createPairCore()` em memória e responde `handleApi`.
- 🔎 Confira na doc atual: Durable Objects no plano Free só aceitam a classe **SQLite** (migração com
  `new_sqlite_classes`, mesmo sem usar o SQLite); como ligar **static assets** com o Worker rodando antes dos arquivos
  (`run_worker_first`); e o nome atual do arquivo `wrangler.jsonc`/`wrangler.toml`.

### 3. Configuração (`server/pair/wrangler.jsonc`)
Algo como (🔎 valide os nomes dos campos na doc):
```jsonc
{
  "name": "pulse-pair",
  "main": "worker.mjs",
  "compatibility_date": "<data de hoje>",
  "assets": { "directory": "./public", "binding": "ASSETS", "run_worker_first": true },
  "durable_objects": { "bindings": [{ "name": "PAIR", "class_name": "PairHub" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["PairHub"] }],
  "observability": { "enabled": false }
}
```
- `wrangler` como devDependency **com versão fixa**; scripts `pair:dev` (`wrangler dev --port 8788`, porque a 8787 já é
  do `npm run mock`) e `pair:deploy`. Nenhum id de conta, token ou domínio no repositório.

### 4. Testes (TDD)
- `tests/pairCore.test.js`: o núcleo chamado direto com `new Request(...)` (Node 22), sem servidor. Cubra pelo menos
  o fluxo, a leitura única, os limites, o `413` por corpo grande lido em pedaços e o sorteio sem viés.
- `tests/pairWorker.test.js`: o `fetch` do Worker com `env` falso (`PAIR` que chama um `PairHub` real em memória e
  `ASSETS` que lê de `public/`). Cubra: IP vem só do `CF-Connecting-IP` e um cabeçalho interno falso vindo do
  cliente é ignorado; `/healthz` não chama o hub; CSP no HTML; 404 nas outras rotas; `HEAD`.
- `tests/pairDeploy.test.js`: troque as guardas do Docker/Caddy por guardas do `wrangler.jsonc` (observabilidade
  desligada, migração SQLite, assets em `public/`, nenhum `account_id`/token/domínio fixo).
- Se quiser testar dentro do runtime real, `@cloudflare/vitest-pool-workers` existe (🔎), mas exige projeto separado no
  Vitest; é opcional. O mínimo é a fumaça manual da seção Verificação.

### 5. CI (`.github/workflows/build-apk.yml`)
- Troque o job `pair-server` (Docker) por um job que rode `npx wrangler deploy --dry-run` em `server/pair` (só monta,
  não publica, não precisa de token) 🔎.
- A variável `PULSE_PAIR_BASE_URL` → `VITE_PAIR_BASE_URL` no build do app **continua como está**.

### 6. Textos
- `PRIVACY.md`: o serviço roda no Cloudflare, que processa as requisições (vê o IP) conforme a política dele; os
  logs do Worker ficam desligados. Atualize a seção "Adicionar lista pelo celular" e o campo "[prazo do provedor]".
- `server/pair/README.md`: trocar "Publicar" (Docker/Caddy) pelo passo a passo do Cloudflare abaixo.
- `README.md`, `docs/lojas/PUBLICACAO.md` (seção 7) e a RFC-016 (status): apontar para esta RFC.

---

## Passo a passo do dono (a IA não pode criar contas nem pagar; ela guia)
1. Criar conta grátis em cloudflare.com.
2. "Adicionar site" → `pulseplayer.com.br` → plano **Free**. O Cloudflare mostra dois servidores de nome (NS).
3. No painel do Registro.br (domínio `pulseplayer.com.br` → **DNS** → "Alterar servidores DNS"), trocar
   `a.auto.dns.br` / `b.auto.dns.br` pelos dois NS do Cloudflare. Propaga em minutos a algumas horas.
4. No PC: `npx wrangler login` (abre o navegador para autorizar) e `npm run pair:deploy`.
5. No painel do Worker `pulse-pair` → Settings → Domains & Routes → **Custom Domain** `par.pulseplayer.com.br`
   (o Cloudflare cria o DNS e o certificado sozinho).
6. No GitHub → Settings → Variables: `PULSE_PAIR_BASE_URL` = `https://par.pulseplayer.com.br`.
7. Preencher em `PRIVACY.md` o endereço do serviço.

## Limites do plano grátis (🔎 confira na doc atual)
- Workers: ~100 mil requisições/dia. Durable Objects: ~100 mil requisições/dia e uma cota de "duração" diária.
- Cada chamada à API gasta 1 requisição do Worker **e** 1 do Durable Object; `/healthz` e arquivos estáticos não
  devem tocar o Durable Object.
- Um pareamento típico gasta 20 a 40 requisições (a TV consulta a cada 2 s) → cabem uns 2.500 por dia.
- Estourou: as chamadas falham até 00:00 UTC; a TV mostra o erro e o login manual continua. Plano pago: a partir de
  US$ 5/mês, sem mudar código.
- Risco: o hub fica "acordado" enquanto houver consultas; com pareamentos o dia todo, a cota de duração pode chegar
  perto do limite. Meça com o painel do Cloudflare nas primeiras semanas.

## Verificação (antes de dizer que terminou)
- `npm run lint`, `npm test` (os 512 atuais + os novos), `npm run build` verdes.
- `npm run pair:dev` + `npm run dev` com `VITE_PAIR_BASE_URL=http://localhost:8788`: login mostra o QR; a página
  `http://localhost:8788/<código>` envia; a TV mostra "Adicionar esta lista?".
- Fumaça por `curl` contra o `wrangler dev` (e depois contra o domínio real): `/healthz` = ok; `HEAD /` tem a CSP;
  criar sessão → consultar (204) → enviar (204) → consultar (200 com o `box`) → consultar de novo (404); 11 sessões
  seguidas do mesmo IP → a 11ª dá 429, mesmo mandando `X-Forwarded-For` diferente a cada uma.
- Depois do deploy real: `https://par.pulseplayer.com.br/healthz` responde `ok` com certificado válido.

## Critério de pronto
O dono consegue: abrir o app (build com `PULSE_PAIR_BASE_URL`), escanear o QR com o celular, colar um link e ver a
lista entrar na TV, com o serviço rodando no Cloudflare sem pagar nada e sem nenhum servidor para manter.
