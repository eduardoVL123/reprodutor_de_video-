# Samsung e LG: plano de aprovação

**Objetivo:** Pulse Player aprovado e publicado no Brasil na Samsung (Tizen) e na LG (webOS). Enquanto isso não
acontecer, nenhuma outra marca de TV entra na fila.

Conferido em 2026-11-11 contra o código e a documentação oficial. Este documento lista **o que falta**; os textos da
loja, o campo do revisor e o roteiro de teste continuam em [`PUBLICACAO.md`](PUBLICACAO.md) (seções 2, 3 e 6).
Regras de loja mudam: antes de enviar, abra de novo os links da seção 7.

Legenda: 🔴 bloqueia o envio · 🟡 risco de reprovação · 🟢 pronto

## 1. Situação em uma tela

| Frente | Samsung | LG |
|---|---|---|
| Conta de vendedor (CNPJ) | 🟡 existe; **confirmar se é Partner** (1.1) | 🟢 existe |
| Pacote | 🔴 falta certificado e id definitivo | 🟡 gera, mas nunca foi instalado numa TV |
| Teste em TV real | 🔴 nunca feito | 🔴 nunca feito |
| Documentos do revisor | 🔴 App Description File | 🔴 App Self Checklist + UX scenario |
| Imagens da ficha | 🔴 formatos da Samsung não existem | 🔴 ícone 400×400 não existe |
| Formulário de dados (pareamento e licença) | 🔴 respostas não escritas | 🔴 respostas não escritas |
| Classificação etária no Brasil | 🟡 dúvida aberta (2.5) | 🟡 conferir no formulário |
| Licença paga fora da loja | 🟡 maior risco de política (4) | 🟡 idem |

O código de TV está em bom estado (foco, Voltar, rede, carregamento já cobertos em `PUBLICACAO.md` seção 4). O que
falta é quase tudo **papelada, imagens e teste em aparelho**; de código há três pontos pequenos (seção 5).

### 1.1 Primeira coisa a fazer hoje

Na Samsung, vendedor **Public só publica nos EUA**; para o Brasil a conta precisa ser **Partner**. Entre no Seller
Office → *Membership → Partnership*. Se não for Partner, peça agora: o formulário exige o e-mail de um Samsung
Content Manager (se não tiver, pergunte em *Support → 1:1 Q&A*). É a etapa que mais demora e não depende de nós.

## 2. Samsung (Tizen)

### 2.1 Pacote e certificado 🔴

- [`scripts/package-tv.mjs:14`](../../scripts/package-tv.mjs) usa o id de teste `PulsePlay1`. Para a loja: criar o
  perfil de certificado **Samsung** (não o Tizen genérico) no Tizen Studio / Certificate Manager, com certificado de
  distribuidor **Public** (o privilégio `productinfo` do [`config.xml:18`](../../platforms/tizen/config.xml) é nível
  público, não precisa de Partner), e gerar com `PULSE_TIZEN_PACKAGE_ID` = o id de 10 caracteres do certificado.
- Guardar o `.p12` do autor fora do Git e com backup: sem ele não dá para publicar atualização.
- Não existe job de CI para Tizen/webOS (só o APK). Por enquanto o `.wgt` sai da máquina local:
  `npm run build:tizen` com as mesmas variáveis da Play (`VITE_DEMO_PLAYLIST_URL`, `VITE_PAIR_BASE_URL`,
  `VITE_LICENSE_BASE_URL`, `VITE_LICENSE_STORE_BUILD=1`) e depois `tizen package -t wgt -- build/tizen`.
- `required_version="5.0"` ([`config.xml:9`](../../platforms/tizen/config.xml)) = TVs 2019 em diante. No Seller
  Office, pedir **só os grupos de modelo 2019+**; cada grupo é testado separado e pode reprovar sozinho.

### 2.2 Ficha no Seller Office 🔴

