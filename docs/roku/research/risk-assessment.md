# Matriz de riscos — port Roku

> Fase RESEARCH. Pontuação: impacto (Crítico 4, Alto 3, Médio 2, Baixo 1) × probabilidade (Alta 3, Média 2, Baixa 1).
> ≥ 12 CRÍTICO, ≥ 8 ALTO, ≥ 4 MÉDIO. Fontes detalhadas em `stack-research.md`.

| # | Risco | Categoria | Impacto | Prob. | Score | Severidade |
|---|---|---|---|---|---|---|
| R1 | Licença vendida fora da TV + ativação por código/QR proibidas na loja pública | Negócio | Crítico | Alta | 12 | **CRÍTICO** |
| R2 | Remoção/rejeição por ser player de playlist de terceiros (IPTV) | Negócio | Crítico | Média | 8 | ALTO |
| R3 | Certificação exige deep link e miniaturas de trick play impossíveis com catálogo do usuário | Negócio | Alto | Alta | 9 | ALTO |
| R4 | Sem ECDSA/ECDH nativos: verificação da licença e pareamento cifrado não portam como estão | Técnico | Alto | Alta | 9 | ALTO |
| R5 | Catálogo de 50k+ itens estoura memória/tempo em aparelho de 512 MB | Técnico | Alto | Média | 6 | MÉDIO |
| R6 | TS cru por HTTP não toca (fallback live `.ts`) | Técnico | Médio | Média | 4 | MÉDIO |
| R7 | Servidor de licença grava `roku` como `web` | Técnico | Médio | Alta | 6 | MÉDIO |
| R8 | Equipe sem experiência em BrightScript/SceneGraph | Operacional | Médio | Alta | 6 | MÉDIO |
| R9 | `roRegistry` de 32 KB não comporta todo o estado de `localforage` | Técnico | Médio | Média | 4 | MÉDIO |
| R10 | Sem `String.normalize` (NFD) para busca sem acento | Técnico | Baixo | Alta | 3 | BAIXO |

## R1 — Cobrança e ativação externas proibidas (CRÍTICO, escalar ao usuário)

