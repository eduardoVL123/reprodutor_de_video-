# Plano — Pulse Player (atualizado em 2026-11-03)

Meta: **ser aceito na Google Play** (conta já criada). Depois: Samsung, LG e Microsoft Store.
Siga as fases em ordem; dentro de cada fase a ordem é a sugerida. Marque `[x]` ao terminar.
Passo a passo do console da Play: [`docs/lojas/GOOGLE-PLAY.md`](lojas/GOOGLE-PLAY.md).

## Já feito
- [x] Senha das listas aparece como `***`, sem mostrar os caracteres.
- [x] Pop-up (Picture-in-Picture) no celular.
- [x] Revisão de segurança do pagamento e licença assinada com carência de 7 dias.
- [x] Celular e tablet em pé (RFC-023, etapas 1–10).
- [x] Auditoria do repositório: 20 achados corrigidos.
- [x] Código do aparelho no lugar de MAC address (licença, RFC-018) — aparece com o serviço de licença no build.
- [x] Subir a lista pelo celular sem a M3U: o site aceita servidor + usuário + senha (RFC-021) — precisa do site no ar.
- [x] **Controle parental**: categoria visível / bloqueada (PIN) / escondida, por perfil; nomes adultos começam
      bloqueados; PIN criado no primeiro uso, trocável. Some de "Todos", Início, busca e zapping.
- [x] **Esconder categorias** (mesma tela do controle parental).
- [x] Build da loja no CI: o AAB da Play sai com `VITE_LICENSE_STORE_BUILD=1` (sem pagamento no app); o APK do
      Downloader continua completo.
- [x] `PRIVACY.md` com o controle parental; `docs/lojas/GOOGLE-PLAY.md` com as respostas do Play Console.
- [x] Capturas de rascunho com a lista de demonstração: `docs/lojas/capturas/{celular,tablet,tv}-*.png`.

## Fase 1 — Testar (você)
APK de teste: `C:\dev\android\pulse-player-teste-debug.apk` (debug, sem licença nem pareamento).
- [ ] **Celular**: girar (em pé ↔ deitado), barra de baixo e "Mais", Busca abrindo o teclado sozinha, vídeo deitando a
      tela e voltando ao fechar, controle parental (criar PIN, bloquear, esconder, abrir bloqueada com PIN).
- [ ] **Tablet**: o mesmo, com grade de 5 colunas.
- [ ] **Android TV**: sempre deitado, navegação só com o controle, controle parental pelo controle remoto.
- [ ] Anotar o que quebrar e me mandar (foto ajuda).

## Fase 2 — O que falta para enviar à Play (bloqueia o envio)
- [ ] **Enviar ao GitHub** (você, no terminal — o Git pede login numa janela que eu não consigo responder):
      `git push -u origin fix/auditoria`, depois abrir o PR para a `main`. O CI só roda em PR/push para a `main`.
- [ ] **Decidir o pagamento**: a versão da Play não vende nada no app (ativação só pelo site/revenda). Risco de
      recusa baixo, não zero. Alternativa segura: faturamento da Google (15%, outra integração).
- [ ] **Chave de publicação** (você): gerar fora do repo e cadastrar `PULSE_KEYSTORE_BASE64`,
      `PULSE_KEYSTORE_PASSWORD`, `PULSE_KEY_ALIAS`, `PULSE_KEY_PASSWORD` nos Secrets do GitHub. Sem isso o CI não gera
      o AAB.
- [ ] **Variáveis do CI** (você): `PULSE_DEMO_PLAYLIST_URL` (link "raw" de `docs/demo/pulse-demo.m3u`) e
      `PULSE_LICENSE_PUBLIC_KEY`.
- [ ] **`PRIVACY.md`** (você): nome e e-mail de contato, data e endereço do serviço de pareamento. Depois, o link
      público do arquivo vai no console.
- [ ] **Lista de demonstração com capas**: hoje os filmes Blender aparecem sem capa (blocos com a letra). Pôr
      `tvg-logo` com os pôsteres oficiais (Blender, CC BY) melhora muito as capturas e a impressão do revisor. Conferir
      se os vídeos ainda abrem antes de enviar.
