# RFC-016 — Adicionar lista pelo celular (QR code + código curto)

Status: **aprovada (D1, D3–D5; decisão D2 da VM substituída pela RFC-017: Cloudflare Workers grátis; layout A, duas colunas, em `docs/design-2.0/pareamento.html`)** ·
Data: 2026-10-25 · Fases 1 a 4 concluídas; fase 5 migrada para Cloudflare Workers + Durable Objects pela
[`RFC-017`](RFC-017-pareamento-cloudflare-workers.md). Deploy manual pelo dono com `npm run pair:deploy` e variável
`PULSE_PAIR_BASE_URL` no GitHub.

> **Nota sobre o layout A:** no mockup o QR tinha ~170 px em 720p. Na implementação o card do login ficou mais largo
> (`w-[84rem]`) e o QR tem 20rem (320 px em 1080p); no gerenciador de listas (coluna estreita) ele tem 11rem. Se na TV
> real o do gerenciador não escanear de longe, aumentar o QR ou abrir o painel em tela cheia.
>
> **Fase 3, o que mudou fora do previsto:** a fileira de atalhos do login (`http://`, `.com`…) passou de `gap-2` para
> margens, porque na coluna mais estreita ela quebra de linha e o fallback de `gap` (TVs com Chromium < 84) não cobre
> `flex-wrap` (`__pulse.audit()` acusava 15 elementos diferentes; agora 0).

## Por quê
Hoje o usuário digita no controle remoto a URL inteira da lista (`Login.vue:99-115`, `ListManagerModal.vue:323-340`).
É lento, errado com facilidade e é o pior momento do app. O usuário recebe essa URL por **WhatsApp, e-mail ou painel
do provedor**, ou seja, ela já está **no celular**, onde dá para copiar e colar. A ideia do dono (um domínio curto
como `tv.top`) resolve metade: o link curto só ajuda se alguém criar o link curto, e digitá-lo no controle continua
sendo digitar. Esta RFC troca *onde* a digitação acontece: o celular cola, a TV recebe.

Sobre as lojas: não encontrei regra oficial da Samsung nem da LG que proíba pedir URL ou código; os players de playlist
mais comuns nessas TVs fazem exatamente isso. A exigência real das lojas é outra (conteúdo, privacidade, conta de
teste para o revisor). Antes de submeter, confirme nas guidelines oficiais (Seller Office / Seller Lounge): não
consegui abri-las.

## Como vai funcionar (visão do usuário)
1. Na TV, o login mostra um **QR code** e um **código de 6 letras** (ex.: `K7M2QP`) com o endereço curto
   (`<dominio>/K7M2QP`).
2. No celular ele escaneia o QR (ou abre o endereço curto e digita as 6 letras). Abre uma página simples.
3. Cola o link que recebeu no WhatsApp/e-mail (ou usuário e senha, se for servidor), toca em **Enviar**.
4. A TV mostra "Recebido de **servidor.com** — Adicionar?", ele aperta OK, e a lista carrega. Tudo em menos de 20 s.

O teclado do controle continua existindo como alternativa ("Digitar manualmente"). Nada do fluxo atual é removido.

## Objetivos
- Adicionar uma lista **sem digitar nada no controle remoto**.
- Reaproveitar o fluxo de login que já existe: o resultado do celular entra por `auth.login({ dns, username, password, label })`
  (`authStore.js:156`), o mesmo ponto que `Login.vue:42` e `ListManagerModal.vue:116` já usam. **Zero mudança** em `authStore`
  e `xtreamApi`.
- O servidor de pareamento **nunca guarda a lista em texto legível** e esquece tudo em minutos.
- Funcionar em Tizen, webOS, Android TV e navegador, no piso Chromium 63.

## Não objetivos (v1)
- Conta de usuário, login ou "minhas listas na nuvem". O servidor não guarda nada além de uma sessão de minutos.
- Sincronizar listas entre aparelhos.
- Integração direta com painéis de provedores (botão "abrir no Pulse Player" no painel). Fica para uma v2.
- O celular saber se a TV conseguiu carregar a lista (confirmação de volta). v1: a página só diz "Enviado, olhe a TV".
- App de celular dedicado. A página web basta.

## Anti-objetivos (seria falha mesmo funcionando)
- O servidor conseguir ler URL, usuário ou senha da lista de forma persistente, ou aparecer isso em log.
- Um desconhecido que adivinhe o código **empurrar uma lista para a TV de outra pessoa** sem ela perceber.
- Quebrar o texto "não coletamos seus dados" **sem atualizar** aviso legal, política de privacidade e formulários das lojas.
- Trazer QR/imagem de fora, foco invisível, ou quebrar o Chromium 63 (regras do `CLAUDE.md`).
- O app ficar dependente do servidor: se ele cair, o login manual precisa continuar funcionando.

