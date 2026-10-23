# RFC-015 — Rebrand: Neutro TV → Pulse Player

Status: aprovado e implementado (sem commit) · Data: 2026-10-22

## Por quê
O app ganha identidade própria: **Pulse Player**, um botão de play cortado por uma linha de batimento. Personalidade:
sofisticado, moderno, elegante, revolucionário. O app ainda não está em nenhuma loja, então é a hora de trocar
também o identificador do pacote. Kit da marca: `../logo/kit` (guia em `../logo/kit/GUIA-DE-USO.md`).

## Objetivos
- Nome "Pulse Player" em tudo que o usuário vê (título, login, menu, telas nativas, lojas, docs públicos).
- Cor de destaque verde-limão `#B8F000` no lugar do vermelho `#e50914`, com texto grafite `#0B0F0C` sobre limão.
- Símbolo novo no app (componente `BrandMark.vue`) e nos ícones nativos (Android, Tizen, webOS).
- appId novo: `com.pulseplayer.app`.

## Não objetivos
- Não muda layout, navegação, fluxo nem textos além da marca (o layout B do RFC-014 fica igual).
- Não adiciona canais, logos de emissoras, selos ou imagens externas.
- Não migra dados do app antigo instalado na TV (veja Impacto).

## Anti-objetivos (seria falha mesmo funcionando)
- Limão sobre branco ou fundo claro (contraste 1,3:1). Texto branco sobre botão limão.
- Foco invisível ou cortado; texto menor que `text-tv-xs`; quebra em Chromium 63 (sem `aspect-ratio`,
  `backdrop-filter`, `gap` à mão, `import()` novo).
- Símbolo girado, distorcido, com sombra/brilho/gradiente, ou dentro de quadrado/círculo (exceto ícone de app).

## Decisões do dono do produto
| Tema | Decisão |
|---|---|
| appId / pacote | `com.pulseplayer.app` (Capacitor, Android `namespace`/`applicationId`, pasta Java, webOS `id`) |
| Selo "AO VIVO" | verde-limão, texto grafite |
| Perfis | limão substitui o vermelho na paleta; "Principal" fica limão com letra grafite |
| Segredos de assinatura | `NEUTRO_*` → `PULSE_*` (variáveis do Gradle/CI, `PULSE_TIZEN_PACKAGE_ID`); o dono recria os secrets no GitHub |

## Desenho técnico
### 1. Tokens de cor (`tailwind.config.js`)
- `tv.accent` `#B8F000`, `tv.accent-soft` `#CCFF33` (limão um pouco mais claro, só para hover/estado ativo).
- Novo token `tv.on-accent` `#0B0F0C` para texto/ícone sobre limão. Fundo base passa de `#07070a` para o grafite
  `#0B0F0C` onde hoje é o fundo do app (`bg-[#07070a]` / `bg-tv-deep`).
- Revisar cada uso de `accent`/`#e50914` em `src/style.css` e nos componentes listados no pedido; onde o texto fica
  sobre limão, trocar `text-white` por `text-tv-on-accent`. Barras de progresso e anel ativo ficam limão.
- O anel de foco continua branco (contraste máximo e já testado). Elementos limão focados mantêm o anel branco.

### 2. Logo no app — `src/components/BrandMark.vue`
- SVG inline com os dois caminhos de `pulse-symbol.svg`; abaixo de 32 px usa os de `pulse-symbol-small.svg`.
- Props: `size` (px, padrão 28) e `color` (padrão `currentColor`, então segue a classe de texto). `aria-hidden`.
- Em "Minha lista", o selo "AO VIVO" fica limão e "FILME"/"SÉRIE" passam ao selo escuro das fileiras (decisão do
  construtor: se tudo fosse limão, o ao vivo perderia o destaque).
- Lockup "Pulse Player": símbolo + nome em texto vivo (`PULSE` off-white + `PLAYER` limão) no menu lateral e no
  login, como hoje é feito com "NEUTRO TV". O wordmark em traço do kit fica para materiais de loja (decisão do
  construtor: texto vivo respeita o tamanho mínimo de TV e não depende de fonte).
- Substitui o raio em `Dashboard.vue`, `SideMenu.vue`, `Login.vue`, `FTUE.vue`, `MediaDetailsModal.vue`.

