# Auditoria de segurança — Pulse Player (reprodutor_de_video), run-1

## 1. Escopo, perfil e limites
- **Fonte:** branch `fix/auditoria`, commit `470f8e1`. O worktree tinha alterações só em `docs/rfc/RFC-025-site-vendas-e-areas.md` e `.claude/`, que não foram revisados como código.
- **Perfil:** `standard`, sem orçamento fixo. O run começou como `quick` escopado em `server/license/**`. Antes de semear o ledger, o coordenador repassou o pedido do dono: cobrir o repositório inteiro, com prioridade para `server/license` (RFC-025) e o pareamento. `docs/**` e `tests/**` entraram só como contexto (`out_of_scope`).
- **Execução:** só leitura de código. **Não havia sandbox de SO**, então nenhum código do alvo foi executado (sem `npm test`, `node`, `wrangler` ou `gradle`) e nenhum endpoint publicado nem a Cloudflare foram acessados. Por isso **nenhum achado pôde ser `confirmed`**: a skill exige resultado local observado. Tudo o que sobreviveu à verificação está em `needs_validation`, com plano local exato.
- **Execuções anteriores:** não há ledger anterior desta skill. `docs/rfc/RFC-025-auditoria.md` serviu só de contexto.
- **Agentes:** 33 sub-agentes independentes:
  - 10 hunters em 4 ondas;
  - 5 críticos de cobertura: 3 pós-onda que abriram trabalho, 1 pós-onda 4 limpo e 1 final-clean limpo;
  - 9 verificadores na Fase 3 e 9 verificadores distintos na Fase 5.

  O reconhecimento foi feito pelo parent, sem os 4 agentes `research`, para economizar.
- **Pedidos de economia do coordenador:** limitar a 1 onda, 1 crítico e lotes de 3 verificadores. Chegaram depois que as ondas e as duas verificações já tinham terminado, então valeram só para os relatórios. Nenhuma unidade ficou `deferred`.
- **Validadores:** `validate-findings.cjs` e `validate-coverage-ledger.cjs` passaram. Precisaram de um shim local porque o Node no Windows não expõe `O_NOFOLLOW`/`O_NONBLOCK`; o shim emula o no-follow com `lstat` sobre os arquivos do próprio run.
- **Cobertura parcial:** é uma passada parcial, como todo run único. O ledger registra o que foi lido; o que não está nele não deve ser tomado como seguro.

## 2. Postura geral
As fronteiras principais da RFC-025 se sustentaram no código:
- **Painel do dono:** o JWT do Cloudflare Access é conferido no Worker (RS256, `aud`, `iss`, `exp`, e-mail, `run_worker_first`), e o `LICENSE_ADMIN_TOKEN` é comparado em tempo constante.
- **Revendas e sócio:** revendas ficam isoladas por `parent_id`; a chave do sócio só faz GET de agregados.
- **Área do cliente:** `/v1/device-status` dá a mesma resposta para inexistente, vencido e suspenso, com limites no D1. Cancelar a renovação exige o `payer_email` vindo do MP.
- **Webhook e banco:** o webhook usa HMAC, reconsulta o MP e entrega uma única vez. Todo o SQL usa `bind`.
- **Páginas:** escrevem no DOM só com `textContent`, sob CSP `script-src 'self'`. O CORS `*` vale só em rotas sem credencial ambiente.

O que sobra se divide assim:
- **Lógica de negócio e ciclo de vida:** estornos, empilhamento de ativações, expurgo e contagem de parceiro.
- **Disponibilidade:** teto global de sessões do pareamento.
- **Cadeia de distribuição:** chave de debug pública.
- **App:** rebaixamento https→http com senha, replay de licença e controle parental.

## 3. Achados confirmados
Nenhum (ver seção 1: sem sandbox não há resultado local observado).

## 4. Detalhe de achados confirmados
Não se aplica (ver `FINDINGS-DETAIL.md`).

