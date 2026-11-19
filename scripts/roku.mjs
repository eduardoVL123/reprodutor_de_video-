// Envia o pacote do app Roku para uma TV/aparelho em modo desenvolvedor (sideload).
// Uso: ROKU_HOST=192.168.0.10 ROKU_PASSWORD=... node scripts/roku.mjs deploy|test|size
//   deploy → build/roku/pulse-roku.zip       (gerado por `npm run roku:build`)
//   test   → build/roku/pulse-roku-test.zip  (gerado com Rooibos; resultado no console 8085 do aparelho)
//   size   → falha se o pacote passar de 4 MB (certificação Roku 3.x)
import { statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const MAX_PACKAGE_BYTES = 4 * 1024 * 1024
const OUT_DIR = 'build/roku'
const FILES = { deploy: 'pulse-roku.zip', test: 'pulse-roku-test.zip' }

export function checkSize(bytes, max = MAX_PACKAGE_BYTES) {
  if (bytes > max) throw new Error(`Pacote Roku com ${bytes} bytes passa do limite de ${max} bytes`)
  return bytes
}

async function main(command) {
  if (command === 'size') {
    const bytes = checkSize(statSync(`${OUT_DIR}/${FILES.deploy}`).size)
    console.log(`[roku] pacote com ${(bytes / 1024).toFixed(0)} KB (limite 4096 KB)`)
    return
  }
  const outFile = FILES[command]
  if (!outFile) throw new Error('Uso: node scripts/roku.mjs deploy|test|size')
  const host = process.env.ROKU_HOST
  const password = process.env.ROKU_PASSWORD
  if (!host || !password) throw new Error('Defina ROKU_HOST e ROKU_PASSWORD (senha do modo desenvolvedor)')
  const { default: rokuDeploy } = await import('roku-deploy')
  await rokuDeploy.publish({ host, password, outDir: OUT_DIR, outFile })
  console.log(`[roku] ${outFile} enviado para ${host}. Logs: telnet ${host} 8085`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((err) => {
    console.error(`[roku] ${err.message}`)
    process.exit(1)
  })
}
