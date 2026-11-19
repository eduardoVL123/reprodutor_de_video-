// Ferramentas do app Roku.
//   sim    → roda os testes Rooibos no simulador brs-engine (sem aparelho); falha sem "[Rooibos Result]: PASS"
//   deploy → envia build/roku/pulse-roku.zip para um aparelho em modo desenvolvedor (ROKU_HOST, ROKU_PASSWORD)
//   test   → envia build/roku/pulse-roku-test.zip ao aparelho; resultado no console 8085
//   size   → falha se o pacote passar de 4 MB (certificação Roku 3.x)
import { statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const MAX_PACKAGE_BYTES = 4 * 1024 * 1024
const OUT_DIR = 'build/roku'
const FILES = { deploy: 'pulse-roku.zip', test: 'pulse-roku-test.zip' }

export function checkSize(bytes, max = MAX_PACKAGE_BYTES) {
  if (bytes > max) throw new Error(`Pacote Roku com ${bytes} bytes passa do limite de ${max} bytes`)
  return bytes
}

/** O brs-cli sai com 0 mesmo com teste falhando: só a linha final do Rooibos diz se passou. */
export function rooibosPassed(output) {
  return /^\[Rooibos Result\]: PASS\s*$/m.test(output)
}

const SIM_TIMEOUT_MS = 5 * 60 * 1000

function runSimulator() {
  return new Promise((resolve, reject) => {
    // Comando inteiro numa string (caminho fixo): shell é preciso para o npx no Windows, e args + shell dão DEP0190.
    const child = spawn(`npx brs-cli --colors 0 ${OUT_DIR}/${FILES.test}`, {
      shell: true,
      env: { ...process.env, BRS_NO_UPDATE_CHECK: '1' },
    })
    let output = ''
    const collect = (chunk) => {
      output += chunk
      process.stdout.write(chunk)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    // Suíte @SGNode pode travar no simulador (limitação documentada do brs-engine).
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Testes Rooibos passaram de 5 minutos no simulador'))
    }, SIM_TIMEOUT_MS)
    child.on('close', () => {
      clearTimeout(timer)
      if (rooibosPassed(output)) resolve()
      else reject(new Error('Testes Rooibos falharam ou não terminaram (sem "[Rooibos Result]: PASS")'))
    })
  })
}

async function main(command) {
  if (command === 'sim') return runSimulator()
  if (command === 'size') {
    const bytes = checkSize(statSync(`${OUT_DIR}/${FILES.deploy}`).size)
    console.log(`[roku] pacote com ${(bytes / 1024).toFixed(0)} KB (limite 4096 KB)`)
    return
  }
  const outFile = FILES[command]
  if (!outFile) throw new Error('Uso: node scripts/roku.mjs sim|deploy|test|size')
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
