# RFC-021 — Site: subir lista para a TV, assinar o aparelho e comprar créditos

Status: **proposta (decisões do dono registradas em 2026-10-27; aguarda aprovação deste texto)** · Data: 2026-10-27 ·
Depende de: RFC-016/017 (cifra do pareamento), RFC-018 (licença), RFC-019 (revendedores), **RFC-020 (Pix)** ·
Ordem: 019 → 020 → **021** → 022 (a parte "subir lista" não depende da 020 e pode vir antes)

> **Como usar:** cole este arquivo inteiro como primeira mensagem num chat novo aberto na pasta `reprodutor_de_video`.

---

## Prompt para a IA

Você vai construir o **site público** do Pulse Player, servido pelo mesmo Worker do serviço de licença
(`server/license`). O site é **principalmente para subir listas**: a pessoa digita o código que aparece na TV e a lista
dela, e a lista chega **cifrada** na TV. Além disso, há duas abas de venda: **assinar o aparelho (R$ 25/ano, Pix)** e
**comprar 10 créditos ou mais (Pix) e receber o painel de ativação**. **Nada de parceria/donos de servidor no site.**

Antes de qualquer código:
1. Leia `CLAUDE.md`, o `CLAUDE.md` global, **este arquivo**, as RFC-016 (formato do `box`), 018, 019 e 020.
2. Leia `src/services/pairingCrypto.js` (TV: `createPairingKeys`, `open`), `server/pair/public/pair-lib.js` (celular:
   `seal`) e `src/composables/usePairing.js` + `src/components/PairPanel.vue` (confirmação "Adicionar esta lista?").
3. TDD; lint, `npx vitest run --maxWorkers=2` e build verdes. Sem commit/push/deploy sem pedido.

---

## Por quê
Nos apps de IPTV o caminho comum é: a TV mostra um código, a pessoa abre o site no celular ou PC, digita o código e a
lista. Digitar no controle remoto é o pior momento do app (RFC-016). O pareamento por QR já existe, mas exige a TV na
tela de login esperando; o site funciona a qualquer hora, com a TV desligada, e é também a vitrine das vendas.

## Regras (dono)
- **R1.** O site é majoritariamente **subir lista**. As abas de venda são só duas: "Assinar meu aparelho — R$ 25/ano"
  (digita o código/"MAC", paga por Pix ali mesmo e ativa) e "Comprar créditos — a partir de 10" (tabela RFC-019 R1;
  paga por Pix e recebe o painel de ativação).
- **R2.** A parceria com donos de servidor é **por fora**: nenhuma menção, preço ou formulário no site.
- **R3.** A lista vai **cifrada direto para a TV** (o servidor guarda só texto cifrado até a TV buscar). A promessa de
  privacidade (RFC-016) continua verdadeira.
- **R4 (lojas).** O site é de um reprodutor neutro: não fala de canais, filmes, séries, esportes nem promete conteúdo;
  sem marcas de terceiros. Texto obrigatório no rodapé: "Este é um reprodutor de mídia genérico. Nenhum conteúdo é
  fornecido, endossado ou vendido."

## Objetivos
1. **Subir lista** (página inicial `/`): código do aparelho + tipo (Xtream: servidor, usuário, senha; ou M3U: link) +
   apelido → cifrado no navegador → caixa de entrada da TV → a TV pergunta "Adicionar esta lista?".
2. **Assinar** (`/assinar`): código → confere o aparelho → Pix R$ 25 (RFC-020) → "Aparelho ativado até dd/mm/aaaa".
3. **Comprar créditos** (`/creditos`): quantidade (≥ 10) com o total calculado pela tabela, nome, WhatsApp, e-mail →
   Pix → mostra a chave e o link do painel (`/revenda/`, RFC-022) **uma vez**, com aviso para guardar.
4. `/a/:code` (QR da tela de ativação do app) → `/assinar?codigo=...` com o código preenchido.
5. Atendimento: botão de WhatsApp `https://wa.me/5516992791692` (variável `LICENSE_CONTACT_URL`, nunca fixo no código).

## Não objetivos
Conta de usuário no site, editar/apagar lista depois de enviada (a TV é dona dela), histórico de listas no servidor,
parceria, blog, multi-idioma.

## Anti-objetivos
- Lista (usuário, senha, link) chegar ao servidor em texto aberto, ou ficar guardada depois que a TV leu.
- Alguém conseguir pôr uma lista na TV de outra pessoa **sem** a TV confirmar.
- Página que dependa de script externo (CDN, analytics, fontes de terceiros) — a CSP do pareamento continua.