**Evidência**: Distribution Agreement §10.3 exige Roku Pay exclusivo e proíbe direcionar pagamento para fora;
certificação 2.2/2.5 exige login no aparelho e proíbe ativação externa; requisitos de Roku Pay proíbem "rendezvous
linking". O app hoje faz exatamente isso: QR para a página de planos (`src/views/ActivationRequired.vue`,
`src/services/licenseApi.js:26`), código de aparelho e ativação pelo site (`server/license/license-core.mjs:190-191`).
**Mitigação possível** (decisão de negócio, não técnica):
- (a) Roku Pay como forma de pagamento na Roku, com produto de assinatura na Roku + servidor validando o recibo; login
  no aparelho para quem já é cliente. Exige mudança no servidor e repasse à Roku.
  Detalhes de (a), verificados em https://developer.roku.com/dev/docs/roku-pay-requirements e
  https://developer.roku.com/dev/docs/on-device-authentication :
  - compra por `ChannelStore` (`getCatalog` → `doOrder`); o servidor confirma com `validate-transaction`
    (`https://apipub.roku.com/listen/transaction-service.svc/validate-transaction/{partnerAPIKey}/{transactionId}`,
    campo `isEntitled`);
  - direito vale para **todos os aparelhos da conta Roku** (`getAllPurchases` no boot);
  - se houver login, ele é no aparelho com RFI (`getUserData`); código/QR ("rendezvous") proibido;
  - obrigatórios: Enhanced Subscription Recovery, grupos de produto, aviso de 15-30 dias antes de aumentar preço;
  - teste grátis e renovação automática feitos pela própria Roku; repasse de 80 % da receita líquida;
  - Roku Pay exclusivo: na Roku não pode coexistir ativação por código, site ou revendedor (RFC-019).
  - Disponibilidade de Roku Pay no Brasil **UNVERIFIED** (Brasil aparece como país da loja com preço em reais em
    https://developer.roku.com/dev/docs/channel-localization).
- (b) Distribuir só como beta (20 testadores, 120 dias renováveis por novo beta) — não escala.
- (c) App gratuito na Roku, sem licença (sem pagamento nenhum ligado ao produto).
- (d) **Modelo de mercado**: players IPTV que estão hoje na loja Roku usam exatamente o modelo do Pulse — app grátis,
  teste por aparelho, Device ID na TV e ativação/pagamento no site:
  - Bebz TV: "Install free from the Roku Channel Store", ativa pelo Device ID ou QR, paga com cartão no site
    (https://www.bebz.tv/).
  - Orca Player: "Find it in the Roku Channel Store", ativa em `orcaplayer.app/activate` com Device ID, teste de 7 dias
    (https://orcaplayer.app/blog/iptv-player-for-roku).
  - Zuxo Player: diz ter app oficial na loja Roku (https://zuxoplayer.com/), teste por aparelho renovado no site. A
    listagem Roku não foi confirmada (as páginas da loja redirecionam para bots).

  A regra escrita (§10.3, cert. 2.2) proíbe esse modelo, mas a fiscalização na prática aceita esses apps hoje. O app já
  tem o modo "build de loja" (`VITE_LICENSE_STORE_BUILD`, `src/views/ActivationRequired.vue:34`,
  `src/components/AccountScreen.vue:29`), que esconde o QR e o link de planos — a mesma mitigação usada para a Google Play.
**Residual**: com (d), Médio-Alto. A remoção é discricionária e a regra escrita está contra; com (a), Baixo.

## R2 — Política de conteúdo para players IPTV (ALTO)

**Evidência**: Agreement §13.1/§14.2; remoção do "M3u Playlist Player" (2018). Sem regra explícita sobre Xtream/M3U.
**Mitigação**: posicionamento neutro já existente (FTUE com texto legal, `src/views/FTUE.vue`; "nada de selos falsos ou
marcas de terceiros" na `CLAUDE.md`); lista de demonstração legal (RFC-026) para a revisão; consultar o suporte de
parceiros Roku **antes** de investir na UI completa.
**Residual**: Médio — remoção é discricionária.

## R3 — Deep link e trick play com catálogo do usuário (ALTO)

**Evidência**: cert. 5.1/5.2 (deep link obrigatório para apps com vídeo) e 4.7 (miniaturas em VOD > 15 min). O conteúdo
vem do servidor Xtream do usuário (`src/services/xtreamApi.js`), sem `contentId` estável nem BIF.
**Mitigação**: perguntar à Roku na submissão se há isenção para apps sem catálogo próprio; implementar deep link para o
que for possível (abrir o item por `stream_id` da lista ativa).
**Residual**: Alto até haver resposta da Roku.

## R4 — Criptografia sem ECDSA/ECDH (ALTO)

**Evidência**: `src/services/licenseSignature.js:39-48` (ECDSA P-256), `src/services/pairingCrypto.js:54-69` (ECDH +
AES-256-GCM); Roku só tem `roRSA`, AES-128-GCM (OS 15.2+) e `roDeviceCrypto`.
**Mitigação**: licença assinada também em RSA pelo servidor e verificada com `roRSA` (ou atestação
`getDeviceAttestationToken` verificada no servidor); pareamento por TLS + `secret` da sessão (já existe
`X-Pair-Secret`, `src/services/pairingApi.js:92-101`) sem cifra fim a fim na Roku. Ambas mudam `server/`.
**Residual**: Médio — perde-se a garantia fim a fim do pareamento só na Roku.

## R5 — Catálogos grandes (MÉDIO)

**Evidência**: "50.000+ itens" (`src/services/catalogDb.js:5`), "dezenas de MB" (`src/utils/jsonArrayReader.js:2`);
Roku de 512 MB; `ParseJson` sem streaming.
**Mitigação**: Fase 0 com benchmark em aparelho de 512 MB usando a lista do `npm run mock`; baixar com
`AsyncGetToFile`, parsear em Task, guardar só índice por categoria e carregar páginas sob demanda.
**Residual**: Médio.

## R6 — TS cru por HTTP (MÉDIO)

**Evidência**: fallback `.ts` em `src/services/streamUrl.js:53-61`; Roku só documenta TS dentro de HLS.
**Mitigação**: na Roku usar só `.m3u8` para live; testar `.ts` em aparelho e, se falhar, mostrar erro claro.

## R7 — Plataforma `roku` no servidor (MÉDIO)

**Evidência**: `server/license/license-core.mjs:22,115`.
**Mitigação**: adicionar `'roku'` a `PLATFORMS` (mudança de uma linha + teste em `tests/licenseCore.test.js`).

## R8 — Curva de BrightScript (MÉDIO)

**Mitigação**: BrighterScript (tipos, classes) + Rooibos desde o dia 1; skill de projeto `roku-brightscript` com as
regras deste estudo; primeiro marco pequeno (canal "olá" + login Xtream) antes de telas grandes.

## R9 — `roRegistry` de 32 KB (MÉDIO)

**Evidência**: chaves em `dependency-map.md` (histórico, fila de 100 itens, listas salvas).
**Mitigação**: registro só para estado pequeno (sessão, licença, perfis, PIN); histórico/fila em arquivo; monitorar
`GetSpaceAvailable()`.

## R10 — Normalização de texto (BAIXO)

**Evidência**: `src/utils/normalizeText.js:1-20` usa NFD. **Mitigação**: tabela de mapeamento de acentos latinos em
BrightScript, testada com os mesmos casos de `tests/` de busca.

## Fase 0 obrigatória (top riscos)

R1 e R2 precisam de decisão antes de qualquer código. R4, R5 e R6 precisam de prova em aparelho real (spike).