## Decisões que preciso do dono (eu recomendo, você decide)
| # | Tema | Recomendação | Alternativa |
|---|---|---|---|
| D1 | **Domínio** do pareamento | Um domínio curto e confiável, definido em variável `VITE_PAIR_BASE_URL` (nunca fixo no código). Verifique disponibilidade e preço: `.top` costuma ter má reputação em filtros de spam e bloqueios de rede, vale conferir antes de apostar a marca nele. | Subdomínio de um domínio que você já tenha |
| D2 | **Onde roda o servidor** | Um serviço Node pequeno (`server/pair`, sem dependências) em uma VM/PaaS barato, 1 instância, memória apenas (reiniciar só faz o usuário gerar outro código) | Cloudflare Workers + KV (sem servidor para cuidar, mas outro runtime a manter) |
| D3 | **Cifra ponta a ponta** | Sim na v1: a TV gera um par de chaves, o celular cifra, o servidor só carrega texto cifrado | Só HTTPS + apagar ao ler (mais simples, mas o servidor vê a senha por alguns segundos) |
| D4 | **Idiomas da página do celular** | PT-BR e EN | Só PT-BR |
| D5 | **Sem WebCrypto na TV** | Esconder a opção "pelo celular" (o `crypto.js:24` já detecta) e manter o login manual | Enviar sem cifra (não recomendo) |

## Desenho técnico

