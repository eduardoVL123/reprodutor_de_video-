# Plano — Pulse Player (atualizado em 2026-11-03)

Meta: **ser aceito na Google Play** (conta já criada). Depois: Samsung, LG e Microsoft Store.
Siga as fases em ordem; dentro de cada fase a ordem é a sugerida. Marque `[x]` ao terminar.

## Já feito
- [x] Senha das listas aparece como `***`, sem mostrar os caracteres.
- [x] Pop-up (Picture-in-Picture) no celular.
- [x] Revisão de segurança do pagamento e licença assinada com carência de 7 dias (commit `0999b58`).
- [x] Celular e tablet em pé (RFC-023, etapas 1–10): barra de baixo, Início, Filmes/Séries/Canais, Detalhes,
      Busca, Login/Listas/Perfis/Ativação, tablet. Branch `feat/celular-em-pe`.
- [x] Auditoria do repositório: 20 achados corrigidos (branch `fix/auditoria`, inclui a anterior).
- [x] Código do aparelho no lugar de MAC address: o app já mostra um código de 8 letras (licença, RFC-018).
      Só aparece com o serviço de licença ligado no build (fase 3).
- [x] Subir a lista pelo celular sem precisar da M3U: o site aceita servidor + usuário + senha (RFC-021).
      Só funciona com o site publicado (fase 3).

## Fase 1 — Fechar o que está pronto (1–2 dias)
- [ ] Testar o APK no celular e no tablet de verdade (RFC-023 etapa 11): girar, barra de baixo, player deitado,
      busca abrindo o teclado. Gerar um APK novo antes (o anterior não tem as correções da auditoria).
- [ ] Testar o mesmo APK na Android TV: tem que continuar sempre deitado.
- [ ] Enviar as branches para o GitHub e abrir o PR (`fix/auditoria` já contém `feat/celular-em-pe`).
- [ ] Cadastrar `PULSE_LICENSE_PUBLIC_KEY` nas variáveis do GitHub (a privada já está no Worker).

## Fase 2 — O que a Play Store exige ou vai cobrar na revisão (bloqueia o envio)
Apps que tocam listas de IPTV são recusados com frequência. O que conta: não parecer pirataria e cumprir as regras
de conteúdo e de pagamento.

- [x] **Controle parental** (item novo 1): senha (PIN) para abrir categorias/canais adultos, com opção de trocar
      o PIN. Precisa de RFC curta: como marcar o que é adulto (nome da categoria tipo "XXX/Adulto" + marcação manual).
- [x] **Esconder categorias** (item novo 3): na lista de categorias, escolher quais não aparecem (por perfil).
      Junto com o controle parental: é o jeito de tirar o conteúdo adulto da tela.
- [ ] **Lista de demonstração legal** para o revisor (`docs/demo`, `VITE_DEMO_PLAYLIST_URL`): só conteúdo com
      licença livre. O revisor da Google entra com ela; sem isso, recusa por "não foi possível testar".
- [ ] **Build da loja** com `VITE_LICENSE_STORE_BUILD=1` (sem preço nem QR de pagamento dentro do app).
      Decidir antes: a Google exige o faturamento dela para venda de recurso digital dentro do app. Com a ativação
      vendida só fora do app e a tela dizendo "fale com seu fornecedor", o risco é menor, mas não zero.
- [ ] **AAB release assinado**: criar a chave de publicação (fora do repo) e cadastrar `PULSE_KEYSTORE_*` nos
      segredos do GitHub. Ativar o Play App Signing no console.
- [ ] **Política de privacidade** pública: preencher `PRIVACY.md` (contato, data, serviços de licença e pareamento).
- [ ] **Formulários do console**: Segurança dos dados (identificador do aparelho em hash, domínio da lista, datas de
      uso, 24 meses), classificação indicativa, público-alvo (não infantil), acesso ao app (instruções + lista demo),
      declaração de anúncios (não tem).
- [ ] **Ficha da loja**: textos de `docs/lojas/PUBLICACAO.md`, ícone 512px, banner da TV, capturas do celular
      (em pé e deitado) e da TV. Nada de marcas de terceiros nem capturas com conteúdo protegido.
- [ ] **Teste fechado**: conta pessoal nova precisa de **12 testadores por 14 dias seguidos** antes de liberar a
      produção. Começar isso o quanto antes — é o que mais demora.

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
- [ ] **Nome "eduardoVL" no Downloader** (item novo 2): o link da TV é a release do GitHub
      (`github.com/eduardoVL123/...`). Opções: um endereço curto no seu domínio (`/apk` no Worker do site
      redirecionando para a release) ou uma organização no GitHub com o nome Pulse Player. Com o app na Play, a
      Android TV instala pela loja e o Downloader vira plano B.
- [ ] **Aba de canais com layout novo** (item novo 4): definir com mockup como no celular (ex.: lista com o programa
      atual à esquerda e prévia à direita na TV).
- [ ] **Mostrar quantidade de conteúdos** (item novo 6): número de itens em cada categoria e no total por aba
      (o catálogo já conta; falta mostrar).
- [ ] Testar nas TVs reais: caixa de entrada do site (IndexedDB em Tizen/webOS), ID da TV (DUID/LGUDID), ativação.
- [ ] Vídeo: E-AC3 sem som (player nativo Media3 + ffmpeg — decidir); falhas de VOD no celular (falta a foto do erro).
- [ ] Design 2.0 (RFC-014): continuar as telas aprovadas em `docs/design-2.0/mockups.html`.

## Fase 5 — Outras lojas
- [ ] Samsung: certificado (`PULSE_TIZEN_PACKAGE_ID`), checklist da seção 4 de `docs/lojas/PUBLICACAO.md`.
- [ ] LG: questionário App Self Checklist, `ares-package`.
- [ ] PC: app Electron para a Microsoft Store (RFC-024).