## Desenho técnico

### 1. Caixa de entrada cifrada da TV
- **TV (app):** um par de chaves ECDH P-256 **persistente** do aparelho (não extraível, guardado como `CryptoKey` no
  IndexedDB, como `src/services/crypto.js` já faz). A chave pública vai junto no `/v1/access` (`pub`), e o serviço
  guarda em `devices.inbox_pub`. Reaproveitar `createPairingKeys` com uma variante persistente
  (`loadOrCreateInboxKeys()`); o `open(box, aad)` usa como dado autenticado o **código do aparelho**.
- **Site:** `GET /v1/inbox/:code/key` → `{pub}` (404 se o aparelho não existe ou ainda não publicou chave; mensagem:
  "Abra o Pulse Player na TV uma vez e tente de novo"). O navegador usa `seal(pub, code, lista)` de `pair-lib.js` e
  manda `POST /v1/inbox/:code {box}`.
- **Serviço:** tabela `inbox(id, device_key, box TEXT ≤ 3600, created_at, expires_at)`; no máximo **3** caixas
  pendentes por aparelho (a mais antiga sai); validade **7 dias**; limite por IP como o pareamento; nada além do `box`.
- **TV:** ao abrir o app, ao voltar do segundo plano e a cada 60 s **só** nas telas de login e Gerenciar listas,
  `POST /v1/inbox/pull {deviceKey}` → caixas → `open` → mostra "Adicionar esta lista?" (mesma tela do pareamento) →
  confirmou ou descartou → `POST /v1/inbox/ack {deviceKey, ids}` apaga do servidor. Caixa que não abre (outra chave)
  é descartada em silêncio.
- **Privacidade:** atualizar `PRIVACY.md`, aviso inicial (FTUE) e guia das lojas: a lista passa cifrada pelo serviço por
  até 7 dias e é apagada quando a TV lê.

### 2. Páginas (servidas pelo Worker, HTML estático + um `site.js`, sem framework)
- `/` Subir lista (padrão), `/assinar`, `/creditos`, `/obrigado/:orderId` (status do Pix, RFC-020).
- Abas no topo: **Enviar lista** · **Assinar meu aparelho** · **Comprar créditos**. Rodapé: aviso legal (R4),
  privacidade, WhatsApp.
- Pix: mostrar o QR (`qrCodeBase64` → `<img src="data:image/png;base64,...">`, CSP com `img-src 'self' data:`) e o
  "copia e cola" com botão Copiar; consultar o status a cada 3 s; ao pagar, mostrar o resultado.
- Visual da marca (RFC-015): fundo grafite `#0B0F0C`, verde-limão `#B8F000`, texto sobre limão em grafite; símbolo do
  `logo/kit`. Pensado primeiro para **celular** (quem digita a lista está no celular).
- Formulário de lista igual ao da página do pareamento (`server/pair/public/index.html`): mesmos campos e validação
  (`extractUrl`, `normalizeCode` de `pair-lib.js`), para não ter duas regras.

### 3. App
- `ActivationRequired.vue`: o QR passa a abrir `/a/<código>` (já abre) → redireciona para `/assinar`.
- Login e Gerenciar listas: mostrar "Ou envie a lista pelo site: **<endereço>** com o código **XXXXXXXX**".
- Código do aparelho: o mesmo do serviço de licença (8 caracteres), exibido como "Código do aparelho (MAC)".

## Guardrails
- G1–G18 valem. **G19** Só texto cifrado no servidor; teste que tenta mandar lista em texto e é recusado (formato do
  `box` validado como no pareamento). **G20** A TV sempre confirma antes de adicionar. **G21** Nenhuma palavra de
  conteúdo/parceria no site (teste de guarda com lista de termos proibidos, como os testes de loja existentes).

## Plano
1. Chave persistente da TV + `pub` no `/v1/access` + tabela `inbox` + rotas (testes de cifra ponta a ponta com o
   `seal` do `pair-lib.js` e o `open` da TV).
2. App: buscar caixas, confirmar, `ack` (testes com TV simulada; regras de foco e Chromium 63).
3. Página "Enviar lista".
4. Páginas "Assinar" e "Comprar créditos" sobre a RFC-020.
5. Textos legais e lojas.

## Riscos
- Spam de listas para códigos alheios: a TV confirma, há limite de 3 caixas e por IP.
- TV antiga sem `crypto.subtle` (contexto inseguro): sem caixa de entrada; o site avisa "use o QR na TV".
- Perder a chave da TV (limpar dados do app): caixas antigas não abrem; a TV publica chave nova no próximo `access`.
