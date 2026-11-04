# Plano — Pulse Player (só o que falta, atualizado em 2026-11-03)

Meta: **Google Play primeiro**, depois as lojas mais fáceis. Samsung, LG e PC ficam para depois.
Ordem sugerida de cima para baixo. Passo a passo do Play Console: [`docs/lojas/GOOGLE-PLAY.md`](lojas/GOOGLE-PLAY.md).

## 1. Site de vendas e áreas restritas (próximo trabalho)
RFC em escrita (chat separado): landing de venda de planos, área do cliente, painel da revenda e painel do dono,
sem nenhuma rota de dados aberta.
- [ ] RFC do site aprovada.
- [ ] Landing de venda: planos e preços em destaque, perguntas frequentes, chamadas para comprar.
- [ ] Área do cliente pelo código do aparelho (sem conta): até quando está ativado, renovar, suporte.
- [ ] Painel da revenda: continua com a chave longa por enquanto (decisão de 2026-11-03).
- [ ] Painel do dono atrás do Cloudflare Access (só o seu e-mail entra; a tela nem abre para os outros).
- [ ] Documentação da API para o sócio fazer automações (o que cada rota faz, como pedir uma chave própria).
- [ ] Auditoria de segurança focada no site, no fim.

## 2. Google Play (bloqueia o envio)
- [ ] Decidir o pagamento: sem venda dentro do app (como está) ou faturamento da Google.
- [ ] Chave de publicação e segredos `PULSE_KEYSTORE_*` no GitHub (sem isso o CI não gera o AAB).
- [ ] Variáveis do CI: `PULSE_DEMO_PLAYLIST_URL`, `PULSE_LICENSE_PUBLIC_KEY`, `PULSE_LICENSE_BASE_URL`.
- [ ] `PRIVACY.md`: nome, e-mail de contato, data e endereço do serviço de pareamento.
- [ ] Lista de demonstração com capas (pôsteres Blender, CC BY) e capturas finais (incluir controle parental e o
      player tocando no aparelho real).
- [ ] Ícone 512×512, imagem de destaque 1024×500 e banner da TV 320×180.
- [ ] Formulários do console (respostas em `GOOGLE-PLAY.md`) e teste fechado de 12 testadores por 14 dias.
- [ ] Subir `versionCode` em `android/app/build.gradle` a cada envio.
- [ ] Revisar e juntar o PR #1 (`fix/auditoria` → `main`).

## 3. Mercado Pago e serviços no ar
- [ ] Etapa 7 da RFC-020: comprador de teste, rodada local, nomes de estorno, rodada na Cloudflare de teste,
      pontos 🔎, homologação.
- [ ] Painel da Cloudflare: regra de limite em `/v1/checkout`.
- [ ] Publicar os Workers de licença e de pareamento (só com seu OK).
- [ ] Favicon do site.
- [ ] Downloader: depois de publicar o Worker, passar a usar `<site>/apk` (já pronto no código) no lugar do link
      do GitHub; cadastrar `PULSE_LICENSE_BASE_URL` para o texto da release mostrar o endereço curto.

## 4. App
- [ ] Testar o APK desta última versão no celular, no tablet e na Android TV (celular já testado antes, estava bem).
- [ ] Aba de canais com layout novo (definir com mockup).
- [ ] Mostrar a quantidade de conteúdos (por categoria e no total da aba).

## 5. Outras lojas (depois)
- [ ] Samsung, LG e PC (Microsoft Store, RFC-024).
