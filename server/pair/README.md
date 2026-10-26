# Servidor de pareamento (RFC-016 / RFC-017)

Recebe, por alguns minutos, a lista que o usuário cola no celular e entrega à TV **já cifrada**. O servidor nunca
consegue abrir o conteúdo e nada é gravado em disco nem em log. Protocolo, formato do `box` e limites:
[`docs/rfc/RFC-016-pareamento-pelo-celular.md`](../../docs/rfc/RFC-016-pareamento-pelo-celular.md) e
[`docs/rfc/RFC-017-pareamento-cloudflare-workers.md`](../../docs/rfc/RFC-017-pareamento-cloudflare-workers.md).

## Rodar localmente

```bash
# Opção 1: servidor Node local (adaptador node:http)
npm run pair

# Opção 2: simulação do Cloudflare Worker com Wrangler
npm run pair:dev
```

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `PAIR_PORT` | `8788` | Porta do adaptador Node |
| `PAIR_HOST` | `0.0.0.0` | Interface do adaptador Node |
| `PAIR_TRUST_PROXY` | vazio | `1` só se houver um proxy na frente no Node local. No Worker, o IP vem sempre de `CF-Connecting-IP`. |

Abra `http://localhost:8788/` (ou `/K7M2QP`, com o código da TV) para ver a página do celular.

## Arquivos

- `pair-core.mjs` — Núcleo puro em Web Standards (Request/Response, Web Crypto, Map de sessões e limitador).
- `worker.mjs` — Cloudflare Worker + Durable Object (`PairHub`) para hospedagem no plano gratuito.
- `pair-server.mjs` — Adaptador Node.js para rodar em desenvolvimento local (`npm run pair`).
- `wrangler.jsonc` — Configuração do Cloudflare Workers, Static Assets e Durable Objects.
- `public/` — Página do celular: `index.html`, `app.css`, `pair-lib.js` (extração, normalização, cifra) e `app.js`.
- Testes: `tests/pairCore.test.js`, `tests/pairWorker.test.js`, `tests/pairServer.test.js`, `tests/pairDeploy.test.js`, `tests/pairLib.test.js`, `tests/pairPage.test.js`.

## Publicar (Cloudflare Workers — Grátis)

O serviço roda no **Cloudflare Workers com Durable Objects** no plano Free, sem custo de VM e sem servidor para manter.

1. **Conta no Cloudflare:**
   - Crie uma conta gratuita em [cloudflare.com](https://cloudflare.com).
   - "Adicionar site" → `pulseplayer.com.br` → selecione o plano **Free**.
   - O Cloudflare exibirá dois servidores de nome (DNS nameservers, ex.: `xxx.ns.cloudflare.com`).

2. **Apontar o domínio (Registro.br):**
   - Acesse o painel do [Registro.br](https://registro.br) para o domínio `pulseplayer.com.br`.
   - Em **DNS** → "Alterar servidores DNS", substitua os servidores padrão pelos servidores informados pelo Cloudflare.
   - Aguarde a propagação (normalmente de minutos a algumas horas).

3. **Autenticação e Deploy:**
   - No terminal do seu computador:
     ```bash
     npx wrangler login       # abre o navegador para autorizar
     npm run pair:deploy      # publica o Worker e os arquivos estáticos
     ```

4. **Configurar o subdomínio personalizado:**
   - No painel da Cloudflare → **Workers & Pages** → selecione o worker `pulse-pair`.
   - Vá em **Settings** → **Domains & Routes** → **Add** → **Custom Domain**.
   - Digite `par.pulseplayer.com.br` e confirme. O Cloudflare gerencia o apontamento DNS e o certificado SSL/TLS automaticamente.

5. **Configurar a variável no GitHub:**
   - No GitHub do projeto → **Settings** → **Secrets and variables** → **Actions** → aba **Variables**.
   - Crie ou edite a variável `PULSE_PAIR_BASE_URL` com o valor:
     `https://par.pulseplayer.com.br` (sem barra final).
   - O build do CI injetará esse valor em `VITE_PAIR_BASE_URL`.

6. **Validação:**
   - Acesse `https://par.pulseplayer.com.br/healthz` no navegador ou curl; a resposta deve ser `ok`.
   - Preencha em [`PRIVACY.md`](../../PRIVACY.md) o endereço do serviço.

Cuidados que a configuração já cobre:
- **HTTPS obrigatório**: garantido pelo Cloudflare Edge; WebCrypto liberado para cifrar no celular.
- **Privacidade total**: `observability.enabled: false` no `wrangler.jsonc`. Nenhum log de corpo ou segredo (`X-Pair-Secret`).
- **IP confiável**: `CF-Connecting-IP` injetado pelo Cloudflare é usado para os limites, sem risco de spoofing.
- **Zero custo de banco**: o Durable Object usa classe SQLite para habilitar o plano Free, mas mantém os dados apenas em memória volátil de 10 minutos.

## Testar com um celular de verdade

Em `http://192.168.x.x:8788` o celular **não** libera o WebCrypto (endereço não seguro), e a página avisa isso. Use um
túnel HTTPS para a porta 8788 (por exemplo `cloudflared tunnel --url http://localhost:8788` ou o Worker publicado) e abra o endereço gerado.
