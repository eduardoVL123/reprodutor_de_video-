# RFC-014 — Neutro TV 2.0: visual premium com menu lateral

> **Como usar:** cole este arquivo inteiro como primeira mensagem em um novo chat do Claude Code aberto na pasta
> `reprodutor_de_video`. Tudo o que o novo chat precisa saber está aqui.

---

## Prompt

Você vai implementar o redesign "2.0" do Neutro TV, um reprodutor de mídia para Smart TVs (Samsung Tizen, LG webOS,
Android TV) e celular/tablet Android. O objetivo é o usuário sentir que está num streaming pago (Netflix, HBO Max,
Prime Video), usando o layout **B — menu lateral recolhido** já aprovado pelo dono do produto.

Antes de qualquer código:

1. Leia `CLAUDE.md` do usuário (regras globais) e este RFC inteiro.
2. Abra `docs/design-2.0/mockups.html` no navegador. As telas aprovadas são as rotuladas **"B · Início com menu
   lateral"**, **"Detalhes de série"** e **"Player"**. As telas "A" mostram o menu no topo, que **não** foi escolhido,
   mas o comportamento das fileiras ("Rolando para baixo") vale também para o layout B.
3. Rode `npm install`, `npm run lint` e `npm test` e confirme que está tudo verde antes de mexer.
4. Escreva um plano curto (fases abaixo) e siga TDD para lógica; ajustes puramente visuais podem pular TDD.
5. **Não faça commit nem push** até o usuário pedir.

Responda sempre em português do Brasil, cite arquivo e linha, e explique a causa antes de corrigir algo.

---

## Contexto do projeto

- **Stack:** Vue 3 (`<script setup>`), Pinia, vue-router (hash), Tailwind 3, Vite 8, Vitest 5 (jsdom + fake-indexeddb),
  ESLint 9, Capacitor 8 (Android). Node 22+.
- **Comandos:** `npm run dev` (http://localhost:5173), `npm run mock` (servidor falso em http://localhost:8787,
  usuário `teste123`, senha `senha123`, 50 mil canais/filmes), `npm test`, `npm run lint`, `npm run build`,
  `npm run build:tizen`, `npm run build:webos`.
- **Estado do repositório:** branch local `fix/auditoria-geral` com ~55 arquivos alterados e **sem commit** (auditoria,
  correções de segurança, revisão de TV). Não descarte nada disso. 148 testes passando.
- **Telas atuais:** `src/views/FTUE.vue` (aviso legal), `Login.vue`, `Dashboard.vue` (abas Início, TV ao vivo, Filmes,
  Séries, Favoritos e Busca), `src/components/ProfileGate.vue`, `ListManagerModal.vue`, `CatalogBrowser.vue`
  (categorias + grade virtualizada `GridView.vue`), `MediaDetailsModal.vue`, `SearchScreen.vue`,
  `VideoPlayerOverlay.vue`, `NetworkStatus.vue`.
- **Dados:** os itens vêm das listas do usuário (API compatível com Xtream ou playlist M3U), salvos em IndexedDB
  (`src/services/catalogDb.js`) e lidos em janelas (`catalog.getItems(section, categoryId, start, count)`). Capas em
  `item.stream_icon`; detalhes de filme/série (sinopse, fundo, elenco) via `fetchVodInfo` / `fetchSeriesInfo`
  (`src/services/xtreamApi.js`, campo `backdrop`). Listas M3U não têm séries nem fundo: o visual precisa funcionar
  só com o pôster, ou sem imagem nenhuma.

## Regras que não podem quebrar

1. **Navegação por controle remoto** (`src/utils/spatialNavigation.js`):
   - Todo elemento interativo é focável (`button`, `.tv-focusable`, `[tabindex="0"]`) e tem `id` **único**.
   - Grupos de foco com `data-focus-group`; linhas com `data-focus-row`. As setas laterais só trocam de grupo para
     painéis **lado a lado** (é assim que Esquerda na primeira coluna vai para o menu lateral). Baixo prefere itens do
     mesmo grupo.
   - Voltar: modais e player tratam via `registerBackHandler`; em uma aba que não é Início, Voltar vai para Início; no
     Início, Voltar sai do app (`exitApp`, em `src/services/platform.js`).
   - O foco precisa ser **sempre visível**: anel branco com faixa escura (`.tv-focusable:focus` em `src/style.css`).
     Itens focados que crescem (`scale`) não podem ser cortados pelo contêiner.
   - O player abre com foco em Play/Pausa, nunca em "Fechar".
