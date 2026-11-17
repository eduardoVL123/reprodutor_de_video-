import plugin from 'tailwindcss/plugin.js'

/**
 * `gap` em flexbox só existe no Chromium 84+, e várias Smart TVs ainda rodam Chromium 63-79.
 * Este plugin substitui o utilitário `gap-*` do Tailwind: mantém `gap` e, sob `.no-flex-gap`
 * (classe posta no <html> por src/utils/compat.js quando o WebView não suporta), reproduz o
 * espaçamento com margens entre os filhos.
 * Grades (`grid`): no Chromium 57 a 65 (Tizen 5.0, TVs Samsung 2019) a propriedade ainda se chamava `grid-gap`;
 * o nome antigo sai junto e os navegadores novos o tratam como sinônimo de `gap`.
 */
const flexGapFallback = plugin(({ matchUtilities, theme }) => {
  matchUtilities(
    {
      gap: (value) => ({
        gridGap: value,
        gap: value,
        '.no-flex-gap &.flex:not(.flex-col) > * + *': { marginLeft: value },
        '.no-flex-gap &.flex.flex-col > * + *': { marginTop: value },
      }),
      // Com o `gap` do core desligado, gap-x/gap-y precisam existir aqui também (antes não geravam CSS nenhum).
      'gap-x': (value) => ({
        gridColumnGap: value,
        columnGap: value,
        '.no-flex-gap &.flex:not(.flex-col) > * + *': { marginLeft: value },
      }),
      'gap-y': (value) => ({
        gridRowGap: value,
        rowGap: value,
        '.no-flex-gap &.flex.flex-col > * + *': { marginTop: value },
      }),
    },
    { values: theme('gap') },
  )
})

/**
 * `phone:` vale só com `html.is-phone` (src/utils/compat.js): celular ou tablet pelo User-Agent e toque, nunca pela
 * largura. `phone-portrait:` é o mesmo aparelho em pé (RFC-023); a TV nunca pega nenhuma das duas.
 * (O `portrait:` do Tailwind não serve: pegaria qualquer tela em pé, inclusive TV girada ou janela do PC.)
 */
const phoneVariant = plugin(({ addVariant }) => {
  addVariant('phone', 'html.is-phone &')
  addVariant('phone-portrait', '@media (orientation: portrait) { html.is-phone & }')
})

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  corePlugins: { gap: false },
  theme: {
    extend: {
      // Escala tipográfica pensada para leitura a ~3 metros (base 1920x1080).
      // tv-xs é o mínimo: 20px em 1080p (selos, dicas e textos secundários). Nada menor que isso.
      fontSize: {
        'tv-xs': ['1.25rem', { lineHeight: '1.75rem' }],
        'tv-sm': ['1.25rem', { lineHeight: '1.75rem' }],
        'tv-base': ['1.5rem', { lineHeight: '2.25rem' }],
        'tv-lg': ['2rem', { lineHeight: '2.75rem' }],
        'tv-xl': ['2.75rem', { lineHeight: '3.5rem' }],
        'tv-2xl': ['3.75rem', { lineHeight: '4.25rem' }],
        // 2.0: título do destaque (Início/Detalhes) e títulos de fileira.
        'tv-hero': ['4rem', { lineHeight: '0.95', letterSpacing: '-0.02em' }],
        'tv-row': ['1.25rem', { lineHeight: '1.75rem' }],
      },
      colors: {
        tv: {
          bg: '#0B0F0C', // grafite Pulse
          deep: '#0B0F0C', // grafite Pulse: fundo atrás da arte
          meta: '#d4d4d8', // 2.0: metadados (ano, duração)
          surface: '#111114',
          card: '#141418',
          border: 'rgba(255, 255, 255, 0.10)',
          text: '#f1f5f9',
          muted: '#8e8e93',
          accent: '#B8F000', // verde-limão Pulse
          'on-accent': '#0B0F0C', // texto e ícones sobre o limão (nunca branco: contraste 1,3:1)
          'accent-soft': '#CCFF33',
        },
      },
      boxShadow: {
        focus: '0 0 25px rgba(255, 255, 255, 0.25)',
      },
    },
  },
  plugins: [flexGapFallback, phoneVariant],
}