### 3. Ícones e telas nativas — script, não cópia de PNG
Caminho escolhido: **reescrever `scripts/make-tv-icons.mjs`** para rasterizar o símbolo novo (polígono com o arco
do canto aproximado por segmentos), limão sobre grafite, sem dependências, como o script atual já faz.
Motivo: o kit só tem PNG em 16/32/48/180/192/512 e o projeto não tem biblioteca de redimensionamento; o script gera
cada tamanho exato que Android/Tizen/webOS pedem e é reproduzível. `dist/web/maskable-512.png` e `icon-512.png`
servem de referência visual para conferir o resultado.
- Tizen `icon.png` 117, webOS `icon.png` 80 e `largeIcon.png` 130.
- Android: `mipmap-*/ic_launcher.png` e `ic_launcher_round.png` (48/72/96/144/192), `ic_launcher_foreground.png`
  (108/162/216/324/432, símbolo na zona segura de 66%), fundo adaptativo grafite em `values/ic_launcher_background.xml`.
- Splash `drawable*/splash.png` (retrato e paisagem nos tamanhos atuais): grafite com o símbolo centralizado.
- `drawable/banner.xml` (Android TV) reescrito em vetor: símbolo limão + "PULSE PLAYER" sobre grafite.
- Fundo do ícone adaptativo (`values/ic_launcher_background.xml`) em grafite. O tema nativo (`styles.xml`) não define
  cor própria, então não muda.

### 4. Nome e identificador
- Visíveis: `index.html` (title), `Login.vue`, `Dashboard.vue`, `SideMenu.vue`, `capacitor.config.json` (+ cópia
  em `android/.../assets`), `strings.xml`, `platforms/tizen/config.xml` (`name`, id da aplicação `.PulsePlayer`),
  `platforms/webos/appinfo.json` (`id`, `title`, `vendor`), `PRIVACY.md`, `README.md`, `scripts/package-tv.mjs`.
- appId: `build.gradle`, pasta `java/com/neutrotv/player` → `java/com/pulseplayer/app` (+ `package` dos `.java`),
  `strings.xml` (`package_name`, `custom_url_scheme`).
- Internos com o nome antigo: `package.json` (`name` → `pulse-player`), UA do proxy (`PulsePlayer/1.0`), nomes de
  plugin Vite, workflow (`pulse-player.apk`, título do release), `devTools` (`window.__neutro` → `window.__pulse`),
  `CLAUDE.md` e chaves de assinatura (`PULSE_*`, arquivo de debug `pulse-debug.p12`).
- Ficam como estão (não são a marca): nome do banco local `neutral-media-player` (mudar apagaria listas e logins
  salvos), o alias `neutrodebug` gravado dentro da chave de debug (só muda gerando outra chave; não havia JDK para
  isso) e a palavra "neutro" no sentido de cor/neutralidade (ex.: `artwork.js`, "fundo neutro"). Documentos
  históricos (`RFC-014`, `docs/design-2.0/mockups.html`) ficam intactos.

### 5. Testes e documentação
- Ajustar `tests/devProxy`, `tvPackage`, `androidPip`, `androidHardening`, `devTools`, `tvCompat` para o nome/id novos.
- Teste novo de guarda: nenhum `#e50914`/`Neutro TV` em `src/`, `index.html`, configs nativas; `BrandMark` renderiza
  os caminhos pequenos abaixo de 32 px; texto sobre `bg-tv-accent` não usa `text-white`.

## Impacto da troca de appId (registrado)
- Android: é outro app. Instala ao lado do "Neutro TV" já baixado pelo Downloader; listas, perfis e histórico não
  passam para o novo (o WebView guarda por pacote). Desinstale o antigo depois de testar.
- Assinatura: o keystore de debug continua válido (o arquivo só muda de nome). Builds assinados de release usam os
  secrets `PULSE_*`, que precisam existir no GitHub antes do próximo build assinado.
- webOS/Tizen: id novo = app novo nas TVs de teste; sem efeito em loja (ainda não publicado).
- Link do Downloader muda para `.../releases/download/v2.0.0/pulse-player.apk` após o próximo push.

## Verificação
- `npm run lint`, `npm test`, `npm run build`, `npm run build:tizen`, `npm run build:webos` verdes.
- `npm run mock` + `npm run dev`: capturas antes/depois (login, dashboard, menu lateral, player);
  `__pulse.audit()` com `differ = 0` e `__pulse.duplicateIds()` = `[]`.
- grep sem "Neutro"/`#e50914` fora das exceções acima; build de produção abrindo via `file://`.