## 5. NEEDS VALIDATION (sem severidade; não são vulnerabilidades confirmadas)
| # | Pista | Trace principal | Bloqueio decisivo | Próximo passo local | Checagem do dono |
|---|---|---|---|---|---|
| 1 | Estorno não tira o ano quando outra ativação (compra, parcela, revenda ou dono) foi empilhada depois | `license-checkout.mjs:398`, `:539`; `license-db.mjs:173`; `license-rules.mjs:101` | sandbox; formato real do estorno no MP (`license-checkout.mjs:39`) | Vitest com sqlite-d1 e MP falso: parcela → Pix → chargeback; conferir se `activationEndsAt` continua em T+2a | Repetir a sequência no MP sandbox e ver "Ativado até" no /admin |
| 2 | Créditos repassados a sub-revenda sobrevivem ao estorno da compra | `license-checkout.mjs:401-403`; `license-resellers.mjs:170`; `license-api.mjs:107` | sandbox; status de chargeback no MP; se o dono revisa à mão | A compra 10 créditos e transfere para a filha B; após o estorno, B ainda tem 10 e segue ativa | No /admin, pedidos `refunded` com `transfer_out` depois da entrega |
| 3 | Ativos de parceiro infláveis por anônimo (host declarado, aparelho criado sob demanda) | `license-core.mjs:79,110,131`; `license-reports.mjs:65-74`; RFC-018:247 | sandbox; se a fatura passa por revisão; WAF | Node com relógio falso: 251 deviceKeys em 13 IPs, duas entradas com 24 h de intervalo, `monthlyCents = 60000` | WAF em `/v1/*`; distribuição de `first_at`/`first_seen_at` por ciclo |
| 4 | Expurgo diário apaga aparelho suspenso; ele volta desbloqueado e com teste novo | `license-db.mjs:229-236`, `:165`; `license-core.mjs:84`; `license-rules.mjs:81` | sandbox; alcance real | sqlite em memória: bloquear, rodar `purgeExpired` em T+731d, `/v1/access` devolve `trial` | SELECT no D1 dos suspensos que o próximo cron apagaria |
| 5 | Teto global de 10.000 sessões de pareamento esgotável por ~100 redes (cota só por /64) | `server/pair/pair-core.mjs:11,12,180,288`; `worker.mjs:85` | sandbox; WAF da zona pulse-pair | `createPairCore({maxSessions:50})` com 5 redes /64 × 10 sessões; um IP legítimo recebe 503 | Regras de rate limit/WAF para `POST /v1/sessions` |
| 6 | APK debug com chave pública versionada e o mesmo applicationId foi publicado em v2.0.0 (`/apk`) | `android/app/build.gradle:7,24,43`; `build-apk.yml:111`; histórico `97403da..d3d1c0c`; `license-core.mjs:37,162` | sandbox; certificado do asset atual; quantas TVs instalaram o debug; se o repo é público; exige sideload | keytool/apksigner + emulador offline: `adb install -r` com APK assinado por pulse-debug.p12 é aceito | `apksigner verify --print-certs` no asset de v2.0.0; segredo `PULSE_KEYSTORE_BASE64` |
| 7 | Falha de TLS ou 5xx faz o app reenviar usuário e senha Xtream em http, sem consentimento | `src/services/xtreamApi.js:332,359,363,463`; `MainActivity.java:214`; `streamUrl.js:54,74` | sandbox (a decisão RFC-008 em `docs/PASSAGEM.md:116` só prevê aviso depois do envio) | Vitest com fetch stub: o https falha e aparece URL `http://…password=dummyP` | Rede de laboratório própria + tcpdump na porta 80 |
| 8 | App aceita resposta de licença assinada antiga (replay, sem nonce nem checagem de frescor) | `src/stores/licenseStore.js:102,111,129,135`; `license-rules.mjs:92` | sandbox; esquema real de `PULSE_LICENSE_BASE_URL` (se for https em todos os builds, o achado perde significância) | Vitest com par P-256 de teste e relógio +30d: `blockReason` devolve `''` | Confirmar `https://` em todos os builds em GitHub Variables |
| 9 | Continuar assistindo e Minha lista tocam itens de categoria bloqueada/escondida sem PIN | `src/stores/playerStore.js:55,258,379`; `Dashboard.vue:66,207,418`; `CatalogBrowser.vue:192` | sandbox; precisa de item visto ou favoritado antes do bloqueio | `npm run mock` + dev: desbloquear, assistir, recarregar e dar play sem PIN | Mesmo roteiro numa TV de teste |

Trace completo, evidência e planos estão em `NEEDS-VALIDATION.md`.

