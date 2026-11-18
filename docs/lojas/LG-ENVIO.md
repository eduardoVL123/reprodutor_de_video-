# LG Seller Lounge: kit de envio

Tudo o que vai no envio do Pulse Player para a LG (webOS), pronto para copiar. O plano geral e os riscos estão em
[`SAMSUNG-LG.md`](SAMSUNG-LG.md); os textos da loja em [`PUBLICACAO.md`](PUBLICACAO.md) seção 2.

- Portal de envio: [LG Seller Lounge](https://seller.lgappstv.com) (conta LG do vendedor).
- Regras: [App Self Checklist](https://webostv.developer.lge.com/distribute/app-self-checklist) ·
  [processo de aprovação](https://webostv.developer.lge.com/distribute/app-approval-process).

## 1. Arquivos

| Item | Onde |
|---|---|
| Pacote `.ipk` (build de loja, sem preço nem pagamento) | Artefato **lg-webos** do CI (`.github/workflows/build-apk.yml`, job "Pacote LG webOS"). Nunca use um `.ipk` gerado na máquina: ele sai sem o servidor de licença e sem a chave pública. |
| Ícone da loja 400×400 | [`imagens/lg-icone-400x400.png`](imagens/lg-icone-400x400.png) |
| Capturas 1920×1080 | [`capturas/`](capturas): `1-login`, `2-inicio`, `4-serie`, `5-filme`, `6-player` (a ficha pede de 3 a 5; conferir formato e quantidade no formulário) |
| App Self Checklist | Baixar `documents_for_app_qa.zip` na página do checklist, preencher com a seção 3 abaixo e anexar |
| UX scenario | Seção 2 abaixo |

Versões de webOS no formulário: marcar **webOS 5.0 (2020) em diante**. O app exige Chromium 63, que as TVs de 2019
para trás não têm.

## 2. UX scenario (em inglês, anexar como documento)

> **Pulse Player — UX scenario**
>
> Pulse Player is a video player for the user's own playlists (M3U links or media servers that use the Xtream Codes
> API). The app contains no content and does not sell, recommend or link to any content provider.
>
> **1. First launch.** The terms of use screen explains that the app is a neutral player and that the user is
> responsible for the playlists they add. "Aceitar" (Accept) continues; "Recusar e sair" (Decline and exit) returns to
> the TV.
>
> **2. Add a playlist.** The connection screen asks for a server address or playlist URL, plus optional user and
> password. Shortcut keys (`http://`, `.com`, `:8080`…) speed up typing with the remote. For review, press
> **"Experimentar com vídeos de demonstração"** (Try with demo videos): it loads royalty-free Blender Foundation films
> (CC BY) and public test streams, without typing anything.
>
> **3. Choose a profile.** Each profile keeps its own favorites, history and parental settings.
>
> **4. Home.** A highlight at the top and rows of movies, series and channels. The left menu opens Home, Movies,
> Series, TV, Search, Favorites and Account. Everything works with the arrow keys, OK and Back, and with the Magic
> Remote pointer.
>
> **5. Play.** Selecting a title opens its details; "Assistir" (Watch) starts playback. The on-screen bar has
> play/pause, seek and audio/subtitle options. Back closes the player and returns to the same place.
>
> **6. Parental control.** Categories with adult names start locked. A 4 to 8 digit PIN opens or hides them.
>
> **7. License.** After a 7-day trial, the device shows its code and the license status. The license is obtained
> outside the TV; the app shows no prices and no purchase flow. The demo playlist never requires activation.
>
> **8. Exit.** On the home screen, Back calls the system (`platformBack`): webOS shows its own exit pop-up or the Home
> screen, depending on the TV version. The app does not show a second confirmation.

## 3. App Self Checklist (respostas)

| Tema | Resposta |
|---|---|
| Tecla Voltar dentro do app | Volta uma tela; fecha diálogos e o player antes de sair da tela. |
| Tecla Voltar na tela de entrada | Chama `platformBack()` do sistema (`PalmSystem`, injetado pela TV): webOS 6+ mostra o pop-up de sair do sistema; webOS 23-25 vai para o Home. Sem pop-up próprio do app. |
| Teclas de navegação | Setas, OK e Voltar operam tudo. O ponteiro do Magic Remote dá foco ao item sob ele e todo item mostra efeito de seleção. A roda rola as listas verticais. |
| Teclas de mídia | Play, Pause, Stop, Rewind e Fast-forward funcionam no player. |
| Carregamento | Indicador de carregamento em todas as telas; nunca tela preta. Se o app não conseguir iniciar, mostra um aviso com o motivo. |
| Rede | Sem conexão: aviso na tela. No player: erro claro com "Tentar novamente". |
| Conteúdo | Nenhum conteúdo incluído. Conta de teste não é necessária (lista de demonstração, seção 4). |
| Compras e anúncios | **N/A**: nenhuma compra no app, nenhum anúncio. |
| Login de conta própria | **N/A**: o app não tem conta de usuário; os dados da lista são do servidor do próprio usuário. |
| Dados do aparelho | Lê o LGUDID (ACG `deviceinfo.query` declarado no `appinfo.json`) só para o código de licença, guardado em hash. O usuário aceita o aviso no primeiro acesso. |
| Credenciais no pacote | Nenhuma senha, token ou chave privada no código, nem `password`/`token`/`credential` em nome de arquivo (o script de pacote recusa). |

## 4. Campo para o revisor (em inglês)

> The app contains no content. To test it, press **"Experimentar com vídeos de demonstração"** on the connection
> screen. It loads royalty-free Blender Foundation films (CC BY) and public test streams, and never requires
> activation, so it keeps working after the 7-day trial.
>
> Back on the home screen calls the system `platformBack()`: webOS shows its own exit pop-up or the Home screen,
> depending on the TV version.
>
> Parental control: categories with adult names start locked. Open the Movies, Series or TV tab, press
> "Controle parental", create a PIN (4 to 8 digits) and use it to open or hide categories.
>
> The device code shown on the license screen is derived from the LGUDID and stored only as a hash. The user accepts a
> notice about it on first launch.

## 5. Teste antes de enviar (sem TV LG)

Sem TV física, use o **webOS TV Simulator** (Windows): baixe na página
[Simulator](https://webostv.developer.lge.com/develop/tools/simulator-introduction) e abra o `.ipk` ou a pasta
`build/webos`. Ele mostra se o app abre e se o foco funciona, mas não o desempenho, o vídeo nem o LGUDID de uma TV.
Roteiro: [`PUBLICACAO.md`](PUBLICACAO.md) seção 6, itens 2 a 4 e 7.