| Item exigido | Temos? |
|---|---|
| Título igual ao `<name>` do `config.xml` ("Pulse Player") | 🟢 [`config.xml:13`](../../platforms/tizen/config.xml) |
| Descrição por idioma (até 4000 caracteres) | 🟢 `PUBLICACAO.md` seção 2 (pt-BR e en) |
| Tags: mínimo 3 por idioma | 🔴 escrever (sem "IPTV", sem marcas) |
| Ícone 1920×1080: logo PNG 32 bits transparente + fundo PNG/JPG, ≤300 KB cada | 🔴 `npm run icons` só gera o 117×117 do pacote |
| Ícone 512×423 PNG ≤300 KB | 🔴 |
| Imagem de fundo 1920×1080 JPG ≤2 MB (conteúdo nos 60% da direita) | 🔴 |
| **Exatamente 4** capturas JPG 1920×1080 ≤500 KB | 🟡 há `capturas/tv-1..4` e `1..6`, mas em **PNG**: converter e refazer com a lista de demonstração |
| Categoria (Videos) e classificação etária | 🟡 ver 2.5 |
| URL da política de privacidade | 🟢 `https://pulseplayer.com.br/privacidade` |
| Dados do vendedor (CNPJ, e-mail de suporte, site, telefone, endereço) | conferir no cadastro |
| Países | começar **só com Brasil** (app de vídeo tem restrição para "global" e China) |
| Cobrança | ver seção 4 antes de marcar "Free" |
| Feature info → **Player**: codecs, contêiner, DRM, motor de streaming, legendas | 🔴 preencher: HLS via `hls.js` 1.7 + `<video>` nativo, sem DRM; listar os formatos que `useVideoEngine` realmente toca |
| Geo IP Block | não usamos: declarar "não" |
| Conta de teste | não se aplica: usar o texto de `PUBLICACAO.md` seção 3 (botão de demonstração) |

### 2.3 App Description File 🔴

Documento obrigatório (PPT/PDF, em inglês) com o fluxo do app e os cenários de uso; sem ele a pré-verificação
reprova. Conteúdo mínimo:

1. O que é o app em uma frase e a frase "no content included".
2. Mapa de telas com captura de cada uma: primeiro acesso → login → início → TV/Filmes/Séries → detalhes → player →
   busca → perfis → controle parental → conta.
3. Tabela de teclas do controle: setas, OK, Voltar, Exit, Play/Pause/Stop/Rewind/FF e **Channel Up/Down**
   (registradas em [`spatialNavigation.js:239-248`](../../src/utils/spatialNavigation.js)); dizer que teclas de cor e
   numéricas não têm função.
4. Como testar sem conta: botão "Experimentar com vídeos de demonstração".
5. Pareamento pelo celular e licença/ativação: o que são, que são opcionais para o teste, que dado sai da TV.
6. Privilégios e por quê: `internet`, `tv.inputdevice`, `productinfo` (CO-IN-03/04 confere se batem com a ficha).
7. Por que `access origin="*"` ([`config.xml:23`](../../platforms/tizen/config.xml)): o usuário informa o próprio
   servidor.

### 2.4 Checklist: itens que o guia atual não cobre 🟡

`PUBLICACAO.md` seção 4 cobre 14 dos 66 itens. Tirando slideshow e help bar (não se aplicam), faltam verificar **na
TV**:

| ID | O que testar |
|---|---|
| CO-GE-03 | Uso prolongado sem degradar (o roteiro pede 1 h; manter) |
| CO-GE-05 | Sair e reabrir (pelas **duas** teclas, Voltar e Exit): abre normal |
| CO-GE-06 / CO-GE-08 | Desligar a TV durante carregamento e durante o vídeo; ao religar, app abre na tela anterior ou nos detalhes |
| CO-MT-02 | O canal de TV que estava antes de abrir o app é o mesmo ao sair |
| CO-MT-03 | Segundo plano + cair a rede + voltar: o vídeo retoma |
| CO-MT-04 | Desinstalar e reinstalar: volta ao primeiro acesso |
| CO-SO-03..07 | App corta o áudio do canal; mudo ligado antes de abrir continua valendo; só uma interface de mudo |
| CO-US-01 | Tecla sem função não faz nada nem pisca a tela (testar todas, inclusive no player) |
| CO-US-06 | Teclas numéricas, lista de canais e guia não causam nada estranho |
| CO-US-07 | Teclas de cor sem função não respondem |
| CO-KI-06/07 | Teclado USB/Bluetooth: ligar, desligar e religar com o app aberto |
| CO-UI-01 | Ícone no Smart Hub sem corte e com destaque normal |
| CO-UI-07 | Entrar e sair das telas com OK/Voltar várias vezes seguidas |
| CO-SE-02 | Busca por palavra-chave traz resultados relacionados |
| CO-IN-02 | "Abrir agora" logo após instalar |

