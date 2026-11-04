# NEEDS-VALIDATION — Pulse Player, run-1

Pistas fundamentadas no código, **sem severidade** e **não confirmadas**. Todas ficaram em needs_validation porque não havia sandbox de SO para execução local (nenhum código do alvo foi rodado) e, em várias, porque falta um fato de implantação ou do Mercado Pago. Ordem = prioridade sugerida (dinheiro e controle do dono primeiro, depois disponibilidade, cadeia de distribuição e app). Os planos locais são testes com dados fictícios; os de implantação são observações do dono, nunca tráfego de auditoria contra produção.

## 1. Estorno/chargeback não tira o ano pago quando outra ativação foi empilhada depois (compra, parcela, revenda ou dono)

- **Fingerprint:** `server/license/license-checkout.mjs:reversal-revokes-row-not-stacked-tail`
- **Descrição:** Toda entrega de 1 ano grava ends_at = extendActivation(MAX(ends_at) não revogado, agora) numa linha nova. O estorno revoga só a linha do pedido (reverseOrder) ou a última linha da assinatura (reverseInstallment). Uma ativação posterior (Pix, parcela, revenda, liberação do dono) guarda um ends_at que já inclui o ano estornado; MAX(ends_at) não muda e /v1/access segue "activated". Ex.: assinatura no cartão (T+1a) + Pix (T+2a) + chargeback da parcela → ativo até T+2a pagando 1 ano; ou Pix + ativação de revenda + estorno do Pix. Ganho: 1 ano (R$ 25) por contestação; o código só registra console.warn.
- **Causa raiz alegada:** As linhas de activations guardam fim absoluto calculado sobre o MAX das anteriores (license-rules.mjs:101-105; license-db.mjs:171-177), sem duração nem base; a revogação (license-checkout.mjs:398, 537-542) marca uma linha e não recalcula as empilhadas depois, enquanto o acesso é MAX(ends_at) das não revogadas.

**Trace**

- entrypoint — `server/license/license-checkout.mjs:554` (webhook): Webhook do MP (HMAC, reconsulta) após contestação aberta pelo próprio cliente.
- propagation — `server/license/license-checkout.mjs:360` (settle): Order refunded/charged_back vai para reverseOrder.
- propagation — `server/license/license-checkout.mjs:398` (reverseOrder): Revoga só activations com note = pedido e source = purchase.
- propagation — `server/license/license-checkout.mjs:539` (reverseInstallment): Revoga só a última linha source=subscription.
- propagation — `server/license/license-checkout.mjs:287` (deliveryStatements): Compra grava ends_at empilhado (idem parcela 508, revenda license-resellers.mjs:135, dono license-admin.mjs:137).
- propagation — `server/license/license-db.mjs:173` (activationEndsAt): Acesso = MAX(ends_at) das não revogadas.
- sink — `server/license/license-rules.mjs:82` (accessFor): activationEndsAt > now → activated (license-core.mjs:111).

**Evidência**

- `server/license/license-rules.mjs:101`: extendActivation soma meses a max(now, fim atual).
- `server/license/license-db.mjs:171`: activationEndsAt usa MAX(ends_at) WHERE revoked_at IS NULL.
- `server/license/license-resellers.mjs:141`: Ativação de revenda grava ends_at empilhado (calculado em 135).
- `server/license/license-admin.mjs:137`: Liberação do dono também empilha.
- `server/license/license-checkout.mjs:409`: Único controle compensatório: console.warn pedindo conferência manual.
- `server/license/license-checkout.mjs:39`: Nomes de estorno marcados como shortcut não confirmados no MP real.

**Bloqueios**

- sandbox de SO indisponível: execução local não permitida
- Formato/nomes reais do estorno de pedido e de parcela no Mercado Pago não confirmados (shortcut em license-checkout.mjs:39-40).

**Plano de validação**

- Local: Vitest com sqlite-d1 em memória e MP falso: entregar parcela da assinatura em T, pedido Pix device_annual em T+1d (fim ≈ T+2a), reenviar a parcela com payment.status charged_back; bug se activationEndsAt continuar ≈ T+2a. Repetir com Pix + activateDevice da revenda + settle refunded. Só dados fictícios.
- Implantação (observado pelo dono): Em ambiente de teste com MP sandbox: sequência assinatura + Pix num aparelho de teste, estornar a parcela no MP sandbox, ver no /admin que "Ativado até" não recuou e registrar o payload real do estorno.

## 2. Créditos comprados e repassados a uma sub-revenda sobrevivem ao estorno/chargeback da compra

