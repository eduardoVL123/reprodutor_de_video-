# Google Play — roteiro de envio do Pulse Player

Respostas prontas para o Play Console, na ordem em que ele pede. Complementa [`PUBLICACAO.md`](PUBLICACAO.md)
(textos da loja e informações de teste). Revise cada resposta antes de enviar: as regras da Google mudam.

## Por que apps de IPTV são recusados (e o que fizemos)

| Motivo comum de recusa | Como o Pulse Player responde |
|---|---|
| "Facilita acesso a conteúdo sem licença" | Não traz conteúdo nem lista; aviso legal no primeiro acesso; descrição fala só em "suas próprias listas"; capturas só com a lista de demonstração (Blender, CC BY). Nada de logos de canais, filmes ou marcas na ficha. |
| "Revisor não conseguiu testar" | Lista de demonstração (`docs/demo`) no botão do login e nas instruções de acesso abaixo. |
| Conteúdo sexual acessível sem barreira | **Controle parental**: categorias com nome adulto começam bloqueadas (PIN), e qualquer categoria pode ser bloqueada ou escondida por perfil. Itens bloqueados não aparecem no Início nem na busca. Desde a 2.3, o PIN só é criado no Controle parental (antes, o primeiro número digitado na categoria virava o PIN) e um perfil novo segue as escolhas do Principal. |
| Pagamento fora do faturamento da Google | O AAB da Play é gerado com `VITE_LICENSE_STORE_BUILD=1`: sem preço, sem QR e sem link de pagamento dentro do app (a tela de ativação diz só "use o código abaixo para ativar este aparelho", sem citar vendedor). O CI já faz isso. |
| Política de privacidade ausente ou genérica | [`PRIVACY.md`](../../PRIVACY.md), específica deste app, publicada em `https://pulseplayer.com.br/privacidade` e com link dentro do app (Conta → Política de privacidade). |

## 1. Antes de criar o app no console

- [x] **Chave de publicação**: gerada fora do repositório; `PULSE_KEYSTORE_BASE64`, `PULSE_KEYSTORE_PASSWORD`,
      `PULSE_KEY_ALIAS`, `PULSE_KEY_PASSWORD` nos Secrets do GitHub. O CI gera o AAB assinado.
- [ ] **Play App Signing**: aceite no console (a Google guarda a chave final; a sua vira chave de upload).
- [x] **Variáveis do CI**: `PULSE_DEMO_PLAYLIST_URL`, `PULSE_LICENSE_BASE_URL` e `PULSE_LICENSE_PUBLIC_KEY`.
- [ ] **Versão para enviar: 2.3 (`versionCode` 6)**, com as correções de 2026-11-09 (PIN parental, senha sem
      rebaixar para http, licença revisada a cada 6 h, erros explicados). Sai do CI ao fazer merge na `main`; baixar o
      artefato `app-release` da execução (traz o APK e o AAB) e enviar esse AAB. A 2.2 abaixo **não** tem essas correções.
