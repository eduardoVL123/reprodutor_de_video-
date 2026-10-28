# RFC-018 — Aparelhos ativos por servidor parceiro e ativação anual

Status: **aprovada (D1–D5 aceitas como recomendadas em 2026-10-27; hospedagem na Cloudflare fica para depois: o
serviço roda local com `node:sqlite`, mesmo SQL do D1)** · Data: 2026-10-27 · Depende de: RFC-016/017 (pareamento,
Cloudflare Workers)

> **Como usar:** cole este arquivo inteiro como primeira mensagem num chat novo (Claude Code ou outra IA de código)
> aberto na pasta `reprodutor_de_video`. Tudo o que a IA precisa saber está aqui ou nos arquivos que ele cita.

---

## Prompt para a IA

Você vai construir a **monetização** do Pulse Player: contar aparelhos ativos por servidor parceiro (para cobrar o dono
do servidor) e vender a ativação anual do aparelho para quem usa lista própria. As regras de negócio abaixo foram
definidas pelo dono numa conversa e **não podem ser reinterpretadas**: na dúvida, pergunte.

Antes de qualquer código:

1. Leia o `CLAUDE.md` do projeto, o `CLAUDE.md` global do usuário (se existir) e **este arquivo inteiro**.
2. Leia `server/pair/` (README, `worker.mjs`, `pair-core.mjs`) e `src/services/pairingApi.js`: o serviço novo segue o
   mesmo padrão (Worker no plano grátis, variável `VITE_*` vazia = recurso desligado).
3. Confirme com o dono as decisões **D1–D5** (seção "Decisões pendentes"). Sem elas, só as fases 1 e 2 podem começar.
4. Confira na documentação **atual** os pontos marcados com 🔎 (planos grátis, APIs de plataforma e regras de loja mudam).
5. TDD: teste primeiro, veja falhar, implemente, veja passar. `npm run lint`, `npx vitest run --maxWorkers=2` e
   `npm run build` verdes antes de dizer que terminou (a máquina tem 7,4 GB de RAM).
6. Não faça commit, push ou deploy sem pedido explícito. Não edite `.env*` sem pedir.

Responda em português do Brasil, cite arquivo e linha e explique a causa antes de corrigir algo.

---

## Por quê

O app é gratuito para o usuário final e precisa se pagar. São **dois jeitos de cobrar**, independentes:

1. **Pós-pago por servidor parceiro.** O dono de um servidor (a URL/DNS da lista) fecha parceria. Os clientes dele usam
   o app de graça; ao fim de cada ciclo de 30 dias, vocês contam quantos aparelhos dele ficaram ativos e cobram
   **1 crédito por aparelho ativo**. Ele usa antes e paga depois.
2. **Ativação anual por aparelho (pré-pago).** Quem usa uma lista **sem parceria**, depois do teste grátis, paga um
   valor fechado (ex.: R$ 10) e aquele aparelho fica liberado por **um ano**, com **qualquer** lista. Aparelho ativado
   nunca gera cobrança para dono de servidor.

Hoje não existe nada disso: o app não fala com nenhum servidor de vocês (fora o pareamento) e a política de
privacidade diz exatamente isso (`PRIVACY.md`).

## Regras de negócio (definidas pelo dono — não alterar)

### R1. Aparelho
- Cada aparelho físico é **um** aparelho. Celular e TV da mesma pessoa são **2**.
- O aparelho é identificado por um **código próprio do app**, não pelo MAC address (Android 10+, Tizen, webOS e
  navegadores não entregam o MAC real a apps). Veja "Identidade do aparelho".

### R2. Teste grátis de 7 dias
- Todo aparelho novo tem **7 dias** de uso livre, com **qualquer** lista (parceira ou não).
- Durante o teste **ninguém paga**: nem o usuário, nem o dono do servidor. Entradas no teste **não contam** como ativo.
- O teste é **um por aparelho**. Desinstalar e instalar de novo **não** dá outro teste.

### R3. Depois do teste
| Situação do aparelho | Lista de parceiro | Lista sem parceria |
|---|---|---|
| Sem ativação anual | **Libera.** Pode contar como ativo do parceiro (R5). | **Bloqueia** e mostra a tela de ativação (R6). |
| Com ativação anual válida | Libera. **Não** conta para o parceiro. | Libera. |

