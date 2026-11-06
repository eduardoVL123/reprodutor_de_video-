# Plano — Pulse Player (só o que falta, atualizado em 2026-11-05)

Meta: **Google Play primeiro**, depois as lojas mais fáceis. Samsung, LG e PC ficam para depois.
Ordem sugerida de cima para baixo. Passo a passo do Play Console: [`docs/lojas/GOOGLE-PLAY.md`](lojas/GOOGLE-PLAY.md).

## 1. Site de vendas e áreas restritas (próximo trabalho)
RFC em escrita (chat separado): landing de venda de planos, área do cliente, painel da revenda e painel do dono,
sem nenhuma rota de dados aberta.
- [x] RFC do site aprovada (RFC-025, 2026-11-04). Código pronto, sem commit; o que falta está no fim da RFC-025.
- [x] (código, sem commit) Landing de venda: planos e preços em destaque, perguntas frequentes, chamadas para comprar.
- [x] (código, sem commit) Área do cliente pelo código do aparelho (sem conta): até quando está ativado, renovar, suporte.
- [ ] Painel da revenda: continua com a chave longa por enquanto (decisão de 2026-11-03).
- [x] Painel do dono atrás do Cloudflare Access (só o seu e-mail entra; a tela nem abre para os outros).
- [x] (código, sem commit) Documentação da API para o sócio fazer automações (o que cada rota faz, como pedir uma chave própria).
- [x] Auditoria de segurança (código, 2026-11-04): itens 1-4 e 9 corrigidos; 5-8 em `docs/rfc/RFC-025-auditoria-pendencias.md`.

## 2. Google Play (bloqueia o envio)
- [x] Pagamento: **sem venda dentro do app** no envio (decisão de 2026-11-05). Faturamento da Google só depois de
      aceito na loja, se fizer sentido.
- [x] Chave de publicação e segredos `PULSE_KEYSTORE_*` no GitHub. AAB 2.1 assinado mais novo: CI de 2026-11-05
      (commit `06a6462`, branch `feat/app-pc`), baixado em `C:\dev\android\play-2026-11-05\bundle\release\app-release.aab`.
- [x] Variáveis do CI: `PULSE_DEMO_PLAYLIST_URL`, `PULSE_LICENSE_PUBLIC_KEY`, `PULSE_LICENSE_BASE_URL`.
- [x] `PRIVACY.md` preenchido e publicado em `/privacidade` (2026-11-04).
- [ ] Lista de demonstração com capas e capturas finais (incluir controle parental e o player tocando no aparelho
      real). **Direção (2026-11-05):** mostrar usos além de IPTV (hotel, recepção, empresa, escola, igreja, academia);
      grupos e regras em [`docs/demo/README.md`](demo/README.md); proposta e plano em
      [`RFC-026`](rfc/RFC-026-lista-de-demonstracao.md). Fase 1 implementada localmente: 10 vídeos próprios com áudio,
      16 capas, 7 grupos, dois HLS atuais e aviso em Séries. Falta publicar os arquivos e testar no aparelho.
      Novo APK só quando o dono pedir (2026-11-06).
- [x] Ícone 512×512, imagem de destaque 1024×500 e banner da TV 320×180 em `docs/lojas/play/`.
- [ ] Play App Signing, formulários do console (respostas em `GOOGLE-PLAY.md`) e teste fechado de 12 testadores
      por 14 dias.
- [x] `versionCode` 5 / 2.2 preparado em 2026-11-06. Gerar APK e AAB novos assinados pelo CI após publicar os arquivos da demonstração.
- [x] Revisão do código para a Play (2026-11-05): targetSdk 36, sem bibliotecas nativas (16 KB ok), só INTERNET,
      textos da versão da loja sem vendedor nem pagamento, link da política de privacidade dentro do app.
- [ ] Levar a branch `feat/app-pc` (correções da auditoria + app de PC) para a `main` por PR.

## 3. Mercado Pago e serviços no ar
- [ ] (**só quando o dono pedir**) Cartão do aparelho (assinatura anual): o Mercado Pago de teste recusa com 400 "User bad request". O Pix gera o pedido;
      o cartão dos créditos ainda não foi confirmado (ficou "em análise"). Decisão (2026-11-04): fica em teste por enquanto; testar a assinatura com credenciais de produção depois.
- [ ] Etapa 7 da RFC-020: comprador de teste, rodada local, nomes de estorno, rodada na Cloudflare de teste,
      pontos 🔎, homologação.
- [x] Painel da Cloudflare: regra de limite em `/v1/checkout`.
- [x] Worker de licença publicado em pulseplayer.com.br (2026-11-04); pareamento já estava no ar.
- [x] Favicon do site.
- [ ] Downloader: depois de publicar o Worker, passar a usar `<site>/apk` (já pronto no código) no lugar do link
      do GitHub; cadastrar `PULSE_LICENSE_BASE_URL` para o texto da release mostrar o endereço curto.

## 4. App
- [x] Celular/tablet (2026-11-05): barra Início · Filmes · Séries · TV · Conta; busca no destaque e lupa nas abas;
      tela Conta (perfil, assinatura, Favoritos, listas, privacidade); "Minha lista" virou Favoritos; Início mostra
      cada fileira quando a seção fica pronta; canal fora do ar (404) avisa na hora.
- [ ] Testar o APK desta última versão no tablet e na Android TV (celular testado em 2026-11-05).
- [ ] Auditoria de 2026-11-05: itens 1-5 corrigidos. Faltam, por ordem: 6-7 estorno de parcela/liberação manual
      (só com o cartão ligado), 8-9 pareamento e cadastro de aparelhos travados por quem tem muitos IPv6,
      10 logout por falha passageira do armazenamento, 11 revenda trancada por vizinho de IP, 12 TVs no mesmo IP
      derrubando o pareamento, 13 APK de debug com o mesmo nome do de release, 14 sessão gravada antes de limpar o
      catálogo, 15 reprocessar a 1ª parcela do cartão, 16 trava do PIN só na memória, 17 relatório do parceiro,
      18 índices do D1, 19 limpeza dos eventos do aparelho (LGPD), 20 código repetido no servidor.
- [ ] Aba de canais com layout novo (definir com mockup).
- [ ] Mostrar a quantidade de conteúdos (por categoria e no total da aba).
- [ ] **Otimização (TV)**: um testador relatou o app "um pouco pesado" na TV (2026-11-04). Medir antes de mexer
      (tempo de abertura, rolagem das fileiras e da grade, memória com listas grandes) e atacar o que pesar mais.
- [ ] **Escalabilidade**: app e servidor aguentarem muitos aparelhos e listas grandes (catálogo em IndexedDB em blocos,
      limites e custo do D1/Workers por aparelho ativo, consultas do painel com milhares de aparelhos).

## 5. Outras lojas (depois)
- [ ] Samsung e LG.
- [ ] PC (Microsoft Store, RFC-024): em andamento desde 2026-11-05 (etapas 1-3: janela Electron, CORS, integração).
