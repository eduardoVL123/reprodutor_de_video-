# Publicação nas lojas (Samsung, LG, Google Play)

Guia do que enviar e do que testar antes. Fontes: [checklist comum Samsung](https://developer.samsung.com/smarttv/develop/development-checklist/common.html),
[encerramento de apps Samsung](https://developer.samsung.com/tv/develop/guides/fundamentals/terminating-applications),
[tecla Voltar LG](https://webostv.developer.lge.com/develop/guides/back-button),
[App Self Checklist LG](https://webostv.developer.lge.com/distribute/app-self-checklist).

## 1. Antes de enviar

| Item | Como | Situação |
|---|---|---|
| Política de privacidade com link público | Preencha data e contato em [`PRIVACY.md`](../../PRIVACY.md); depois do push o link do arquivo no GitHub já serve | falta preencher |
| Lista de demonstração para o revisor | Publique [`docs/demo/pulse-demo.m3u`](../demo/pulse-demo.m3u) (link "raw" do GitHub) e gere o build com `VITE_DEMO_PLAYLIST_URL` (CI: variável `PULSE_DEMO_PLAYLIST_URL`) | pronto (link raw publicado; variável criada em 26/10/2026) |
| Serviço de pareamento pelo celular (opcional, RFC-016) | Publicar [`server/pair`](../../server/pair/README.md#publicar) com HTTPS (`server/pair/deploy`) e gerar o build com `VITE_PAIR_BASE_URL` (CI: variável `PULSE_PAIR_BASE_URL`); sem isso o build não oferece o pareamento e nada nesta linha se aplica. Antes de enviar, preencha em [`PRIVACY.md`](../../PRIVACY.md) o endereço do serviço e o prazo de registros do provedor de hospedagem | falta |
| Declarar o serviço de pareamento nos formulários das lojas | Seção 7 | falta |
| Certificado Samsung | `PULSE_TIZEN_PACKAGE_ID` + perfil de certificado no Tizen Studio | falta |
| Questionário da LG (App Self Checklist) | Baixe o arquivo oficial no link acima e preencha com a seção 5; sem ele a LG recusa antes do teste | falta |
| Teste em TV real ou emulador | Roteiro da seção 6 | falta |
| Capturas de tela 1920×1080 | [`capturas/`](capturas) (servidor de teste com fotos livres; troque se a loja pedir outro tamanho) | pronto |

## 2. Textos da loja

Não use "IPTV", nomes de canais, emissoras, marcas de terceiros nem prometa conteúdo.

**Nome:** Pulse Player

**Resumo (pt-BR):** Reprodutor de vídeo para as suas próprias listas de reprodução.

**Descrição (pt-BR):**
> Pulse Player é um reprodutor de vídeo para TV. Ele não inclui nenhum conteúdo: você informa o endereço de uma
> lista de reprodução (M3U) ou de um servidor de mídia que você já tem, e o Pulse Player organiza e reproduz.
>
> • Canais, filmes e séries em fileiras, com busca
> • Continuar assistindo e próximo episódio automático
> • Perfis e Minha lista
> • Navegação feita para o controle remoto
>
> Você é responsável pelas listas que adiciona. O Pulse Player não fornece, hospeda nem vende conteúdo.

*Só em builds com o pareamento (seção 7), acrescente à lista de destaques:* "• Adicione sua lista pelo celular, sem digitar no controle".

**Summary (en):** Video player for your own playlists.

**Description (en):**
> Pulse Player is a video player for TV. It does not include any content: you enter the address of a playlist (M3U)
> or media server you already have, and Pulse Player organizes and plays it.
>
> • Live, movies and series in rows, with search • Continue watching and automatic next episode
> • Profiles and My list • Navigation designed for the remote control
>
> You are responsible for the playlists you add. Pulse Player does not provide, host or sell content.

## 3. Informações de teste (campo para o revisor)

> The app contains no content. To test it, press **"Experimentar com vídeos de demonstração"** on the login screen
> (or enter the demo playlist URL in the first field, user and password empty). It loads royalty-free Blender
> Foundation films (CC BY) and public test streams. Back on the home screen asks "Sair do Pulse Player?";
> "Sair" closes the app.

*Só em builds com o pareamento, acrescente:*

> The login screen also shows an optional "Use o seu celular" (use your phone) panel with a QR code: it lets a user
> send a playlist link from a phone instead of typing it with the remote. You do not need it to test the app: the demo
> button above works without it, and if that service is unreachable the app keeps working with the on-screen keyboard.

## 4. Checklist comum da Samsung

✅ = feito e verificado no código/navegador · 📺 = verificar na TV antes de enviar

| ID | O que a Samsung testa | Pulse Player |
|---|---|---|
| CO-US-05 | Voltar fecha pop-ups, volta uma página; na tela inicial pergunta antes de sair | ✅ `ExitConfirm.vue` (Tizen, webOS e APK) · 📺 |
| CO-US-04 | Tecla Exit fecha o app | ✅ não registramos a tecla (o sistema fecha) · 📺 |
| CO-GE-07 / CO-MT-01 | Smart Hub manda para segundo plano; ao voltar, mesmo estado | ✅ pausa ao sair (`onAppBackground`) · 📺 retomar |
| CO-CN-01/02 | Sem internet: aviso, sem travar; some ao reconectar | ✅ `NetworkStatus` + reconexão do player · 📺 |
| CO-CN-03 | Indicador de carregamento | ✅ |
| CO-GE-01 | Resposta em até 30 s | ✅ vídeo que nunca começa mostra erro em ~25 s |
| CO-US-02 | Voltar e Stop funcionam durante o carregamento | ✅ · 📺 |
| CO-UI-04/06/09 | Foco chega em todos os itens, nunca some, sem foco duplo | ✅ varredura automática em todas as telas (TV, notebook, PC) |
| CO-UI-13 | Miniatura alternativa quando não há imagem | ✅ inicial do título no lugar |
| CO-SE-01 | Busca vazia mostra mensagem | ✅ |
| CO-SO-* | Volume e mudo | ✅ teclas de volume não são registradas (a TV cuida) · 📺 |
| CO-KI-* | Teclado da TV (IME) | ✅ campos com modo de edição · 📺 limite de caracteres e caracteres especiais |
| CO-PR-01 | Dados apagados ao desinstalar | ✅ tudo fica no armazenamento do app |
| CO-PL-01 | Pré-carregamento | 📺 |

## 5. LG (respostas para o App Self Checklist)

- **Tecla Voltar:** volta uma página; na tela de entrada mostra "Sair do Pulse Player?" (webOS 6+). Em webOS 5 ou
  anterior a LG pede voltar ao launcher: com a biblioteca `webOSTV.js` incluída o app chama `webOS.platformBack()`.
- **Teclas de navegação:** todas operáveis (setas, OK, Voltar; ponteiro do Magic Remote dá foco ao item sob ele).
- **Conteúdo:** nenhum incluído; conta de teste não é necessária (lista de demonstração na seção 3).
- **Rede:** aviso de sem conexão; erro claro com "Tentar novamente" no player.
- Marque N/A só no que realmente não existe no app (sem compras, sem anúncios, sem login de conta própria).

## 6. Roteiro de teste na TV (antes de cada envio)

1. Instale pelo Tizen Studio / webOS CLI e abra pelo menu de apps.
2. Primeiro acesso → aceitar → "Experimentar com vídeos de demonstração".
3. Navegue por todas as abas só com o controle; confirme que o foco nunca some.
4. Toque um filme, avance, pause, Stop. Toque um canal. Abra a fila.
5. No meio do vídeo aperte Home/Smart Hub, volte ao app: deve estar pausado no mesmo ponto.
6. Tire o cabo de rede no meio do vídeo: aviso aparece; ligue de novo: aviso some e o vídeo volta.
7. Na tela inicial aperte Voltar: aparece "Sair do Pulse Player?"; "Cancelar" volta, "Sair" fecha.
8. Volume, mudo e Exit do controle durante o vídeo.
9. Deixe tocando 1 hora: sem travar nem fechar.

Só em builds com o pareamento (seção 7):

10. Na tela de login, o foco já começa em "Novo código". Do sofá (uns 3 m), escaneie o QR com a câmera de um celular:
    **se não ler**, aumente o QR (`qrRem` do `PairPanel`) antes de enviar. Repita no Gerenciador de Listas (QR menor).
11. No celular, cole um link de lista e envie: a TV mostra "Adicionar esta lista?" com o servidor certo; "Adicionar"
    entra na lista e "Descartar" pede outro código. Confirme que a senha nunca aparece na tela.
12. Deixe o código vencer (10 min): aparece "O código expirou" e "Gerar novo código" funciona só com o controle.
13. Tire a TV da internet e abra o login: aparece o erro do pareamento e o login manual continua funcionando.

## 7. Pareamento pelo celular nas lojas (RFC-016 e RFC-017)

Vale só para builds gerados com `VITE_PAIR_BASE_URL` (hospedado no Cloudflare Workers, RFC-017). **As respostas abaixo são uma proposta: confirme na documentação
atual de cada loja e com o seu jurídico antes de enviar**, porque as regras e os formulários mudam.

| Onde | O que declarar |
|---|---|
| Política de privacidade (todas as lojas) | O link público de [`PRIVACY.md`](../../PRIVACY.md) já descreve o serviço; preencha o endereço do serviço e o prazo de registros do provedor de hospedagem (campos entre colchetes). |
| Google Play, "Segurança dos dados" (Data safety) | O app envia ao serviço, só se o usuário escolher o pareamento, a lista e as credenciais **cifradas de ponta a ponta** (o desenvolvedor não tem a chave) e o IP, só em memória, por até 1 minuto. Não há conta, anúncios nem análise de uso. Confira na ajuda do Google Play como ele trata dado cifrado de ponta a ponta e processamento efêmero antes de marcar "coleta" ou "não coleta". |
| Samsung Seller Office e LG Seller Lounge | Se o formulário perguntar sobre servidores externos ou coleta de dados, informe o endereço do serviço e que ele é opcional, usado só para o pareamento, sem armazenar dado legível. O revisor não precisa dele (seção 3). |
| Ficha da loja | Pode citar "adicione sua lista pelo celular" (seção 2). Não prometa conteúdo nem use "IPTV". |
| Aviso legal do app | Já muda sozinho conforme o build (`src/views/FTUE.vue`); `FTUE_VERSION` foi para 3, então quem aceitou antes vê o aviso de novo. |

Se o serviço sair do ar depois da publicação, o app não quebra (o login manual continua), mas a opção mostra erro:
mantenha o serviço monitorado e o domínio renovado.