### 1. Protocolo (3 chamadas, JSON, só HTTPS)
```
TV  → POST /v1/sessions            { pub }                     → { code, secret, expiresIn }
Cel → GET  /v1/sessions/:code                                  → { pub }               (página precisa da chave pública)
Cel → POST /v1/sessions/:code/payload { box }                  → 204
TV  → GET  /v1/sessions/:code/payload   (header X-Pair-Secret) → 204 (ainda não) | 200 { box } | 404/410 (expirou)
```
- `code`: 6 caracteres de `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sem `0/O/1/I/L`): ≈ 887 milhões de combinações, mais
  que suficiente com validade de 10 min e limite de tentativas.
- `secret`: 128 bits aleatórios que só a TV conhece; é o que autoriza a TV a ler o resultado. Quem só sabe o código
  não consegue ler nem a resposta cifrada.
- `pub`: chave pública ECDH P-256 da TV (65 bytes, base64url). A chave privada **fica só em memória da TV**.
- `box`: JSON `{ dns, username, password, label }` cifrado no celular com AES-GCM, chave derivada de ECDH(chave
  efêmera do celular, `pub` da TV), mais a chave efêmera pública do celular. A TV decifra com a privada.
- Leitura é **única**: o `GET` com resultado apaga a sessão. Validade da sessão: 10 min; depois de recebida, some em 60 s.
- Respostas de erro (decisão da Fase 1): `404` para código desconhecido, expirado ou já lido (a TV conhece o próprio
  prazo, então não precisa distinguir); `403` para `secret` errado; `409` para segundo envio; `413` corpo grande;
  `429` com `Retry-After` no limite; `503` quando há sessões demais.
- O servidor limita: corpo de até 4 KB, 1 envio por sessão (o segundo recebe `409`) e, **por IP e por minuto**,
  10 sessões novas, 120 consultas da TV (a TV consulta a cada 2 s = 30/min, e vários aparelhos podem dividir um IP),
  30 chamadas do celular e 20 códigos errados (contra quem tenta adivinhar). CORS `Access-Control-Allow-Origin: *`
  (sem cookies) só nas rotas da API, e **não registra corpo nem `secret` em log**.
- **Formato do `box`** (contrato com a Fase 2, a TV): `base64url( chavePúblicaEfêmeraDoCelular[65 bytes, ponto P-256
  não comprimido] ‖ iv[12] ‖ AES-GCM(texto) )`. A chave AES-256 vem de `ECDH(efêmera do celular, pub da TV)` (WebCrypto
  `deriveKey`, sem HKDF: HKDF não existe no Chromium 63). O código de 6 letras entra como dado autenticado adicional
  (`additionalData`), então um `box` não vale em outra sessão. O texto é o JSON `{ dns, username, password, label }`
  (até 2000 caracteres). O servidor trata `pub` e `box` como texto opaco `base64url` (`pub` ≤ 128, `box` ≤ 3600
  caracteres) e nunca tenta abri-los. O corpo vai em POST, **nunca na URL**, então URLs com token não caem
  em log de acesso.
- Cuidado já mapeado: `MainActivity.java:122` intercepta pelo nativo qualquer URL que contenha `player_api.php`,
  `get.php`, `.m3u` ou `.m3u8`. As rotas acima não contêm nenhum desses trechos e a lista nunca vai na URL, então
  o pareamento passa pelo WebView normal (por isso o CORS do servidor é obrigatório).

Por que a TV mostra confirmação (anti-sequestro): se um estranho acertar o código antes do dono, ele poderia empurrar
uma lista falsa. Com cifra ponta a ponta o servidor não consegue impedir isso (não vê o conteúdo), então a proteção
é na TV: a tela mostra o **host** recebido e só importa depois do OK do usuário. O código expira em 10 min e a TV
descarta qualquer coisa recebida depois de aceitar uma.

### 2. Cliente (app), arquivos novos
| Arquivo | Papel |
|---|---|
| `src/services/pairingCrypto.js` | Gera o par ECDH, deriva a chave e decifra o `box` (WebCrypto, mesmo estilo de `crypto.js`). |
| `src/services/pairingApi.js` | As 2 chamadas da TV (criar sessão e consultar resultado). Erros viram mensagem em português; sem `VITE_PAIR_BASE_URL` o recurso não existe. |
| `src/composables/usePairing.js` | Máquina de estados: `idle → waiting → received → connecting → done`, mais `expired` e `error`. Consulta a cada 2 s com `setTimeout` encadeado (sem `setInterval`), para ao desmontar. |
| `src/components/PairPanel.vue` | QR (SVG inline), código grande, endereço curto, contagem de validade, botões **Novo código** (`pair-refresh`) e **Digitar manualmente** (`pair-manual`), e a confirmação "Recebido de host". |
| `src/utils/qrSvg.js` | Transforma a matriz do QR em um único `<path>` SVG. |
| `server/pair/` | Servidor + a página do celular (um HTML estático, sem framework). |

- **QR:** o projeto não tem biblioteca de QR (`node_modules` sem nenhuma). Gerar QR à mão é arriscado; recomendo uma
  dependência única, pequena e sem dependências próprias (`qrcode-generator`, MIT), conferida com
  `npm audit --omit=dev` (o CI já roda). O QR é desenhado **preto sobre bloco branco com margem de 4 módulos**
  (limão sobre grafite não escaneia bem). Isso não fere a regra de marca: o limão continua fora de fundo claro.
- **Integração:**
  - `Login.vue`: bloco "Conectar pelo celular" acima dos campos; "Digitar manualmente" mostra o formulário atual.
  - `ListManagerModal.vue` (coluna 2, linha 299): botão "Enviar pelo celular" que troca a coluna pelo `PairPanel`.
  - O painel chama `auth.login(...)` quando o usuário confirma; erro de login aparece no próprio painel com
    `auth.error` e `auth.errorDetail` (mesmo padrão de `Login.vue:170-183`).
  - Se `VITE_PAIR_BASE_URL` estiver vazio, ou `isCryptoSupported()` for falso, o bloco não aparece (mesmo padrão
    do botão de demonstração, `Login.vue:21` e `.env.example`).
- **TV (regras do CLAUDE.md):** todo interativo é `button` com `id` único; o QR e o código não são focáveis; foco
  inicial em `pair-refresh`; Voltar fecha o painel via `registerBackHandler` (`spatialNavigation.js:275`) e devolve o
  foco ao botão que abriu; margem segura `px-24`/`py-14`; texto mínimo `text-tv-xs`; sem `gap` escrito à mão, sem
  `aspect-ratio`, sem `backdrop-filter`, sem `import()` novo. Ao ir para segundo plano (`onAppBackground`,
  `platform.js:97`) o app para de consultar; ao voltar cria código novo se o anterior expirou.
- **Layout:** ainda **não há mockup**. Antes de codar a UI eu monto uma tela em `docs/design-2.0/` no mesmo estilo
  dos mockups aprovados e você escolhe. Esboço:
```
┌──────────────── Conectar ao servidor ────────────────┐
│  ┌────────┐   Escaneie com o celular                 │
│  │  QR    │   ou abra  tv.exemplo/K7M2QP             │
│  │        │            K 7 M 2 Q P     (válido 9:42) │
│  └────────┘   [ Novo código ]  [ Digitar manualmente ]│
└──────────────────────────────────────────────────────┘
```

### 3. Servidor `server/pair`
- Node 22, só `node:http` e `node:crypto`, um `Map` com expiração; roda igual no Windows e no Linux
  (`npm run pair`, porta e domínio por variáveis de ambiente, nada fixo).
- Serve a página do celular (`GET /` e `GET /:code`) com CSP restritiva, sem refletir nada do usuário na página.
- A página extrai o **primeiro `http(s)://…`** de qualquer texto colado (mensagem de WhatsApp costuma trazer texto em
  volta), mostra campos opcionais de usuário/senha/apelido, cifra no navegador e envia. A validação real
  (M3U ou Xtream, credenciais) continua na TV, por `resolveShortInput`/`authenticate` (`xtreamApi.js:537`, `:429`).
