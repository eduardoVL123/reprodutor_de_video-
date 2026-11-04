# Google Play — roteiro de envio do Pulse Player

Respostas prontas para o Play Console, na ordem em que ele pede. Complementa [`PUBLICACAO.md`](PUBLICACAO.md)
(textos da loja e informações de teste). Revise cada resposta antes de enviar: as regras da Google mudam.

## Por que apps de IPTV são recusados (e o que fizemos)

| Motivo comum de recusa | Como o Pulse Player responde |
|---|---|
| "Facilita acesso a conteúdo sem licença" | Não traz conteúdo nem lista; aviso legal no primeiro acesso; descrição fala só em "suas próprias listas"; capturas só com a lista de demonstração (Blender, CC BY). Nada de logos de canais, filmes ou marcas na ficha. |
| "Revisor não conseguiu testar" | Lista de demonstração (`docs/demo`) no botão do login e nas instruções de acesso abaixo. |
| Conteúdo sexual acessível sem barreira | **Controle parental**: categorias com nome adulto começam bloqueadas (PIN), e qualquer categoria pode ser bloqueada ou escondida por perfil. Itens bloqueados não aparecem no Início nem na busca. |
| Pagamento fora do faturamento da Google | O AAB da Play é gerado com `VITE_LICENSE_STORE_BUILD=1`: sem preço, sem QR e sem link de pagamento dentro do app (a tela de ativação diz "fale com seu fornecedor"). O CI já faz isso. |
| Política de privacidade ausente ou genérica | [`PRIVACY.md`](../../PRIVACY.md), específica deste app (falta preencher contato e data). |

## 1. Antes de criar o app no console

- [ ] **Chave de publicação**: gere fora do repositório e cadastre `PULSE_KEYSTORE_BASE64`, `PULSE_KEYSTORE_PASSWORD`,
      `PULSE_KEY_ALIAS`, `PULSE_KEY_PASSWORD` nos Secrets do GitHub. O CI passa a gerar o AAB assinado.
- [ ] **Play App Signing**: aceite no console (a Google guarda a chave final; a sua vira chave de upload).
- [ ] **Variáveis do CI**: `PULSE_DEMO_PLAYLIST_URL` (link "raw" de `docs/demo/pulse-demo.m3u`) e, se a licença estiver
      no ar, `PULSE_LICENSE_BASE_URL` e `PULSE_LICENSE_PUBLIC_KEY`.
- [ ] **Versão**: suba `versionCode` (hoje 3) a cada envio, em `android/app/build.gradle`.

## 2. Configurar o app (Painel → "Configurar o app")

| Pergunta | Resposta |
|---|---|
| Acesso ao app | "Todas ou algumas funcionalidades são restritas" → instruções: *"O app não traz conteúdo. Na tela de login, toque em 'Experimentar com vídeos de demonstração' (filmes Blender, CC BY). No controle parental, o primeiro PIN digitado (4 a 8 números) vira o PIN do aparelho."* |
| Anúncios | Não contém anúncios. |
| Classificação do conteúdo (IARC) | Categoria "Todos os outros tipos de app" / utilitário de mídia. Conteúdo gerado pelo usuário/acesso a conteúdo de terceiros: **sim** (listas do usuário). Violência, sexo etc. no próprio app: não. Informe que há controle parental. |
| Público-alvo | **18+** (ou 16+). Não marque crianças: evita as regras da Família, que o app não cumpre por tocar listas de terceiros. |
| App de notícias | Não. |
| Apps governamentais / financeiros / saúde | Não. |
| Segurança dos dados | Ver seção 3. |
| Política de privacidade | Link público do `PRIVACY.md` (depois do push o link do GitHub serve). |

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