### R4. Entrada
Uma **entrada** é: o app aberto **com a lista do parceiro carregada e ativa**, permanecendo **mais de 10 segundos**.
Abrir e fechar antes de 10 s não é entrada.

### R5. Ativo do ciclo
- Um aparelho é **1 ativo** de um parceiro num ciclo quando tem, **dentro do mesmo ciclo**, **pelo menos 2 entradas com
  24 horas ou mais de diferença** entre elas. Várias entradas no mesmo dia, sem outra 24 h depois, não contam.
- Só contam entradas feitas **depois do teste** e **sem ativação anual válida** naquele momento.
- O mesmo aparelho com **dois parceiros** no mesmo ciclo é **1 ativo para cada** parceiro.
- No ciclo seguinte o aparelho precisa cumprir a regra de novo (mês que vem é outro ativo).

### R6. Ciclo de cobrança do parceiro
- O ciclo começa na **data em que a parceria foi fechada**. Exemplo do dono: parceria em **02/04** → fechamento em
  **02/05**.
  - Entrou 05/04 e 03/05 → **não** conta no ciclo de 02/04 (a 2ª entrada caiu depois do fechamento).
  - Entrou 05/04 e 02/05 → **conta** (o dia 02/05 ainda é do ciclo).
- Fuso: **horário de Brasília** (`America/Sao_Paulo`), sempre pelo **relógio do servidor**, nunca do aparelho.
- A regra exata de onde começa o ciclo seguinte é a decisão **D3**.

### R7. Ativação anual
- Ao acabar o teste, quem está com lista sem parceria vê uma tela com **QR code e o código do aparelho**. O QR abre o
  **site** de vocês já com o código, mostrando **os planos**.
- O pagamento acontece no site (nunca dentro do app). Pago, o aparelho fica liberado por **1 ano** a partir da
  liberação, com qualquer lista.
- Como o pagamento é confirmado (automático ou manual) é a decisão **D1**.

### R8. Quem vê os números
- **v1: só vocês**, num painel administrativo.
- **Depois:** um relatório por parceiro, enviado junto com a cobrança mensal (fora do escopo da v1, mas os dados da v1
  precisam permitir gerá-lo).

## Objetivos (v1)
1. Saber, para **qualquer parceiro e qualquer ciclo** (ex.: 02/04 a 02/05), **quantos aparelhos ativos** houve, com a
   lista de códigos de aparelho que formam esse número (para conferir e contestar), e exportar em CSV.
2. Aplicar R2/R3: teste de 7 dias, liberação por parceria, bloqueio com QR para lista sem parceria.
3. Site com os planos aberto pelo QR, com o código do aparelho preenchido.
4. Painel para cadastrar parceiros (nome, data da parceria, domínios) e liberar/estender ativações.

## Não objetivos (v1)
- Painel ou login para o **dono do servidor** (vem depois, como relatório anexo à cobrança).
- Emitir boleto/nota ou cobrar o parceiro automaticamente. O painel mostra o número; a cobrança é feita por vocês.
- Pagamento dentro do app, assinaturas recorrentes, reembolso, cupons.
- iPhone/iOS (ver análise anterior: não há app iOS).
- Coletar MAC address, IMEI, número de série ou qualquer dado pessoal além do necessário (ver Guardrails).

## Anti-objetivos (seria falha mesmo funcionando)
- Bloquear quem tem direito de assistir (parceiro, teste, ativado) porque **o servidor de vocês caiu** ou está lento.
- Interromper um vídeo que já está tocando para mostrar a tela de ativação.
- Enviar **usuário ou senha** da lista do cliente para o servidor de vocês (só vai o domínio).
- Contar como ativo alguém que não cumpre R4/R5, ou deixar de contar quem cumpre: o número vira cobrança; erro aqui é
  prejuízo ou briga com parceiro.
- Dar um novo teste de 7 dias a quem só reinstalou o app.
- Quebrar as regras de TV do `CLAUDE.md` (foco, Chromium 63, margem segura, sem `import()` dinâmico novo).

## Decisões pendentes (eu recomendo, o dono decide)