- Para teste local: `npm run pair` junto com `npm run mock`, igual ao fluxo atual (`README.md`, tabela de comandos).

### 4. Textos legais e lojas (obrigatório junto com o código)
O app hoje promete "não coletamos nem enviamos seus dados" (`FTUE.vue:27`, `PRIVACY.md:25`). Com o pareamento, a
lista passa **cifrada** por um servidor do desenvolvedor por alguns minutos (e o IP aparece no limitador). Então:
- `FTUE.vue:27` e `PRIVACY.md` (tabela de dados, "O que o aplicativo não faz" e "Conexões de rede") passam a
  descrever o pareamento como **opcional**, cifrado ponta a ponta, apagado em minutos.
- Subir `FTUE_VERSION` de 2 para 3 (`storage.js:20`) para pedir novo aceite. Custo baixo: o app ainda não está nas
  lojas (RFC-015).
- `docs/lojas/PUBLICACAO.md`: declarar o domínio nas respostas da Samsung/LG e no formulário de segurança de dados do
  Google Play. O caminho do revisor não muda (botão de demonstração, seção 3).
- Rodar `tests/ftueConsent.test.js` e `tests/brandGuard.test.js` depois de mexer nos textos.

## Plano de implementação (ordem)
| Fase | Entrega | Como validar |
|---|---|---|
| 0 | Decisões D1–D5 e mockup da tela | Você aprova |
| 1 | `server/pair` + página do celular | Testes do servidor (veja abaixo) e teste manual com celular na mesma rede |
| 2 | `pairingCrypto`, `pairingApi`, `usePairing` | Testes unitários (TDD, é lógica de negócio) |
| 3 | `PairPanel` + `qrSvg` + integração em Login e ListManagerModal | Testes de componente + `__pulse.audit()` com `differ = 0` e `__pulse.duplicateIds()` = `[]` |
| 4 | Textos legais, `FTUE_VERSION`, README, PUBLICACAO | `npm test` |
| 5 | Deploy do servidor, HTTPS, `VITE_PAIR_BASE_URL` no CI | Fluxo completo com TV real |

## Testes
- `tests/pairingCrypto.test.js`: ida e volta decifra; chave errada falha; `box` adulterado falha.
- `tests/pairingApi.test.js`: sessão criada; pendente (204), recebido (200), expirado (404/410), rede caída.
- `tests/usePairing.test.js` (timers falsos): estados na ordem certa, expira em 10 min, para de consultar ao
  desmontar, não importa nada sem confirmação.
- `tests/pairPanel.test.js`: mostra QR e código, ids únicos, nenhuma imagem externa, some sem `VITE_PAIR_BASE_URL`,
  Voltar fecha e devolve o foco.
- `tests/pairServer.test.js` (ambiente `node`): criar/enviar/ler uma vez, segundo envio recusado, expiração, corpo
  grande, limite por IP, cabeçalhos CORS, `secret` errado.
- Guardas existentes continuam verdes: `noExternalPlaceholders`, `brandGuard`, `tvCompat`, `tvStyles`.

## Verificação (antes de dizer que terminou)
`npm run lint`, `npm test`, `npm run build`, `npm run build:tizen`, `npm run build:webos` verdes; fluxo completo com
`npm run mock` + `npm run pair` + `npm run dev` e um celular real. **Limite honesto:** o README admite que nenhum
pacote foi testado em TV ou emulador; o pareamento só fica de fato validado depois de rodar em Tizen e webOS.

## Riscos
- **Abuso do servidor** (spam de sessões, adivinhar códigos): limites por IP, validade curta, confirmação na TV.
  Se virar problema real, adicionar prova de trabalho simples ou captcha na página do celular.
- **Custo e disponibilidade**: se o servidor cair, só o atalho some; o login manual continua.
- **Reputação do domínio**: ver D1.
- **Marca**: o texto da página e da loja não pode usar "IPTV" nem nomes de terceiros (`PUBLICACAO.md`, seção 2).

## Futuro (fora desta RFC)
Botão "abrir no Pulse Player" vindo do painel do provedor ou da mensagem do WhatsApp (link que já leva o código da
TV), e confirmação de volta para o celular.