### 2.5 Classificação etária no Brasil 🟡 (dúvida aberta)

A página de cadastro da Samsung diz que o Brasil exige limite de idade e certificado MJ/DEJUS (ClassInd); a página de
classificação só detalha jogos e diz que, sem classificação oficial, o app cai em 18+. Não está claro o que vale
para um reprodutor sem conteúdo. **Perguntar no 1:1 Q&A antes de enviar**, citando o controle parental com PIN.

## 3. LG (webOS)

### 3.1 Pacote 🟡

- [`appinfo.json`](../../platforms/webos/appinfo.json) está coerente: id `com.pulseplayer.app`, 1920×1080,
  ícones 80×80 e 130×130 no pacote. Gerar com `npm run build:webos` + `ares-package build/webos` (mesmas variáveis do
  item 2.1).
- Piso real: Chromium 63 ([`vite.config`](../../vite.config.js) linha 32) = **webOS 5.0 (2020) em diante**. No Seller
  Lounge, não marcar versões anteriores.

### 3.2 Documentos 🔴

- **App Self Checklist:** baixar `documents_for_app_qa.zip` na página oficial, preencher e anexar. Sem ele a LG pode
  reprovar **sem testar**. As respostas-base estão em `PUBLICACAO.md` seção 5; marcar N/A só no que não existe
  (compras, anúncios, conta própria).
- **UX scenario:** o mesmo conteúdo do App Description File da Samsung (2.3). Escrever uma vez, exportar duas.

### 3.3 Ficha no Seller Lounge 🔴

- Ícone da loja **400×400** ou maior (o portal recusa menor): não existe, criar a partir do kit da marca.
- Capturas: as fontes divergem em quantidade e tamanho (1920×1080 ou 1280×720, de 3 a 5). Conferir no formulário na
  hora e usar as mesmas da Samsung.
- Textos e campo do revisor: `PUBLICACAO.md` seções 2 e 3.

### 3.4 Regras obrigatórias de UX

| Regra da LG | Situação |
|---|---|
| Setas, OK e Voltar operam tudo | 🟢 navegação espacial; 📺 confirmar na TV |
| **Ponteiro do Magic Remote** opera tudo com OK, e todo item mostra efeito de seleção | 🟡 simulado no navegador em 2026-11-11 (eventos de mouse sintéticos, 1920×1080): em perfis, início, TV, Filmes, Séries, Favoritos, Conta, Busca, detalhes e player, todo item inteiro sob o ponteiro recebe o foco e tem classe de destaque. Exceção conhecida: o card cortado na borda direita de uma fileira não ganha destaque (o clique funciona e a seta da fileira aparece). **Falta ver o destaque com os olhos na TV** |
| Roda do Magic Remote rola as listas no sentido certo | 🟡 as listas verticais usam rolagem nativa (`overflow-y: auto`), então a roda segue o sentido do sistema; fileiras horizontais andam pelas setas laterais. Falta confirmar na TV |
| Texto ≥ 20 px e botões ≥ 75×75 px em 1080p (**recomendação**, não obrigatório) | 🟢 texto (`text-tv-xs` = 20 px); 🟡 botões: medido em 1920×1080 (2026-11-11), o padrão do app é ~50 px de altura (login 54, destaque 51, menu 88×56, chips de endereço 42) e os "Ver todos" da tela inicial têm **28 px**. Para o ponteiro, o caso a corrigir é o "Ver todos"; o resto só muda se a LG reclamar |
| Indicador de carregamento em vez de tela preta | 🟢 |
| Player controlável só pelo menu na tela | 🟢 |
| **Voltar na tela de entrada** | 🟡 ver 3.5 |
| Sem senha/token fixo no código e sem `password`/`token`/`credential` em **nome de arquivo** | 🟢 credenciais do mock não estão em `src/`; 🟡 conferir os nomes dentro de `build/webos/assets` antes de empacotar |

### 3.5 Tecla Voltar: a documentação da LG se contradiz 🟡