| # | Decisão | Recomendação |
|---|---|---|
| **D1** | Como o pagamento da ativação é confirmado | **v1 manual:** o site mostra os planos e como pagar (Pix/WhatsApp de vocês); vocês recebem e liberam o código no painel. **v2:** gateway com Pix e confirmação automática (Mercado Pago ou Asaas, 🔎 taxas). |
| **D2** | Quais planos e preços aparecem no site | Só "Anual — R$ 10 por aparelho" até o dono definir outros. |
| **D3** | Onde começa o ciclo seguinte | Seguir o exemplo do dono: o ciclo vai do dia da parceria **até o mesmo dia do mês seguinte, inclusive**, e o próximo começa no **dia seguinte** (02/04–02/05, 03/05–03/06…). Atenção: assim o dia de fechamento anda 1 dia por mês. Alternativa sem deslizar: sempre do dia 02 ao dia 01 do mês seguinte. |
| **D4** | Lojas (Google Play, Samsung, LG) | Mandar o usuário pagar fora da loja por conteúdo digital do app pode violar a política de pagamentos das lojas (🔎 Google Play Payments policy e programas de faturamento alternativo no Brasil; regras da Samsung e LG). Recomendo: na versão das lojas, a tela de bloqueio **não** fala em preço nem tem link de pagamento (só o código e "fale com seu fornecedor"); o QR com planos fica no APK distribuído por vocês. Validar antes de publicar. |
| **D5** | Endereço do site e do serviço | Um subdomínio de vocês (ex.: `ativar.<domínio>`), servido pelo mesmo Worker. Vai em variável de ambiente, nunca no código. |

**Calls que já fiz (o dono pode mudar):** parceiro pode ter **vários domínios** (servidores costumam ter DNS
alternativos), todos somando no mesmo parceiro; a comparação é pelo **host** digitado pelo usuário, sem porta e em
minúsculas; ativação comprada no meio do ciclo não apaga entradas já feitas sem ativação; quem bate os 24 h antes
de ativar continua ativo daquele ciclo; lista M3U usa o host do endereço da playlist; parceiro **inativo** (parceria
encerrada) vale como lista sem parceria; comprar ativação com uma ainda válida **soma** 1 ano ao fim da atual; voltar ao
app que estava em segundo plano (TV que fica ligada no app por dias) conta como **nova abertura** para R4, mas o app
aberto sem parar não gera entradas sozinho.

## Desenho técnico

### 1. Identidade do aparelho
- `deviceKey` (secreta, nunca mostrada): o identificador estável da plataforma, transformado com SHA-256 + um sal fixo do
  app antes de sair do aparelho.
  - **Android (APK):** `ANDROID_ID` (sobrevive a reinstalação; muda com restauração de fábrica). Preferir o plugin
    oficial `@capacitor/device` (`Device.getId()`, 🔎 confirmar que é o ANDROID_ID na v8) a escrever Java.
  - **Samsung Tizen:** `webapis.productinfo.getDuid()` (🔎 privilégio necessário no `config.xml`).
  - **LG webOS:** `luna://com.webos.service.sm` → `deviceid/getIDs` com `LGUDID` (🔎).
  - **Navegador/PC:** UUID aleatório guardado no armazenamento do app (reinstalar = aparelho novo; aceitável, não é
    plataforma de venda).
- `code` (público, mostrado na tela e no site): 8 caracteres do alfabeto sem ambíguos já usado no pareamento
  (`CODE_ALPHABET` em `server/pair`), gerado pelo **servidor** no primeiro contato.

### 2. Serviço `server/license` (Cloudflare Worker + D1)
Mesmo padrão do `server/pair` (núcleo puro testável + adaptador Worker + adaptador Node para desenvolvimento).
Banco **Cloudflare D1** (SQLite; 🔎 limites do plano grátis).

Tabelas (mínimo):
- `devices(device_key PK, code UNIQUE, platform, first_seen_at, trial_ends_at)`
- `activations(id PK, device_key, starts_at, ends_at, source 'manual'|'payment', note, created_by)`
- `partners(id PK, name, started_on DATE, active BOOL)`
- `partner_hosts(host PK, partner_id)`
- `partner_cycle_entries(device_key, partner_id, cycle_start DATE, first_at, last_at, PK(device_key, partner_id, cycle_start))`