2. **TVs antigas (Chromium 63+):**
   - Sem `backdrop-filter` (ausente antes do Chromium 76): use fundo `rgba` sólido no efeito "vidro".
   - Sem `aspect-ratio` (Chromium 88): use altura fixa ou padding-top.
   - `gap` em flexbox só funciona via o plugin de `tailwind.config.js`. Use as classes `gap-*`, não escreva `gap` em
     CSS à mão, e não coloque texto solto direto dentro de um flex com `gap`: envolva em `<span>`.
   - O build é um script clássico único (`vite.config.js` + `scripts/tv-classic-script.mjs`), sem `import()` dinâmico
     novo. Teste `tests/tvCompat.test.js`.
   - Animações só com `transform`/`opacity`, sem animar `width`/`top`/sombras, e sem `scroll-behavior: smooth` em listas
     longas.
3. **Lojas (Samsung/LG):**
   - Margem de segurança de 5%: conteúdo a pelo menos `6rem` das laterais e ~`3.5rem` de cima/baixo. Fundos podem ir
     até a borda.
   - Nenhum texto menor que `text-tv-xs` (20px em 1080p). Não use `text-[0.xrem]` (há teste).
   - Nada de selos falsos ("4K", "Novo", "Em alta", "Top 10"), curadoria inventada ("Escolhidos para você"), imagens de
     bancos externos ou "IPTV". Só mostre o que vem da lista do usuário (`tests/noExternalPlaceholders.test.js`).
   - Identidade própria: raio vermelho + "NEUTRO TV". Inspirado em streamings, sem copiar marcas: proibidos o "N" da
     Netflix, logos e telas idênticas.
4. **Código:** siga o padrão existente; funções pequenas; sem código morto; nada hardcoded (URLs, portas); comentários
   em português. Lint e testes verdes antes de dizer que terminou. Rode também a auditoria de layout abaixo.

## Especificação do 2.0 (layout B)

### Base visual
- Fundo `#07070a`; tipografia pesada nos títulos (destaque 4rem/900, título de fileira 1.25rem/700); cinzas `#a1a1aa`
  e `#d4d4d8` para metadados; vermelho `#e50914` só para acento (aba ativa, progresso, "AO VIVO").
- Gradientes cinematográficos sobre a arte (vinheta da esquerda e de baixo), como no mockup.
- Card focado: `scale(1.08)`, anel branco e sombra; transição de 150 a 200 ms.

### Menu lateral (substitui o menu do topo)
- Coluna fixa à esquerda (`~6rem`), só com ícones: Busca, Início, TV ao vivo, Filmes, Séries, Minha lista; avatar do
  perfil embaixo e logo (raio) em cima. Item ativo com fundo claro translúcido.
- **Ao receber foco, o menu expande** (`~18rem`) mostrando os nomes ao lado dos ícones, sobre o conteúdo e com
  gradiente; recolhe ao sair. É o comportamento do Google TV e do Prime Video.
- O menu é um `data-focus-group` próprio, ocupando a altura toda (assim Esquerda na primeira coluna de qualquer tela
  chega nele). Lembrar o último item focado.
- Acesso ao Gerenciador de Listas e à troca de perfil: pelo avatar (abre um pequeno menu com "Trocar perfil" e
  "Listas") ou como itens extras no menu. "Sair da conta" continua dentro do Gerenciador de Listas.
- O rodapé atual ("LISTA: …") pode sair: a lista ativa aparece no menu do avatar.

### Início
- **Destaque** ocupando a tela, com o conteúdo à esquerda do menu:
  - Selo pequeno com o raio + "FILME DA SUA LISTA" / "SÉRIE DA SUA LISTA" / "CONTINUAR ASSISTINDO".
  - Título grande (até 2 linhas), linha de metadados (nota, ano, duração ou temporadas, classificação, gênero, só o que
    existir), sinopse curta (3 linhas) e os botões "Assistir" (branco, foco inicial), "Mais informações" ou "Episódios",
    e "Minha lista" (alterna e mostra o estado).
  - Fundo: `backdrop` do item quando houver; senão o pôster ampliado e desfocado com vinheta forte; senão um gradiente
    escuro neutro.
- **Fileiras deslizantes** (horizontais) abaixo, sobrepondo o pé do destaque:
  - "Continuar assistindo": cards 16:9 com barra de progresso e "faltam X min" (canais: selo "AO VIVO").
  - "Filmes da sua lista" e "Séries da sua lista": pôsteres 2:3.
  - "Canais da sua lista": cards 16:9.
  - Uma fileira por categoria, só enquanto houver itens. Limite de ~20 itens por fileira e um card "Ver todos" no fim,
    que abre a aba com a categoria.