- [ ] **Capturas finais**: refazer com a lista com capas; incluir uma do controle parental e uma do player tocando
      (no aparelho real — o navegador de teste não toca o vídeo).
- [ ] **Ícone 512×512, imagem de destaque 1024×500 e banner da TV 320×180** (`npm run icons` gera a base).
- [ ] **Formulários do console**: acesso ao app, classificação (IARC), público-alvo 18+, segurança dos dados,
      anúncios (não tem) — respostas em `GOOGLE-PLAY.md`.
- [ ] **Teste fechado**: 12 testadores por 14 dias seguidos (conta pessoal nova). Começar assim que houver AAB.
- [ ] Subir `versionCode` (hoje 3) em `android/app/build.gradle` a cada envio.

## Fase 3 — Serviços no ar (o app nas lojas depende deles)
- [ ] **Mercado Pago, etapa 7** (RFC-020):
  - [ ] Comprador de teste (`create_test_user`) e `MP_TEST_PIX_PAYER_NAME=APRO` (Pix de teste só aprova assim).
  - [ ] Rodada local: Pix do aparelho e dos créditos, cartão `APRO-AUTH`, `APRO-CHOK` (3DS), recusas
        `OTHE-CHNO`/`OTHE-NAUT`, freio de cartão (6ª tentativa → 429).
  - [ ] Confirmar os nomes de estorno (`refunded`, `partially_refunded`, `charged_back`; marcado `shortcut:`).
  - [ ] Rodada na Cloudflare de teste (Worker `pulse-license-teste`, `--env teste`): webhook, assinatura anual,
        `notifications_history`. Nunca na produção.
  - [ ] Pontos 🔎: campos de `GET /authorized_payments/{id}`, `frequency: 12`, `APRO` com 3DS, estreitar a `PAY_CSP`.
  - [ ] Homologação no Mercado Pago → credenciais de produção.
- [ ] **Painel da Cloudflare** (você): Cloudflare Access na frente de `/admin`, regra de limite em `/v1/checkout`.
- [ ] **Publicar** o Worker de licença (`npm run license:deploy`) e o de pareamento — só com seu OK.
- [ ] Favicon do site (`/favicon.ico` dá 404).
- [ ] Decidir: a guarda de 24 meses não apaga `orders` antigos (registro fiscal).

## Fase 4 — Melhorias pedidas (depois do envio, ou antes se der tempo)
- [ ] **Nome "eduardoVL" no Downloader**: o link da TV é a release do GitHub (`github.com/eduardoVL123/...`).
      Opções: endereço curto no seu domínio (`/apk` no Worker do site redirecionando para a release) ou organização
      no GitHub com o nome Pulse Player. Com o app na Play, a Android TV instala pela loja.
- [ ] **Aba de canais com layout novo**: definir com mockup (ex.: lista com o programa atual à esquerda e prévia à
      direita na TV).
- [ ] **Mostrar quantidade de conteúdos**: número de itens em cada categoria e no total por aba (o catálogo já
      conta; falta mostrar).
- [ ] Controle parental: categorias adultas com nome "neutro" (ex.: "Canais VIP") não são detectadas — o usuário
      bloqueia à mão (decisão de 2026-11-03).
- [ ] Testar nas TVs reais: caixa de entrada do site (IndexedDB em Tizen/webOS), ID da TV (DUID/LGUDID), ativação.
- [ ] Vídeo: E-AC3 sem som (player nativo Media3 + ffmpeg — decidir); falhas de VOD no celular (falta a foto do erro).
- [ ] Design 2.0 (RFC-014): continuar as telas aprovadas em `docs/design-2.0/mockups.html`.

## Fase 5 — Outras lojas
- [ ] Samsung: certificado (`PULSE_TIZEN_PACKAGE_ID`), checklist da seção 4 de `docs/lojas/PUBLICACAO.md`.
- [ ] LG: questionário App Self Checklist, `ares-package`.
- [ ] PC: app Electron para a Microsoft Store (RFC-024).