**Por que só `first_at` e `last_at`:** "existem 2 entradas com ≥ 24 h de diferença no ciclo" é o mesmo que
`last_at − first_at ≥ 24 h`. Uma linha por aparelho/parceiro/ciclo basta, e a contagem do ciclo é um `COUNT` simples.
O ativo é calculado na consulta, nunca guardado (regra muda → número muda junto).

Rotas (JSON, só HTTPS, limite por IP como no pareamento):
| Rota | Quem chama | Faz |
|---|---|---|
| `POST /v1/hello` `{deviceKey, platform}` | app, ao abrir | Cria o aparelho se novo (teste = agora + 7 dias). Devolve `{code, trialEndsAt, activationEndsAt, serverTime}`. |
| `POST /v1/access` `{deviceKey, host}` | app, ao carregar uma lista | Devolve `{access: 'trial'|'partner'|'activated'|'blocked', code, ...}` pela tabela R3. |
| `POST /v1/entry` `{deviceKey, host}` | app, após 10 s com lista de parceiro (R4) | Só grava se o aparelho estiver no estado "parceiro paga" (fora do teste, sem ativação). Atualiza `first_at`/`last_at` do ciclo atual. Idempotente. |
| `GET /a/:code` | navegador (QR) | Página de planos com o código preenchido (D1/D2). |
| `/admin/*` | vocês | Painel (seção 4), protegido por **Cloudflare Access** (🔎 grátis até 50 usuários), nunca por senha no código. |

### 3. App (cliente)
- `src/services/deviceIdentity.js` — `deviceKey` por plataforma (seção 1), com teste.
- `src/services/licenseApi.js` — `hello`, `access`, `entry`, com tempo limite por `Promise.race` (TVs sem
  `AbortController`), no padrão de `pairingApi.js`. Endereço em **`VITE_LICENSE_BASE_URL`**; vazia = recurso desligado
  (o app funciona como hoje).
- `src/stores/licenseStore.js` — estado `{code, access, trialEndsAt, activationEndsAt, checkedAt}` guardado no
  aparelho para funcionar sem rede (Guardrail G2).
- Entrada (R4): ao carregar uma lista de parceiro, um timer de 10 s envia `entry`; cancelado se a lista trocar ou o app
  fechar antes. No máximo 1 envio por lista a cada abertura do app.
- **Tela "Ative este aparelho"** (`src/views/ActivationRequired.vue`): QR (reusar `qrSvgData` e o visual do
  `PairPanel.vue`), código grande, "Ou use uma lista de parceiro" (abre Gerenciar listas). Regras de foco/TV valem.
  Mostrada ao abrir o app ou trocar de lista, **nunca** no meio de um vídeo.
- Mostrar o código do aparelho também em Configurações/Sobre (suporte).

### 4. Painel administrativo (v1)
- **Parceiros:** criar/editar nome, data da parceria, domínios, ativo/inativo.
- **Relatório:** escolher parceiro e ciclo (lista dos ciclos pela data da parceria) → número de ativos + lista de
  códigos com 1ª e última entrada do ciclo; exportar CSV. Mostrar também o ciclo **em andamento** (parcial).
- **Aparelhos:** buscar por código → plataforma, início do teste, ativação (início/fim), histórico de ativações;
  botão **Liberar 1 ano** / **Revogar**, registrando quem fez.

### 5. Textos legais e lojas (obrigatório junto com o código)
- `PRIVACY.md`: incluir o identificador do aparelho (cifrado por hash), domínio da lista em uso, datas de entrada,
  finalidade (licença e cobrança de parceiros), base legal (LGPD) e prazo de guarda (sugestão: 24 meses).
- Formulários de dados das lojas (Google Play "Segurança dos dados", Samsung, LG) atualizados.
- Aviso legal (FTUE) menciona o teste de 7 dias e a ativação; mudar o texto exige subir `FTUE_VERSION`.

## Guardrails (valem para toda a implementação)
- **G1 Escopo.** Só o que está em "Objetivos (v1)". Qualquer ideia nova vai para "Futuro", não para o código.
- **G2 Falha aberta.** Servidor de vocês fora do ar ou lento: o app usa o último estado salvo; se não houver, libera.
  Bloqueio só com resposta `blocked` do servidor ou estado salvo `blocked` com menos de 7 dias. Nunca bloquear por erro
  de rede.