- **Fingerprint:** `server/license/license-checkout.mjs:reverseOrder:transferred-credits-survive-refund`
- **Descrição:** Uma revenda compra créditos (POST /api/v1/credits/checkout), recebe o saldo, cria uma sub-revenda direta (recebe a chave pk_ dela) e repassa os créditos. Se a compra volta refunded/charged_back, reverseOrder tira só min(quantity, saldo atual da compradora) e suspende só ela; a filha fica com os créditos e active=1, e o mesmo operador segue ativando TVs com crédito não pago até o dono bloquear a filha à mão. O código só registra console.warn.
- **Causa raiz alegada:** reverseOrder (license-checkout.mjs:399-407) desfaz a entrega só em resellers.id = row.reseller_id, sem seguir transfer_out/transfer_in; a suspensão não se propaga, pois license-api.mjs:107 só olha reseller.active da própria revenda.

**Trace**

- entrypoint — `server/license/license-api.mjs:72` (POST /api/v1/credits/checkout): Revenda autenticada inicia compra (startForReseller, license-checkout.mjs:719).
- propagation — `server/license/license-checkout.mjs:310` (deliveryStatements (credits)): Entrega soma quantity ao saldo da compradora.
- propagation — `server/license/license-api.mjs:82` (POST /api/v1/sub-resellers): Cria filha e devolve a chave pk_ dela.
- propagation — `server/license/license-resellers.mjs:170` (transferCredits): Saldo sai da compradora e entra na filha (171), sem vínculo com o pedido.
- propagation — `server/license/license-checkout.mjs:361` (settle): Status refunded/charged_back chama reverseOrder.
- sink — `server/license/license-checkout.mjs:403` (reverseOrder): taken = min(quantity, saldo) (401); só a compradora é debitada e suspensa; a filha segue ativa (license-api.mjs:107).

**Evidência**

- `server/license/license-checkout.mjs:389`: Intenção: o entregue volta; se gastou, suspende. Transferência não tratada.
- `server/license/license-checkout.mjs:400`: Lê só o saldo de row.reseller_id.
- `server/license/license-checkout.mjs:409`: Único aviso: console.warn genérico.
- `server/license/license-resellers.mjs:165`: Repasse só para filha direta: o operador controla as duas pontas.
- `server/license/license-admin.mjs:251`: Controle compensatório manual: dono bloqueia a filha no painel.

**Bloqueios**

- sandbox de SO indisponível: execução local não permitida
- Comportamento real do Mercado Pago: se chargeback/estorno de order chega como refunded/charged_back depois de processed.
- Processo operacional do dono (revisão da árvore após o console.warn) decide o impacto residual.

**Plano de validação**

- Local: Sandbox sem rede, D1 em memória e MP falso: revenda A recebe pedido credits=10 entregue; com pk_ de A cria filha B e transfere 10; settle com status refunded (e charged_back); esperado com o bug: A credits=0 active=0, B credits=10 active=1 e ativação com pk_ de B debita.
- Implantação (observado pelo dono): Dono revisa no /admin pedidos refunded de kind credits e os transfer_out entre entrega e estorno; confere se as filhas seguem ativas e gastando. Confirma no sandbox do MP o status de chargeback de order.

## 3. Ativos de parceiro infláveis por anônimo: /v1/entry aceita host declarado e aparelhos criados sob demanda, sem duas das três mitigações do RFC-018

- **Fingerprint:** `server/license/license-core.mjs:entry:partner-host-unproven-fake-actives`
- **Descrição:** Um cliente anônimo gera deviceKeys aleatórias, chama /v1/access ou /v1/entry com o domínio público de um parceiro em body.host e, após o teste de 7 dias, manda duas entradas com 24 h de diferença: cada aparelho falso conta como ativo e entra em partnerMonthlyPrice no painel do dono e no relatório do sócio. Único freio: 20 aparelhos novos/dia por rede (IPv4 ou /64), sem teto global ou por parceiro, sem hello obrigatório e sem alerta. Ex.: 251 ativos sobem a faixa de R$ 350 para R$ 600/mês. O RFC-018:247-248 aceita o risco condicionado a três mitigações; o código tem só a primeira, e a lista de aparelhos do painel não traz sinal para separar os falsos.
- **Causa raiz alegada:** A atribuição ao parceiro confia no host declarado (license-core.mjs:110; partnerOf 99-105), o aparelho nasce sob demanda em qualquer rota (74-87, 90) limitado só por rede/dia (79), a regra de ativo depende só do momento das chamadas (license-rules.mjs:96-98) e a contagem vai direto ao preço (license-reports.mjs:65-74; license-admin.mjs:291-301; pricing.mjs:43-47).

