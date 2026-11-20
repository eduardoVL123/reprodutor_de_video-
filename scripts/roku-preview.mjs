// Abre o app Roku no navegador (simulador brs-engine com SceneGraph), sem aparelho.
// Uso: npm run roku:preview → http://localhost:6502  (setas, Enter = OK, Backspace/Esc = Voltar)
// Serve o pacote build/roku/pulse-roku.zip com os cabeçalhos COOP/COEP que o simulador exige (SharedArrayBuffer).
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const engineDir = dirname(require.resolve('brs-engine/package.json'))
const sceneGraphDir = dirname(require.resolve('brs-scenegraph/package.json'))
export const PREVIEW_PORT = Number(process.env.ROKU_PREVIEW_PORT || 6502)

const PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Pulse Player — Roku (simulador)</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  #display { display: block; width: 100vw; height: 100vh; object-fit: contain; }
  #player { display: none; }
</style>
</head>
<body>
<canvas id="display" width="1920" height="1080"></canvas>
<video id="player" crossorigin="anonymous"></video>
<script src="lib/brs.api.js"></script>
<script>
  // Teclas do controle a partir do script (usado pelos roteiros de teste): pulseKey('down')
  window.pulseKey = (key) => brs.sendKeyPress(key, 120)
  window.addEventListener('load', async () => {
    const extensions = new Map([[brs.SupportedExtension.SceneGraph, './brs-sg.js']])
    await brs.initialize({ extensions, displayMode: '1080p', locale: 'pt_BR' }, { debugToConsole: true })
    brs.redraw(false, 1920, 1080, 1)
    // O initialize baixa o common.zip (fontes e sons do sistema) sem esperar: abrir o app antes disso derruba tudo.
    for (let i = 0; i < 100 && !(brs.deviceData && brs.deviceData.assets && brs.deviceData.assets.byteLength); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    console.info('[preview] common.zip carregado:', brs.deviceData.assets && brs.deviceData.assets.byteLength, 'bytes')
    const zip = await fetch('app.zip').then((res) => res.arrayBuffer())
    brs.execute('pulse-roku.zip', zip, { entryPoint: true, clearDisplayOnExit: false })
  })
</script>
</body>
</html>`

const FILES = {
  '/lib/brs.api.js': [join(engineDir, 'lib/brs.api.js'), 'text/javascript'],
  '/lib/brs.worker.js': [join(engineDir, 'lib/brs.worker.js'), 'text/javascript'],
  '/lib/brs-sg.js': [join(sceneGraphDir, 'lib/brs-sg.js'), 'text/javascript'],
  // O common.zip do SceneGraph traz as fontes e imagens dos nós (substitui o do motor).
  '/assets/common.zip': [join(sceneGraphDir, 'assets/common.zip'), 'application/zip'],
  '/app.zip': ['build/roku/pulse-roku.zip', 'application/zip'],
}

export function startPreview(port = PREVIEW_PORT) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' }
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(PAGE)
    }
    const file = FILES[path]
    if (!file || !existsSync(file[0])) {
      res.writeHead(404, headers)
      return res.end(file ? `Falta ${file[0]} (rode npm run roku:build)` : 'não encontrado')
    }
    res.writeHead(200, { ...headers, 'Content-Type': file[1] })
    res.end(readFileSync(file[0]))
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startPreview()
  console.log(`[roku] simulador no navegador: http://localhost:${PREVIEW_PORT}  (setas, Enter = OK, Backspace = Voltar)`)
}
