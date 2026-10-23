/**
 * Plugin do Vite para o build de Smart TVs (Tizen .wgt / webOS .ipk / Android TV).
 *
 * Esses pacotes abrem o app por file://, onde o Chromium bloqueia <script type="module"> e
 * recursos com `crossorigin` (a origem é opaca). O build gera um único bundle IIFE
 * (ver vite.config.js); aqui o HTML passa a carregá-lo como script clássico com `defer`.
 */
export function tvClassicScript() {
  return {
    name: 'pulse-tv-classic-script',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
          .replace(/(<link rel="stylesheet") crossorigin /g, '$1 ')
      },
    },
  }
}
