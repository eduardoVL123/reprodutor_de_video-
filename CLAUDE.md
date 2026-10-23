# Pulse Player — regras do projeto

Reprodutor de mídia neutro (Vue 3 + Tailwind 3 + Vite 8 + Capacitor 8) para Samsung Tizen, LG webOS, Android TV e
celular Android. Responda em português do Brasil. Trabalho atual: `docs/rfc/RFC-014-design-2.0.md` (visual 2.0,
layout B com menu lateral; telas aprovadas em `docs/design-2.0/mockups.html`).

## Comandos
`npm run mock` (servidor falso :8787, teste123/senha123) · `npm run dev` (:5173) · `npm test` · `npm run lint` ·
`npm run build` · `npm run build:tizen` / `build:webos`. Lint e testes verdes antes de dizer que terminou.
Não faça commit/push sem pedido explícito.

## Regras de TV (não quebrar)
- Foco: todo interativo é `button`/`.tv-focusable` com `id` único; grupos `data-focus-group`, linhas `data-focus-row`
  (`src/utils/spatialNavigation.js`). Voltar via `registerBackHandler`. Foco sempre visível e sem corte.
- Chromium 63+: sem `backdrop-filter`, sem `aspect-ratio`, sem `gap` em CSS escrito à mão (use classes `gap-*`;
  texto solto dentro de flex com gap vai num `<span>`), sem `import()` dinâmico novo.
- Lojas: margem segura `px-24`/`py-14`; texto mínimo `text-tv-xs`; nada de selos falsos, imagens externas ou marcas de
  terceiros (há testes de guarda).

## Marca (RFC-015)
- Pulse Player, appId `com.pulseplayer.app`. Kit em `../logo/kit` (leia `GUIA-DE-USO.md`).
- Cores: `tv-accent` verde-limão `#B8F000`, fundo grafite `#0B0F0C`. Texto sobre limão sólido é `text-tv-on-accent`
  (grafite), nunca branco; limão nunca sobre fundo claro. Símbolo: `src/components/BrandMark.vue` (tamanho em rem).
- Ícones e splashes nativos: `npm run icons` (`scripts/make-tv-icons.mjs`). Segredos de assinatura: `PULSE_*`.

## Base pronta para o 2.0
- `src/components/ui/HorizontalRail.vue` — fileira deslizante focável (slot `item`, evento `select`).
- `src/utils/railOffset.js`, `src/utils/artwork.js` (`pickArtwork`: backdrop → pôster → neutro).
- Classes em `src/style.css`: `tv-glass`, `tv-btn-glass`, `tv-chip`, `tv-badge`, `tv-badge-live`, `tv-progress`,
  `tv-vignette`, `tv-rail*`. Tokens: `bg-tv-deep`, `text-tv-meta`, `text-tv-hero`, `text-tv-row`.
- Testes: `tests/helpers/layout.js` (`layout()` com retângulos, `press()` de teclas).
- No console em `npm run dev`: `await __pulse.walk(['Down','Right','Back'])`, `__pulse.audit()` (differ = 0),
  `__pulse.duplicateIds()` (= []).
