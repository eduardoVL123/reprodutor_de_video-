import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { devCorsProxy } from './scripts/dev-cors-proxy.mjs'
import { tvClassicScript } from './scripts/tv-classic-script.mjs'

export default defineConfig({
  // Caminhos relativos: obrigatório para empacotar em .wgt (Tizen) e .ipk (webOS),
  // que carregam o app via file:// e não a partir da raiz de um domínio.
  base: './',
  plugins: [vue(), devCorsProxy(), tvClassicScript()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
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
