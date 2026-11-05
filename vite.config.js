import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { devCorsProxy } from './scripts/dev-cors-proxy.mjs'
import { tvClassicScript } from './scripts/tv-classic-script.mjs'

/** Build com servidor de licença e sem a chave pública: o app aceitaria qualquer resposta (hosts falso libera tudo). */
function requireLicenseKey() {
  return {
    name: 'require-license-key',
    apply: 'build',
    configResolved({ env }) {
      if (env.VITE_LICENSE_BASE_URL && !env.VITE_LICENSE_PUBLIC_KEY) {
        throw new Error('VITE_LICENSE_BASE_URL definida sem VITE_LICENSE_PUBLIC_KEY: a assinatura da licença não seria conferida.')
      }
    },
  }
}

export default defineConfig({
  // Caminhos relativos: obrigatório para empacotar em .wgt (Tizen) e .ipk (webOS),
  // que carregam o app via file:// e não a partir da raiz de um domínio.
  base: './',
  plugins: [vue(), devCorsProxy(), tvClassicScript(), requireLicenseKey()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'cloudflare:workers': fileURLToPath(new URL('./tests/helpers/cloudflareWorkersStub.js', import.meta.url)),
    },
  },
  build: {
    // Piso de suporte: Chromium 63 (Samsung Tizen 5.0+ / LG webOS 5+). Aparelhos mais antigos não têm
    // CSS grid, async/await ou módulos ES de forma confiável.
    target: 'es2017',
    cssTarget: 'chrome61',
    rolldownOptions: {
      // Bundle único e clássico: pacotes de TV carregam o app por file://, onde módulos ES não funcionam.
      output: { format: 'iife', codeSplitting: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    restoreMocks: true,
    // localforage guarda conexões abertas no próprio módulo: inline para o reset entre testes valer.
    server: { deps: { inline: ['localforage'] } },
  },
})