**Trace**

- entrypoint — `server/license/license-core.mjs:131` (routes["/v1/entry"]): POST anônimo com deviceKey e host escolhidos pelo cliente.
- propagation — `server/license/license-core.mjs:79` (ensureDevice): Aparelho criado com teste; freio 20/dia por networkKey.
- propagation — `server/license/license-core.mjs:110` (access): partnerOf(body.host) só confere se o parceiro existe e está ativo.
- propagation — `server/license/license-rules.mjs:84` (accessFor): Após o teste, isPartner → partner.
- propagation — `server/license/license-db.mjs:244` (upsertEntry): first_at fixo, last_at sobe.
- propagation — `server/license/license-rules.mjs:97` (isActive): Ativo = last_at - first_at >= 24 h.
- sink — `server/license/license-reports.mjs:74` (partners): COUNT sem filtro (65) vira monthlyCents = partnerMonthlyPrice(n); idem license-admin.mjs:291-301.

**Evidência**

- `server/license/license-core.mjs:24`: newDevicesPerDay = 20 é o único freio, comentado como proteção contra inflar parceiro.
- `server/license/license-core.mjs:90`: deviceState cria aparelho em hello, access ou entry.
- `server/license/pricing.mjs:43`: partnerMonthlyPrice por faixa de ativos.
- `server/license/license-admin.mjs:322`: Detalhe do ciclo sem IP nem sinal de anomalia.
- `docs/rfc/RFC-018-ativos-e-ativacao.md:247`: Risco aceito condicionado a limite por IP, hello e alerta; só o limite existe.

**Bloqueios**

