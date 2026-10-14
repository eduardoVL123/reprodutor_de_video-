import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Caminhos relativos: obrigatório para empacotar em .wgt (Tizen) e .ipk (webOS),
  // que carregam o app via file:// e não a partir da raiz de um domínio.
  base: './',
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Chromium de TVs antigas (Tizen 5.x ~ Chrome 63, webOS 4 ~ Chrome 53/68).
    target: 'es2017',
    cssTarget: 'chrome61',
  },
})