**Correção mínima sugerida (o dono decide depois de validar):**
1. Recalcular as linhas empilhadas ao revogar, ou guardar duração e base por linha.
2. No estorno de créditos, seguir os `transfer_out` ou suspender em cascata.
3. Teto global de aparelhos novos e alerta no painel, como promete o RFC-018.
4. Acrescentar `AND blocked_at IS NULL` no DELETE de `devices`.
5. Limitar sessões vivas por /48 ou pôr rate limit na borda.
6. `applicationIdSuffix ".debug"` no buildType debug.
7. Nunca rebaixar base https sem consentimento prévio; `port8080Variant` e `fallbackUrl` não devem cair para http quando a base é https.
8. Nonce no texto assinado e checagem de datas no ramo online.
9. Reaplicar `parental.isLocked`/`statusOf` ao listar e ao tocar histórico e lista.

## 6. Hardening (não são achados) e padrões positivos
**Hardening anotado pelos hunters:**
- **CSP de /pagar:** `PAY_CSP` tem `'unsafe-inline'` e hosts curinga do MP na mesma origem onde ficam `pk_` e o token do dono em sessionStorage (`license-checkout.mjs:61-73`). O `challengeUrl` vai para o iframe sem validação de host (`pagar.js:297`), e o listener de `postMessage` não confere `e.source` (`pagar.js:379-385`).
- **Corrida na entrega:** o `UPDATE ... 'delivered'` sem `AND status='delivering'` abre janela de corrida com o estorno (`license-checkout.mjs:282`).
- **Limites esgotáveis:** inbox e checkout confirmam que o código existe com limite só em memória (`license-inbox.mjs:55-60`). Os baldes `cardDevice`/`cardAll` e `cancelCode` podem ser esgotados por terceiros.
- **Revendas:** o replay de `Idempotency-Key` não confere tipo nem alvo (`license-resellers.mjs:116-120`). A suspensão não vale em cascata, e há uma corrida documentada de ativação dupla.
- **Retenção:** `purgeExpired` não apaga `device_events`, `credit_movements.device_code`, `subscriptions` nem `mp_deliveries`, contra a promessa de 24 meses de `PRIVACY.md:26`. O bloqueio também não pausa a assinatura.
- **Pareamento:** o sweep do limitador só roda na criação de sessão; `pub` não é validada como ponto P-256; o ECDH não usa HKDF; o E2E não protege contra o operador.
- **CI:** ações de terceiros fixadas por tag mutável num job com `contents: write`; `persist-credentials` no padrão; a keystore é decodificada também em `pull_request` do mesmo repo; a release v2.0.0 é sobrescrita sem checksum.
- **App:** `checkPin` sem limite de tentativas; o primeiro PIN digitado vira o PIN; o interceptador nativo responde `ACAO *` para qualquer frame; `usesCleartextTraffic` vale para tudo; `checkedAt` não é assinado.
- **Ferramentas de dev:** `license-server.mjs` (Node) não tem o portão do Access; o `dev-cors-proxy` aceita subrecurso no-cors; o `mock-xtream` escuta em `0.0.0.0`.

**Padrões positivos:** além dos da seção 2:
- **Cifra:** ECDH P-256 efêmero + AES-GCM (AAD = código) no pareamento e na caixa de entrada, com CryptoKey não extraível no IndexedDB.
- **Android:** WebView com `setAllowFileAccess(false)`; só a MainActivity é exportada e não há deep link.
- **CI:** o workflow usa `pull_request` (não `_target`) e permissões mínimas no topo.

## 7. Cobertura (ledger)
- **Unidades:** 30 no total.
  - 18 `covered`.
  - 10 `candidate`, ligadas aos 9 fingerprints (o empilhamento aparece em 2 unidades).
  - 2 `out_of_scope` (`docs/**`, `tests/**`).
  - 0 `deferred`, 0 `blocked`.
- **Ondas:**
  - Onda 1: 7 hunters, 22 unidades.
  - Onda 2: transporte Xtream, empilhamento revenda/dono e ciclo de vida (expurgo, exclusão, migração).
  - Onda 3: host de parceiro.
  - Onda 4: controle parental.

  O crítico pós-onda 4 e um crítico final-clean distinto devolveram `stop: true`, sem lacunas aceitas.
- **Rejeitados:** 0 (nenhum candidato foi refutado).
- **Fase 5:** 8 registros `verified`. 1 teve substituição **não material** (`partner-host`: coluna `first_at` no plano de implantação), aplicada direto.