- Guia da tecla Voltar: webOS 6+ mostra **pop-up de sair**; webOS 5 ou menor vai para o Home.
- Página do App Self Checklist: em webOS 23–25, Voltar na tela de entrada **deve mostrar o Home**.

Hoje o app mostra o próprio "Sair do Pulse Player?" e, ao confirmar, fecha com `window.close()`
([`platform.js:34-35`](../../src/services/platform.js)). O ramo `webOS.platformBack()` das linhas 30-31 **nunca roda**:
a biblioteca `webOSTV.js` não está no pacote (`headScripts: []` em
[`package-tv.mjs:19`](../../scripts/package-tv.mjs)), ao contrário do que diz `PUBLICACAO.md:107`.

Decisão recomendada: incluir `webOSTV.js` e, **só na LG**, trocar o nosso pop-up por `webOS.platformBack()` direto na
tela de entrada. Aí quem decide entre pop-up e Home é o próprio sistema, e ficamos certos nas duas leituras da regra.
Validar na TV antes de enviar.

### 3.6 Identificador do aparelho

A licença lê o LGUDID ([`deviceIdentity.js:28-43`](../../src/services/deviceIdentity.js)). A LG exige consentimento do
usuário: é dado no aviso do primeiro acesso. Declarar isso no checklist e no formulário de dados.

## 4. Riscos de política (valem para as duas) 🟡

1. **Licença paga fora da loja.** **Decisão (2026-11-11): a venda fica fora do app**, igual à Play. Os pacotes saem
   com `VITE_LICENSE_STORE_BUILD=1` (sem preço nem QR de pagamento), a ficha marca cobrança "Free" e o formulário
   declara que existe ativação de licença feita fora da TV. A tela pós-teste fala em "ativar este aparelho", nunca em
   comprar ou assinar. Nenhuma página oficial autoriza nem proíbe isso por escrito: mandar as perguntas de 4.1 e só
   enviar o app depois da resposta. Samsung Checkout / Paymentwall ficam para depois da aprovação, se fizer sentido.
2. **Reprodutor de lista do usuário.** É a categoria que essas lojas mais derrubam. Defesas que já temos e precisam
   aparecer na ficha e nos documentos: nenhum conteúdo incluso, lista de demonstração com filmes livres, aviso legal
   no primeiro acesso, controle parental, nada de "IPTV" nem nomes de canais em textos e capturas.
3. **Capturas.** Só com a lista de demonstração. Qualquer logo de emissora ou pôster comercial numa captura reprova.
4. **Dados.** Escrever uma vez as respostas de pareamento (`PUBLICACAO.md` seção 7) e licença (`PUBLICACAO.md:16`:
   DUID/LGUDID em hash, domínio da lista, datas, guarda de 24 meses) e colar nas duas lojas.

### 4.1 Perguntas para as lojas (mandar antes de enviar o app)

Em inglês, prontas para colar. Guardar as respostas (captura ou e-mail): servem de defesa numa reprovação.

**Samsung** — Seller Office → *Support → 1:1 Q&A*:

> We are preparing to submit "Pulse Player", a video player for the user's own M3U playlists and media servers. The
> app includes no content. We have four questions before submission:
>
> 1. The app has a 7-day free trial. After that, the device must be activated with a license that the user obtains
>    outside the TV (on our website or from a reseller). The TV app shows no prices, no purchase flow and no payment
>    QR code or link; it only shows the license status and a device code. Is this model allowed with Billing set to
>    "Free" (not using Samsung Checkout)?
> 2. On the activation screen, may we display our website address as text (for example "Activate this device at
>    pulseplayer.com.br"), or must the screen show only the device code with no URL?
> 3. To generate the device code we read the DUID through the public `productinfo` privilege and store only a hash
>    of it. Is any additional declaration or consent required for this?
> 4. For distribution in Brazil: the app is a player without any content and has a PIN-based parental control. Which
>    age rating should we select, and is an MJ/DEJUS (ClassInd) certificate required for this kind of app?

**LG** — Seller Lounge → *1:1 QA* (ou o contato do portal de desenvolvedores):

> We are preparing to submit "Pulse Player", a video player for the user's own M3U playlists and media servers. The
> app includes no content. We have four questions before submission:
>
> 1. The app has a 7-day free trial. After that, the device must be activated with a license that the user obtains
>    outside the TV (on our website or from a reseller). The TV app shows no prices, no purchase flow and no payment
>    QR code or link; it only shows the license status and a device code. Is this allowed for a free app, without
>    integrating an in-app purchase solution?
> 2. On the activation screen, may we display our website address as text (for example "Activate this device at
>    pulseplayer.com.br"), or must the screen show only the device code with no URL?
> 3. Back button on the entry page: the Back Button guide says webOS TV 6.0+ should show an exit popup, while the App
>    Self Checklist page says the Home screen must be shown on webOS 23–25. If we call `webOS.platformBack()` on the
>    entry page for all versions, is that compliant?
> 4. The device code is derived from the LGUDID (stored only as a hash); the user accepts a notice on first launch
>    that explains this. Is that notice sufficient as user consent?

Se a resposta à pergunta 2 for "sem URL", a tela de ativação do build de loja mostra só o código do aparelho e o texto
"ative com o seu fornecedor da licença".

## 5. O que é código (pequeno)

| # | Mudança | Por quê |
|---|---|---|
| 1 | Incluir `webOSTV.js` no pacote webOS e usar `platformBack()` na tela de entrada | 3.5 |
| 2 | Corrigir o que o teste em TV achar no ponteiro/roda do Magic Remote | 3.4 |
| 3 | ~~Gerar as imagens de loja em `npm run icons`~~ feito: [`imagens/`](imagens) (logo e fundo 1920×1080, 512×423, LG 400×400). Falta a imagem de fundo da Samsung e as capturas em **JPG** (o script só escreve PNG) | 2.2 e 3.3 |
| 4 | ~~Guarda do pacote~~ feito: `package-tv.mjs` falha se houver `password`/`token`/`credential` em nome de arquivo ou chave privada no bundle | 3.4 |
| 5 | ~~Teclas de cor e numéricas sem efeito~~ coberto por teste (`tests/spatialNavigation.test.js`) | 2.4, CO-US-06/07 |

Nada disso deve ser feito antes do primeiro teste em TV: ele vai dizer o que realmente quebra.

## 6. Ordem de trabalho

1. **Hoje:** conferir/pedir Partner na Samsung (1.1) e mandar as perguntas de 4.1 para as duas lojas.
2. Ativar o modo desenvolvedor numa TV Samsung 2019+ e numa LG 2020+; instalar os dois pacotes.
3. Rodar o roteiro de `PUBLICACAO.md` seção 6 + a tabela 2.4 + o ponteiro do Magic Remote (3.4). Anotar tudo.
4. Corrigir o que aparecer + os itens da seção 5.
5. Ajustar a tela de ativação conforme a resposta das lojas (4.1, pergunta 2).
6. Capturas finais, imagens de loja, tags.
7. Escrever o documento de fluxo (2.3) e preencher o App Self Checklist (3.2).
8. Certificado Samsung e pacotes finais.
9. Enviar. Em reprovação, a loja devolve um relatório por item: corrigir só o apontado e reenviar.

**Sem TV física** dá para adiantar 1, 5, 6 e 7; os emuladores (Tizen Studio e webOS Simulator) servem para foco e
teclas, mas não valem para rede, energia, som e Magic Remote.

## 7. Fontes

- Samsung: [checklist comum (66 itens)](https://developer.samsung.com/smarttv/develop/development-checklist/common.html) ·
  [dados do cadastro do app](https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html) ·
  [virar Partner](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-partner.html) ·
  [classificação etária](https://developer.samsung.com/tv-seller-office/checklists-for-distribution/age-rating.html)
- LG: [App Self Checklist](https://webostv.developer.lge.com/distribute/app-self-checklist) ·
  [tecla Voltar](https://webostv.developer.lge.com/develop/guides/back-button) ·
  [processo de aprovação](https://webostv.developer.lge.com/distribute/app-approval-process)

Não consegui abrir a página da Samsung sobre o "Application UI Description" nem a lista de imagens do LG Seller
Lounge (404): o conteúdo de 2.3 e os tamanhos de 3.3 vêm de fontes secundárias e precisam ser conferidos nos portais.