- O foco anda pela fileira com translateX (a fileira desliza, o item focado fica numa posição estável à esquerda). Ao
  descer, a página rola para manter a fileira focada no terço superior.
- Opcional: ao focar um pôster, mostrar título, ano e duração dele abaixo da fileira (tela "Rolando para baixo").

### Abas TV ao vivo, Filmes e Séries
- Manter categorias à esquerda e grade virtualizada (`GridView`), porque as listas têm dezenas de milhares de itens,
  restilizadas: pôsteres 2:3 em filmes/séries, cards 16:9 em canais, foco que cresce, sem quebrar a virtualização.
  Ajustar `layout` em `CatalogBrowser.vue`. O botão "Atualizar lista" continua acessível.

### Detalhes (filme e série) — `MediaDetailsModal.vue`
- Fundo em tela cheia com vinheta; informações à esquerda; botões "Assistir/Continuar", "Do início" (se houver
  progresso), "Minha lista" e "Voltar".
- Série: temporadas em abas horizontais e **episódios em fileira horizontal** de miniaturas 16:9 com número, título,
  duração e progresso (mockup "Detalhes de série").

### Player — `VideoPlayerOverlay.vue`
- Título no canto superior esquerdo (série · TxEy acima, nome do episódio abaixo).
- Barra de tempo fina com marcador, tempos nas pontas.
- Controles redondos: anterior, -10s, Play/Pausa grande, +10s, próximo; à direita "Episódios"/"Fila" e "Minha lista".
  "Fechar" continua acessível pelo Voltar e por um botão discreto no topo.
- **Fora de escopo agora:** "Áudio e legendas" (aparece no mockup, mas é uma função nova; só fazer se o usuário pedir).
- Manter o comportamento atual: o menu some em 4s, zapping com o menu oculto, teclas de mídia, pausa em segundo plano e
  pop-up (PiP) no Android.

### Outras telas
- Escolha de perfil, Login, aviso legal, Busca e Gerenciador de Listas: aplicar a mesma linguagem visual (fundo,
  tipografia, botões, foco), sem mudar o fluxo. A Busca entra pelo ícone de lupa do menu lateral.

## Fases sugeridas

1. Base visual (cores, botões, efeito vidro sem `backdrop-filter`) + menu lateral com expansão no foco e as rotas das
   abas.
2. Início: destaque + componente de fileira horizontal (novo, reutilizável, com testes de navegação: fim da fileira não
   foge, Esquerda no primeiro item vai ao menu, foco visível e não cortado).
3. Abas de catálogo restilizadas.
4. Detalhes (filme e série com episódios em fileira).
5. Player.
6. Demais telas e polimento.

Ao fim de cada fase: `npm run lint`, `npm test`, `npm run build`, e conferência no navegador com o mock
(`npm run mock` + `npm run dev`) navegando **só com as setas**.

## Critérios de aceite

- Visual fiel ao layout B do `docs/design-2.0/mockups.html` em 1920×1080 e 1280×720.
- Navegação 100% pelo controle: nenhum foco preso, nenhum foco "fugindo" de fileira, Voltar coerente, foco inicial
  correto em cada tela, nenhum `id` duplicado.
- Auditoria de compatibilidade sem diferença em todas as telas. Em cada tela, no console do navegador: desligar
  transições, medir `getBoundingClientRect()` de todos os elementos, aplicar `.flex{gap:0!important}` + classe
  `no-flex-gap` no `<html>`, medir de novo e conferir que nada mudou.
- O build abre por `file://` (Edge/Chrome headless) e roda com listas de 50 mil itens do mock sem travar.
- Lint e todos os testes verdes; testes novos para a lógica nova (fileira horizontal, menu lateral, Voltar).
- Nada de commit/push sem pedido explícito.

## Pendências fora deste RFC (o usuário vai pedir depois)

- Commit e push na `main` (o usuário autorizou trabalhar direto na `main`, sem branches), removendo o que for inútil,
  inclusive as cópias antigas `../.github` e `../.gitignore` fora do repositório.
- Publicar o APK de teste num link fixo (GitHub Release) para baixar na TV pelo app Downloader, e escrever o tutorial de
  teste (Downloader → instalar → mock/lista real → checklist).
- URL pública da política de privacidade (`PRIVACY.md`), chave de release Android e id do pacote Tizen.