- sandbox de SO indisponível: execução local não permitida
- Decisão de produto: se a cobrança do parceiro é manual e revisada antes de faturar (fora do código).
- WAF/rate limit na borda Cloudflare para /v1/* não visível no repositório.

**Plano de validação**

- Local: Sandbox sem rede, núcleo Node com sqlite-d1 e relógio injetado: parceiro fictício exemplo.test; 20 deviceKeys por IP fictício (21ª → 429); 13 IPs para passar de 251; avançar 7 d + 1 min, /v1/entry; avançar 24 h, repetir; conferir /api/v1/reports/partners actives >= 251 e monthlyCents = 60000.
- Implantação (observado pelo dono): O dono confere a regra de WAF/rate limit em /v1/* do pulse-license e como a fatura do parceiro é emitida. Para achar rajadas, olha a distribuição de first_at por ciclo em partner_cycle_entries e de devices.first_seen_at dos aparelhos desse ciclo.

## 4. Expurgo diário apaga aparelho suspenso pelo dono e ele volta sem a suspensão, com teste novo

- **Fingerprint:** `server/license/license-db.mjs:purgeExpired:blocked-device-purged-recreated-unblocked`
- **Descrição:** O cron diário chama purgeExpired, que apaga devices com first_seen_at > 24 meses sem activations nem partner_cycle_entries (license-db.mjs:229-236), sem olhar blocked_at nem uso recente. Aparelho suspenso não grava entrada de parceiro (license-core.mjs:133), então entra no expurgo depois que a última ativação passa de 24 meses mesmo seguindo em uso. A deviceKey é estável (hash do ID da plataforma, deviceIdentity.js:81-88); no próximo /v1/hello|access ensureDevice recria a linha sem blocked_at, com teste de 7 dias e código novo, e accessFor deixa de devolver suspended (trial, ou partner indefinido se a lista for de parceiro). Checkout e revenda também voltam a aceitar o aparelho.
- **Causa raiz alegada:** A retenção de devices em purgeExpired usa só idade e ausência de ativações/entradas, sem preservar blocked_at (estado de controle do dono) nem uso recente; a chave estável recria a linha num estado mais permissivo.

**Trace**

- entrypoint — `server/license/license-core.mjs:120` (/v1/hello e /v1/access (124)): App do aparelho suspenso segue chamando com a mesma deviceKey.
- propagation — `server/license/license-core.mjs:133` (/v1/entry): Suspenso devolve recorded:false; nenhuma entrada de parceiro o protege.
- propagation — `server/license/worker.mjs:118` (scheduled): Cron chama purgeExpired.
- propagation — `server/license/license-db.mjs:228` (purgeExpired): Apaga ativações vencidas há mais de 24 meses.
- propagation — `server/license/license-db.mjs:231` (purgeExpired): DELETE devices sem filtro de blocked_at nem uso.
- propagation — `server/license/license-core.mjs:84` (ensureDevice): Linha ausente → insertDevice com teste novo e código novo.
- propagation — `server/license/license-db.mjs:165` (insertDevice): INSERT sem blocked_at (NULL).
- sink — `server/license/license-rules.mjs:81` (accessFor): Sem blockedAt devolve trial (83) ou partner (84); /v1/access assina (license-core.mjs:128).

**Evidência**

- `server/license/license-db.mjs:229`: Condição do DELETE (229-236) não menciona blocked_at nem uso.
- `server/license/license-db.mjs:212`: RETENTION_MS 730 dias.
- `server/license/license-admin.mjs:361`: Suspensão vive só em devices.blocked_at.
- `server/license/license-checkout.mjs:171`: Recusa de checkout depende do blocked_at apagado.
- `server/license/license-resellers.mjs:133`: Recusa de ativação por revenda depende do blocked_at.
- `src/services/deviceIdentity.js:77`: Chave estável justamente para não dar novo teste; o expurgo derrota isso.

**Bloqueios**

- sandbox de SO indisponível: execução local não permitida
- Alcance real: quantos aparelhos suspensos com mais de 24 meses e sem ativação recente seguem em uso (só o dono observa no D1).

**Plano de validação**

- Local: Sandbox sem rede, SQLite em memória (sqlite-d1.mjs) e now injetado: migrate; /v1/hello com deviceKey "a"*64 em T0; blocked_at = T0; /v1/access → suspended; purgeExpired(db, T0 + RETENTION_MS + 1 d); linha some; /v1/access com a mesma chave → trial, código novo, blocked_at NULL. Correção a testar: AND blocked_at IS NULL no DELETE.
- Implantação (observado pelo dono): Dono roda só SELECT no D1: aparelhos com blocked_at não nulo, first_seen_at > 24 meses e sem ativação/entrada recente (os próximos apagados pelo cron); confere se algum código suspenso reapareceu como aparelho novo.

## 5. Atacante anônimo com ~100 redes de origem pode esgotar o teto global de 10.000 sessões de pareamento e deixar todas as TVs sem parear

- **Fingerprint:** `pair-global-session-cap-ipv6-quota`
- **Descrição:** POST /v1/sessions é anônimo e vai para um único Durable Object "hub" (worker.mjs:85-87) com um Map de teto global 10.000 (pair-core.mjs:11, 288). A cota é 10 criações/min por networkKey (IPv4 inteiro ou /64 IPv6; pair-core.mjs:12, 172-181, 281) e cada sessão não consumida vive 10 min (9, 295). Cerca de 100 chaves (um /48 IPv6 tem 65.536 /64; ou 100 IPv4 de proxy) mantêm o Map cheio; toda criação legítima recebe 503 e a TV mostra UNAVAILABLE (src/services/pairingApi.js:83). O pareamento para para todos enquanto durar o ataque (~17 req/s); login manual e licença não são afetados. Não há limite por prefixo mais largo, teto de sessões vivas por origem nem rate limit em server/pair/wrangler.jsonc.
- **Causa raiz alegada:** O teto de sessões é global num DO singleton, mas a cota de criação é só por IPv4 ou /64 e limita taxa, não sessões vivas por origem; poucas redes baratas ocupam todo o recurso durante o TTL de 10 min.

**Trace**

- entrypoint — `server/pair/worker.mjs:71` (default.fetch): Requisição anônima em /v1/*; IP de CF-Connecting-IP (72) repassado ao DO.
- propagation — `server/pair/worker.mjs:85` (default.fetch): idFromName("hub"): uma única instância, um Map e um limitador.
- propagation — `server/pair/pair-core.mjs:355` (handleApi): networkKey reduz o IP: IPv4 inteiro, IPv6 /64 (172-181).
- propagation — `server/pair/pair-core.mjs:281` (createSession): Única cota: 10/min por chave (linha 12).
- propagation — `server/pair/pair-core.mjs:295` (createSession): Sessão vive 10 min; só sai por expiração ou coleta com segredo (350).
- sink — `server/pair/pair-core.mjs:288` (createSession): sessions.size >= 10000 → 503 para todas as TVs.

**Evidência**

- `server/pair/pair-core.mjs:11`: DEFAULT_MAX_SESSIONS = 10000; createPairCore() sem opções em worker.mjs:37.
- `server/pair/pair-core.mjs:12`: DEFAULT_LIMITS.create = 10 por janela de 60 s.
- `server/pair/pair-core.mjs:180`: networkKey agrega IPv6 só em /64.
- `server/pair/pair-core.mjs:9`: TTL 10 min: ~100 vagas por chave.
- `server/pair/pair-core.mjs:285`: Única validação do corpo: pub base64url até 128 chars.
- `src/services/pairingApi.js:83`: Status diferente de 201 vira UNAVAILABLE na TV.
- `server/pair/wrangler.jsonc:1`: Sem binding de rate limit nem WAF no repositório.

**Bloqueios**

- sandbox de SO indisponível: execução local não permitida
- Regras de WAF, Rate Limiting ou Bot Management da zona Cloudflare do pulse-pair ficam fora do repositório e podem limitar por /48, ASN ou volume global.

**Plano de validação**

- Local: Vitest em sandbox sem rede: createPairCore({ now: relógio falso, maxSessions: 50 }); POST /v1/sessions {"pub":"AAAA"} de 5 IPv6 em /64 distintos do mesmo /48 (2001:db8:0:1::1 … 2001:db8:0:5::1), 10 vezes cada → 50×201; depois POST de 198.51.100.7 → 503. Avançar 9 min, repetir a rodada e confirmar 503 persistente; avançar 10 min sem tráfego → 201. Não usar o teto real nem endpoint implantado.
- Implantação (observado pelo dono): Dono confere no painel da Cloudflare (Security > WAF > Rate limiting, Bot Management) da zona do pulse-pair se há regra para POST /v1/sessions por prefixo largo ou volume total, e acompanha 503 nas métricas do DO PairHub. Sem teste de carga em produção.

## 6. APK de debug, assinado com chave pública versionada e com o mesmo applicationId de produção, foi publicado no link fixo v2.0.0 das TVs

- **Fingerprint:** `android/app/build.gradle:signingConfigs.debug:public-key-same-applicationId`
- **Descrição:** O build debug usa o applicationId com.pulseplayer.app do release (build.gradle:7) e é assinado por android/app/pulse-debug.p12, versionado com senha "android" (22-29, 43). Entre 97403da (2026-10-23) e d3d1c0c (2026-10-25) o workflow publicava app-debug.apk como pulse-player.apk na release mutável v2.0.0, para onde /apk redireciona (license-core.mjs:37, 161-162). TV que instalou esse APK aceita como atualização qualquer APK com.pulseplayer.app assinado com a chave pública; um terceiro que convença o usuário a instalar o APK dele substitui o app e herda os dados locais (credenciais Xtream, deviceKey, licença). O workflow atual só publica o release (185) com PULSE_KEYSTORE_BASE64 (132-135, 188), mas o debug com a chave pública segue em todo run (111-123) e as instalações antigas continuam expostas.
- **Causa raiz alegada:** A identidade de assinatura de debug é pública (keystore e senhas no repo) e divide o applicationId com o release; por um período o debug foi distribuído como APK oficial, tornando a chave pública a identidade de atualização dessas TVs. Falta applicationIdSuffix no debug e nenhuma migração tira as TVs da chave de debug.

**Trace**

- entrypoint — `.github/workflows/build-apk.yml:111` (jobs.apk.steps["APK debug"]): Todo run gera assembleDebug com a chave versionada; em 97403da..d3d1c0c era publicado como pulse-player.apk em v2.0.0.
- propagation — `android/app/build.gradle:7` (android.defaultConfig.applicationId): com.pulseplayer.app para debug e release, sem applicationIdSuffix.
- propagation — `android/app/build.gradle:24` (android.signingConfigs.debug): pulse-debug.p12 versionado, senhas "android", alias neutrodebug.
- sink — `server/license/license-core.mjs:162` (GET /apk): 302 para APK_URL (linha 37), asset mutável pulse-player.apk da v2.0.0.

**Evidência**

- `android/app/build.gradle:43`: buildTypes.debug usa signingConfigs.debug.
- `android/app/build.gradle:19`: Comentário: chave de debug pública feita para a TV aceitar atualização por cima.
- `.github/workflows/build-apk.yml:181`: Comentário reconhece o risco de atualização falsa com a chave de debug.
- `.github/workflows/build-apk.yml:132`: Release e publicação só com PULSE_KEYSTORE_BASE64.
- `server/license/license-core.mjs:37`: APK_URL aponta para releases/download/v2.0.0/pulse-player.apk.

**Bloqueios**

- sandbox de SO indisponível: execução local não permitida (sem apksigner/keytool/emulador)
- Fato de implantação: certificado que assina hoje o asset pulse-player.apk de v2.0.0 e existência do segredo PULSE_KEYSTORE_BASE64.
- Fato de implantação: se alguma TV real instalou o APK de debug publicado entre 2026-10-23 e 2026-10-25.
- Fato do GitHub: visibilidade do repositório e dos artefatos do CI (quem obtém pulse-debug.p12).
- A exploração exige que a vítima instale um APK distribuído pelo atacante (sideload/Downloader).

**Plano de validação**

- Local: Em sandbox sem rede: keytool -list -v -keystore android/app/pulse-debug.p12 -storepass android e apksigner verify --print-certs num app-debug.apk local; num emulador Android TV descartável, instalar o debug, gravar dados fictícios (npm run mock), gerar outro APK com.pulseplayer.app assinado com pulse-debug.p12 e versionCode maior, adb install -r e conferir aceitação e dados preservados; repetir partindo de chave release de teste e ver INSTALL_FAILED_UPDATE_INCOMPATIBLE.
- Implantação (observado pelo dono): Dono baixa o asset atual de v2.0.0 e roda apksigner verify --print-certs comparando com o certificado de pulse-debug.p12; confere no histórico de Actions/Releases se runs de 23-25/10/2026 publicaram o debug e quantos downloads; confere se PULSE_KEYSTORE_BASE64 existe e se o repo é público.

## 7. Quando o https falha no transporte, o app refaz a chamada em http e manda usuário e senha Xtream em texto puro, sem pedir confirmação

- **Fingerprint:** `src/services/xtreamApi.js:apiRequest:https-transport-failure-cleartext-credential-retry`
- **Descrição:** Com base Xtream https, falha de transporte (erro de rede/TLS ou HTTP >= 500) faz apiRequest repetir a mesma URL em http:// com username e password na query, sem consentimento. Um atacante na rede do usuário (Wi-Fi, roteador, ISP) provoca a falha derrubando o TLS (no APK toda exceção, inclusive SSLHandshakeException, vira 502) e recebe as credenciais em claro na porta 80; a variante http://host:8080 e o fallbackUrl do player (user/pass no caminho) repetem o padrão, a cada chamada, pois a base salva continua https. 4xx não rebaixa. O selo "insecure" só aparece depois do envio. docs/PASSAGEM.md:116-117 registra a decisão de manter (RFC-008), mas o único controle citado é o aviso posterior, que não equivale a consentimento prévio.
- **Causa raiz alegada:** apiRequest (xtreamApi.js:353-368) trata isTransportFailure (332-336) como sinal para repetir em http a URL de buildApiUrl (153-163) com credenciais na query, sem consentimento nem memória de host https-only; o sinal é forjável por quem está no caminho da rede.

**Trace**

- entrypoint — `src/stores/authStore.js:235` (login Xtream): authenticate com a lista do usuário (pode ser https).
- propagation — `src/services/xtreamApi.js:489` (authenticate): Cada candidato (base e http://host:8080 de port8080Variant 459-467) passa por apiRequest com credenciais.
- propagation — `src/services/xtreamApi.js:197` (fetchWithTimeout): Rejeição do fetch (inclusive TLS) vira CORS_OR_NETWORK_ERROR.
- propagation — `android/app/src/main/java/com/pulseplayer/app/MainActivity.java:214` (interceptação nativa): No APK toda exceção vira 502.
- propagation — `src/services/xtreamApi.js:332` (isTransportFailure): Rede/TLS ou HTTP >= 500 contam como falha de transporte.
- sink — `src/services/xtreamApi.js:363` (apiRequest): execute(httpBase) envia em http:// com username/password na query (347).

**Evidência**

- `src/services/xtreamApi.js:359`: Condição: base https e isTransportFailure; 4xx bloqueado de propósito (356-358).
- `src/services/xtreamApi.js:161`: Credenciais na query de player_api.php.
- `src/services/xtreamApi.js:463`: port8080Variant devolve http://host:8080 para base https.
- `src/services/xtreamApi.js:535`: insecure calculado só depois do envio.
- `src/stores/catalogStore.js:88`: Catálogo usa apiRequest: o rebaixamento se repete.
- `android/app/src/main/AndroidManifest.xml:29`: usesCleartextTraffic=true.
- `src/services/streamUrl.js:54`: fallbackUrl http com user/pass para live (e VOD em 74).
- `src/composables/useVideoEngine.js:298`: Fallback http usado quando a reprodução não começa (476-485).
- `tests/xtreamApi.test.js:35`: Testes fixam o rebaixamento como intencional.
- `docs/PASSAGEM.md:116`: Decisão do dono: fica como está; controle citado é o selo posterior.

**Bloqueios**

- sandbox de SO indisponível: execução local não permitida; não foi possível observar o envio em http após falha de TLS forçada.

**Plano de validação**

- Local: Vitest em sandbox sem rede: stub de fetch que rejeita https://srv.test com TypeError e responde 200 auth para http://srv.test; authenticate({dns:"https://srv.test", username:"dummyU", password:"dummyP"}) e registrar URLs: esperado http://srv.test/player_api.php?username=dummyU&password=dummyP sem interação e insecure=true; repetir com 502 (rebaixa) e 401 (não rebaixa); buildStreamUrl com base https deve dar fallbackUrl http com dummyU/dummyP.
- Implantação (observado pelo dono): Aparelho de teste do dono com conta Xtream fictícia em painel https próprio, numa rede de laboratório que recusa o TLS do host: capturar a porta 80 com tcpdump/mitmproxy e confirmar credenciais em claro sem prompt. Sem credenciais reais nem redes de terceiros.

## 8. App aceita de novo uma resposta de licença assinada e antiga (replay): teste ou ativação vencidos continuam valendo e a suspensão pode ser desfeita

- **Fingerprint:** `src/stores/licenseStore.js:refresh:signed-access-replay-no-freshness`
- **Descrição:** A resposta de /v1/access é assinada (ECDSA P-256) sobre deviceKey, host, access, code, datas e serverTime, sem nonce do cliente (license-rules.mjs:91-92; license-core.mjs:128). No app, refresh (licenseStore.js:100-115) só confere a assinatura, grava checkedAt local e offline=false; online, blockReason (129) só bloqueia blocked/suspended e não confere trialEndsAt/activationEndsAt (o ramo offline confere, 135-137). Quem responde no lugar da origem de licença repete para sempre uma resposta trial/activated antiga e anula um suspended posterior. Editar o IndexedDB não é equivalente (load() confere assinatura, 48). O que decide a fronteira é o esquema da origem: VITE_LICENSE_BASE_URL vem de variável do CI fora do repo; com HTTPS (plano: https://pulseplayer.com.br) e sem networkSecurityConfig, o replay exige CA confiável no sistema (quem tem isso também reempacota o app, sem ganho); com HTTP basta DNS/hosts no roteador do dono.
- **Causa raiz alegada:** A assinatura prova origem mas não frescor: sem nonce no texto assinado e sem exigir serverTime monotônico/próximo do relógio (licenseStore.js:102-111); o ramo online de blockReason (129) ignora as datas, ao contrário do offline (135-137).

**Trace**

- entrypoint — `src/services/licenseApi.js:44` (post (checkAccess, 64)): fetch a VITE_LICENSE_BASE_URL + /v1/access; quem controla a resposta entrega o JSON.
- propagation — `src/stores/licenseStore.js:102` (refresh): verifyLicense só confere a assinatura; resposta antiga do mesmo deviceKey/host passa.
- propagation — `src/services/licenseSignature.js:43` (verifyLicense): Sem teste de frescor.
- propagation — `src/stores/licenseStore.js:111` (refresh): checkedAt local, offline=false (114), estado antigo gravado (115).
- sink — `src/stores/licenseStore.js:129` (blockReason): Online, só blocked/suspended bloqueiam; trial/activated antigos liberam.

**Evidência**

- `server/license/license-rules.mjs:92`: Texto assinado sem nonce do cliente.
- `server/license/license-core.mjs:128`: Servidor assina com serverTime, sem nada do pedido além de deviceKey/host.
- `src/stores/licenseStore.js:135`: Só o ramo offline bloqueia teste/ativação vencidos.
- `src/stores/licenseStore.js:48`: load() confere assinatura: editar storage não é equivalente.
- `src/services/licenseSignature.js:5`: Ameaça declarada: proxy/hosts respondendo activated.
- `.github/workflows/build-apk.yml:104`: VITE_LICENSE_BASE_URL vem de vars.PULSE_LICENSE_BASE_URL, fora do repo.
- `docs/rfc/RFC-025-site-vendas-e-areas.md:458`: Plano: https://pulseplayer.com.br.

**Bloqueios**

- sandbox de SO indisponível: execução local não permitida; replay não reproduzido.
- Esquema e origem reais de PULSE_LICENSE_BASE_URL em cada build (APK site, APK lojas, Tizen, webOS) não aparecem na fonte; com HTTPS em todos o achado perde significância, com HTTP em algum se sustenta.

**Plano de validação**

- Local: Vitest em sandbox sem rede (padrão de tests/licenseClient.test.js): par P-256 de teste, vi.stubEnv VITE_LICENSE_PUBLIC_KEY e VITE_LICENSE_BASE_URL; assinar resposta trial com serverTime T0; fetch mockado devolve sempre essa resposta; setSystemTime(T0 + 30 d); refresh e blockReason: "" confirma. Repetir com estado salvo suspended (T1 > T0) seguido do replay de T0.
- Implantação (observado pelo dono): Dono confere no GitHub (Settings > Variables) que PULSE_LICENSE_BASE_URL é https:// em todos os builds publicados e que nenhum build aceita CA de usuário. Correção sugerida: nonce do app incluído no texto assinado, rejeitar serverTime menor que o salvo e aplicar no ramo online a checagem de datas.

## 9. Continuar assistindo e Minha lista mostram e tocam itens de categorias bloqueadas ou escondidas sem pedir o PIN

- **Fingerprint:** `src/stores/playerStore.js:watchHistory-customQueue-skip-parental-filter`
- **Descrição:** O controle parental promete que "locked" só abre com PIN e "hidden" some de tudo (parentalStore.js:8-9), com desbloqueio só até fechar o app (11, 34). O filtro só age no catálogo (useParentalFilter.js:18, 23; CatalogBrowser.vue:46, 48, 203, 266). Histórico (watchHistory) e Minha lista (customQueue) são cópias persistidas com category_id (playerStore.js:55) que nenhum caminho de leitura ou reprodução confere contra o parentalStore. Cenário: o responsável desbloqueia com PIN e assiste/favorita um item; o app fecha; na abertura seguinte quem tem só o controle remoto (ex.: criança) vê o item no destaque do Início, no Continuar assistindo, na Minha lista ou nos Favoritos do ao vivo e toca sem PIN. Idem para categoria marcada hidden depois.
- **Causa raiz alegada:** A autorização parental é avaliada só ao listar o catálogo e o desbloqueio fica em memória; addToHistory/saveProgress (playerStore.js:258-301) e enqueueItem (215-223) persistem cópias, e os caminhos que as exibem e tocam (Dashboard.vue:65-67, 207-210, 388-389, 418-424, 583-624, 782-803; CatalogBrowser.vue:191-198; playerStore.js:379-405; seriesPlaylist.js:56-58) não reaplicam statusOf/isLocked.

**Trace**

- entrypoint — `src/components/CatalogBrowser.vue:256` (unlockCategory): Com PIN, o responsável desbloqueia só nesta abertura (parental.unlock, 258).
- propagation — `src/stores/parentalStore.js:100` (unlock): Desbloqueio no Set em memória (34).
- propagation — `src/stores/playerStore.js:295` (saveProgress -> addToHistory): Histórico gravado com category_id e persistido sem consulta parental.
- propagation — `src/stores/playerStore.js:215` (enqueueItem): Minha lista persistida sem checagem.
- propagation — `src/stores/playerStore.js:183` (hydrate): Histórico e lista voltam do storage sem filtro.
- propagation — `src/views/Dashboard.vue:66` (recentHistoryItem / heroItem): Destaque do Início, Continuar assistindo, Minha lista e Favoritos do ao vivo sem filtro.
- sink — `src/stores/playerStore.js:395` (playItem / playFromCustomQueue): Tocam o item sem PIN (Dashboard.vue:207-210, 388-389, 418-424; seriesPlaylist.js:56-58).

**Evidência**

- `src/stores/parentalStore.js:8`: Contrato: locked só com PIN; hidden some de tudo (9).
- `src/stores/parentalStore.js:34`: Desbloqueio só em memória.
- `src/composables/useParentalFilter.js:23`: Filtro só recalcula catalog.setHidden.
- `src/components/CatalogBrowser.vue:203`: Fileiras de categoria excluem bloqueadas, mas Favoritos (192-198) não.
- `src/stores/playerStore.js:379`: playFromCustomQueue sem consulta parental.
- `src/utils/seriesPlaylist.js:58`: playHistoryItem chama playItem sem checagem.

**Bloqueios**

- sandbox de SO indisponível: execução local não permitida
- A exposição exige item assistido com PIN ou favoritado antes do bloqueio; falta observar no app real que destaque e fileiras aparecem e tocam após reabrir.

**Plano de validação**

- Local: Com npm run mock (teste123/senha123) e npm run dev num navegador local: marcar categoria de teste como locked com PIN de teste, desbloquear, tocar um filme > 15 s, adicionar outro à Minha lista, recarregar; ver se aparecem no destaque/Continuar assistindo/Minha lista e tocam sem PIN; repetir com hidden e com favorito do ao vivo. Parar no primeiro play sem PIN.
- Implantação (observado pelo dono): Numa TV de teste com lista de teste: repetir fechando e reabrindo o app.