- **G3 Nada de credenciais.** Do app para `server/license` saem só: `deviceKey` (hash), `platform`, `host` da lista.
  Nunca usuário, senha, URL completa, nome de canal ou histórico. Teste automático garante isso.
- **G4 Relógio do servidor.** Teste, ciclos, 24 h e validade da ativação usam só o horário do servidor
  (`America/Sao_Paulo`). O relógio do aparelho é ignorado.
- **G5 Regras com teste de tabela.** Cada exemplo de R2–R6 vira um caso de teste com o nome em português
  (ex.: "05/04 e 03/05 não conta no ciclo de 02/04"). Mudança de regra começa mudando a tabela.
- **G6 Contagem auditável.** Todo número do relatório pode ser aberto na lista de aparelhos que o formam.
- **G7 Sem dados extras.** Sem MAC, IMEI, IP guardado em disco, localização ou analytics. IP só em memória para limite
  de abuso, como no pareamento.
- **G8 TV primeiro.** Regras do `CLAUDE.md` (foco, Chromium 63, sem `import()` dinâmico novo, margem segura,
  `text-tv-xs`). Nada de valores fixos: URLs e chaves em variáveis de ambiente (`PULSE_*` no CI).
- **G9 Recurso desligável.** `VITE_LICENSE_BASE_URL` vazia = app igual ao de hoje (lojas, testes, demo).

## Plano de implementação (ordem)
1. **Núcleo de regras** (`server/license/license-core.mjs`): ciclos (D3), teste, ativação, `entry` e contagem, com os
   testes de tabela (G5). Sem rede, sem banco: funções puras.
2. **Serviço** (Worker + D1 + adaptador Node local) com `hello`/`access`/`entry` e migrações do banco.
3. **App sem bloqueio:** identidade do aparelho, `hello`, `entry`, código em Configurações. Permite medir ativos reais
   antes de cobrar. (Exige a política de privacidade atualizada antes de ir para usuários.)
4. **Painel administrativo** (parceiros, relatório, aparelhos, CSV).
5. **Bloqueio + tela de ativação + site de planos** (depende de D1, D2, D4).
6. **Textos legais e lojas** (seção 5) — antes de qualquer publicação das fases 3–5.

## Testes (mínimo)
- Tabela de regras (G5): teste de 7 dias; entradas no teste não contam; < 10 s não é entrada; 2 entradas no mesmo dia
  não contam; 05/04+03/05 não conta e 05/04+02/05 conta (parceria 02/04); aparelho ativado não conta; dois parceiros
  = 1 ativo para cada; reinstalar não renova o teste; mudança de ciclo (D3).
- G2: servidor fora do ar → app libera; `blocked` salvo há 8 dias → libera e tenta de novo.
- G3: o corpo de toda chamada a `licenseApi` não contém usuário, senha nem caminho da URL.
- Tela de ativação: foco no código/QR, Voltar fecha o app como na tela inicial, nada cortado em 720p/1080p/4K.

## Verificação (antes de dizer que terminou)
`npm run lint`, `npx vitest run --maxWorkers=2`, `npm run build`; `__pulse.audit()` e `__pulse.duplicateIds()` na tela
nova; serviço local rodando com dois aparelhos simulados cobrindo a tabela de regras e o relatório batendo com ela.

## Riscos
- **Lojas (D4):** pagamento fora da loja e parceria com donos de servidores podem levar à recusa do app. Validar antes.
- **Fraude contra parceiro:** alguém pode forjar `entry` para inflar os ativos de um concorrente. Mitigar com limite por
  IP, `deviceKey` registrada via `hello`, alerta no painel para muitos aparelhos novos de um mesmo IP. Não elimina.
- **Identidade:** restauração de fábrica gera aparelho novo (novo teste). Navegador é fácil de burlar. Aceito na v1.
- **Plano grátis do Cloudflare:** limites de escrita do D1 com muitos aparelhos (🔎). Uma escrita por entrada mantém o
  volume baixo.

## Futuro (fora desta RFC)
Relatório mensal automático para o dono do servidor, painel do parceiro, pagamento automático (se D1 = manual),
outros planos, emissão de cobrança, app iOS.