- [x] **Versão anterior**: `versionCode` 5 / `versionName` 2.2, assinada pelo CI em 2026-11-06.
      Para upload na Play, usar `C:\dev\android\release-2.2-2026-11-06\pulse-player-2.2-play.aab`.
      Para instalação direta, usar `C:\dev\android\release-2.2-2026-11-06\pulse-player-2.2-release.apk`.
      [CI](https://github.com/eduardoVL123/reprodutor_de_video-/actions/runs/42304877362) com 1.103 testes,
      lint e build verdes. Assinatura igual à do AAB anterior, `bundletool validate` passou e target SDK 36 conferido.
      AAB com `VITE_LICENSE_STORE_BUILD=1`, APK direto com modo completo. Demonstração publicada e isenta de ativação.
      A validação física da versão nova e as etapas pendentes do Play Console continuam necessárias.

## 2. Configurar o app (Painel → "Configurar o app")

| Pergunta | Resposta |
|---|---|
| Acesso ao app | "Todas ou algumas funcionalidades são restritas" → instruções: *"O app não traz conteúdo. Na tela de login, toque em 'Experimentar com vídeos de demonstração' (filmes Blender, CC BY). A lista de demonstração nunca pede ativação, mesmo depois dos 7 dias de teste. Categorias com nome adulto começam bloqueadas e só abrem depois de criar um PIN (4 a 8 números) no botão 'Controle parental' (cadeado, no celular em pé) das abas Filmes, Séries ou TV."* (texto em inglês na seção 3 de `PUBLICACAO.md`). |
| Anúncios | Não contém anúncios. |
| Classificação do conteúdo (IARC) | Categoria "Todos os outros tipos de app" / utilitário de mídia. Conteúdo gerado pelo usuário/acesso a conteúdo de terceiros: **sim** (listas do usuário). Violência, sexo etc. no próprio app: não. Informe que há controle parental. |
| Público-alvo | **18+** (ou 16+). Não marque crianças: evita as regras da Família, que o app não cumpre por tocar listas de terceiros. |
| App de notícias | Não. |
| Apps governamentais / financeiros / saúde | Não. |
| Segurança dos dados | Ver seção 3. |
| Política de privacidade | `https://pulseplayer.com.br/privacidade` (o mesmo link aparece no app, em Conta). |

## 3. Segurança dos dados (Data safety)

Só vale assim se o build tiver o serviço de licença ligado. Sem `PULSE_LICENSE_BASE_URL`, o app não envia nada ao
desenvolvedor e a resposta é "não coleta dados".

| Pergunta | Resposta |
|---|---|
| O app coleta ou compartilha dados? | Sim (coleta). Não compartilha. |
| Dados criptografados em trânsito? | Sim (HTTPS). |
| O usuário pode pedir exclusão? | Sim — pelo contato da política de privacidade; o painel do dono apaga o aparelho. |
| **Identificadores do dispositivo ou outros IDs** | Coletado; **obrigatório** quando a licença está ligada; finalidade: **funcionalidade do app** e **gerenciamento de conta** (teste de 7 dias e ativação). Hash SHA-256 do ANDROID_ID, nunca o ID cru. |
| **Atividade no app → outras ações** | Domínio do servidor da lista e datas de uso; finalidade: funcionalidade do app (licença). |
| Lista enviada pelo celular/site | Cifrada de ponta a ponta; o desenvolvedor não consegue ler. Pela ajuda da Google, dado que o desenvolvedor não pode acessar não precisa ser declarado — confira antes. |
| Localização, contatos, fotos, áudio, financeiro, saúde | Não coleta. |

## 4. Ficha da loja

- **Nome**: Pulse Player · **Descrição curta** (até 80): *"Reprodutor de vídeo para suas próprias listas M3U e servidores de mídia."*
- **Descrição completa**: seção 2 de `PUBLICACAO.md` + um parágrafo sobre o controle parental.
- **Ícone 512×512**, **imagem de destaque 1024×500** e **banner da TV 320×180**: prontos em `docs/lojas/play/`
  (`icone-512.png`, `destaque-1024x500.png`, `banner-tv-320x180.png`, feitos com a marca em 2026-11-04).
- **Política de privacidade**: `https://pulseplayer.com.br/privacidade` (gerada do `PRIVACY.md`).
- **Capturas**: celular em pé e deitado, tablet e **Android TV** (o app declara leanback; a Google pede capturas de TV
  e o banner 320×180 para aparecer na Play da TV). Use só a lista de demonstração.
- **Categoria**: Vídeo e editores de vídeo (ou Entretenimento).

## 5. Teste fechado (obrigatório em conta pessoal nova)

1. Crie a faixa **Teste fechado**, envie o AAB e adicione os e-mails de pelo menos **12 testadores**.
2. Os 12 precisam ficar **inscritos por 14 dias seguidos** (instalar e abrir de vez em quando).
3. Depois disso o console libera "Solicitar acesso à produção", com um questionário sobre o teste. Responda com o que
   os testadores encontraram e o que foi corrigido.

## 6. Android TV

Ao marcar a distribuição para Android TV, a Google faz uma revisão própria: navegação só com o controle (D-pad),
banner, nada de toque obrigatório, e o botão Voltar funcionando. O app já cumpre; teste o roteiro da seção 6 de
`PUBLICACAO.md` numa Android TV real antes.
