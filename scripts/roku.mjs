// Ferramentas do app Roku.
//   sim    → roda os testes Rooibos no simulador brs-engine (sem aparelho); falha sem "[Rooibos Result]: PASS"
//   integration → sobe o servidor falso (scripts/mock-xtream.mjs) e roda os testes com a tag "integration"
//   deploy → envia build/roku/pulse-roku.zip para um aparelho em modo desenvolvedor (ROKU_HOST, ROKU_PASSWORD)
//   test   → envia build/roku/pulse-roku-test.zip ao aparelho; resultado no console 8085
//   size   → falha se o pacote passar de 4 MB (certificação Roku 3.x)
//   config → grava build/roku/config/build-config.json (pkg:/build-config.json): o PULSE_PAIR_BASE_URL do .env
import { statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const MAX_PACKAGE_BYTES = 4 * 1024 * 1024
const OUT_DIR = 'build/roku'
const FILES = { deploy: 'pulse-roku.zip', test: 'pulse-roku-test.zip', integration: 'pulse-roku-integration.zip' }
const MOCK_PORT = 8787

export function checkSize(bytes, max = MAX_PACKAGE_BYTES) {
  if (bytes > max) throw new Error(`Pacote Roku com ${bytes} bytes passa do limite de ${max} bytes`)
  return bytes
}

/** O brs-cli sai com 0 mesmo com teste falhando: só a linha final do Rooibos diz se passou. */
export function rooibosPassed(output) {
  return /^\[Rooibos Result\]: PASS\s*$/m.test(output)
}

/** Configuração do build lida pelo app (roku/source/config.bs); endereço vazio = pareamento desligado. */
export function buildConfig(env) {
  const pairBaseUrl = String(env.PULSE_PAIR_BASE_URL || env.VITE_PAIR_BASE_URL || '').trim().replace(/\/+$/, '')
  const demoPlaylistUrl = String(env.PULSE_DEMO_PLAYLIST_URL || env.VITE_DEMO_PLAYLIST_URL || '').trim()
  const licenseBaseUrl = String(env.PULSE_LICENSE_BASE_URL || env.VITE_LICENSE_BASE_URL || '').trim().replace(/\/+$/, '')
  return { pairBaseUrl, demoPlaylistUrl, licenseBaseUrl }
}

/** PEM da chave pública RSA da licença (scripts/make-license-keys.mjs --rsa); vazio = Roku sem conferir sigRsa. */
export function licenseRsaPem(env) {
  // No CI a variável pode vir numa linha só, com "\n" escrito no lugar das quebras.
  const pem = String(env.PULSE_LICENSE_RSA_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim()
  return pem.startsWith('-----BEGIN PUBLIC KEY-----') ? `${pem}\n` : ''
}

/**
 * Licença ligada sem a chave pública RSA = o app aceita qualquer resposta (licensing.verify libera sem PEM): o build
 * para. O servidor local do simulador (localhost) passa sem chave.
 */
export function checkLicenseKey(config, pem) {
  if (!config.licenseBaseUrl || pem) return
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(config.licenseBaseUrl)) return
  throw new Error('Licença ligada sem PULSE_LICENSE_RSA_PUBLIC_KEY (ou com o PEM mal formado): o app aceitaria qualquer resposta de licença')
}

const SIM_TIMEOUT_MS = 5 * 60 * 1000

/** Sobe o mock com catálogo pequeno e espera ele responder; devolve o processo para encerrar depois. */
async function startMock() {
  const mock = spawn(process.execPath, ['scripts/mock-xtream.mjs'], {
    env: { ...process.env, MOCK_PORT: String(MOCK_PORT), MOCK_LIVE: '20', MOCK_VOD: '20', MOCK_SERIES: '5' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) {
    const up = await fetch(`http://127.0.0.1:${MOCK_PORT}/lista.m3u`).then(() => true, () => false)
    if (up) return mock
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  mock.kill()
  throw new Error(`O servidor falso não subiu na porta ${MOCK_PORT}`)
}

async function runIntegration() {
  const mock = await startMock()
  try {
    await runSimulator(FILES.integration)
  } finally {
    mock.kill()
  }
}

function runSimulator(zipFile = FILES.test) {
  return new Promise((resolve, reject) => {
    // Comando inteiro numa string (caminho fixo): shell é preciso para o npx no Windows, e args + shell dão DEP0190.
    const child = spawn(`npx brs-cli --colors 0 ${OUT_DIR}/${zipFile}`, {
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
  if (command === 'integration') return runIntegration()
  if (command === 'config') {
    if (existsSync('.env')) process.loadEnvFile('.env')
    mkdirSync(`${OUT_DIR}/config`, { recursive: true })
    const data = buildConfig(process.env)
    const pem = licenseRsaPem(process.env)
    checkLicenseKey(data, pem)
    writeFileSync(`${OUT_DIR}/config/build-config.json`, JSON.stringify(data))
    // O roRSA lê a chave de um arquivo PEM do pacote (pkg:/license-rsa.pem).
    writeFileSync(`${OUT_DIR}/config/license-rsa.pem`, pem)
    console.log(`[roku] pareamento ${data.pairBaseUrl ? `em ${data.pairBaseUrl}` : 'desligado (sem PULSE_PAIR_BASE_URL)'}`)
    console.log(`[roku] lista de demonstração ${data.demoPlaylistUrl ? 'ligada' : 'desligada (sem PULSE_DEMO_PLAYLIST_URL)'}`)
    console.log(`[roku] licença ${data.licenseBaseUrl ? `em ${data.licenseBaseUrl}` : 'desligada (sem PULSE_LICENSE_BASE_URL)'}`)
    return
  }
  if (command === 'size') {
    const bytes = checkSize(statSync(`${OUT_DIR}/${FILES.deploy}`).size)
    console.log(`[roku] pacote com ${(bytes / 1024).toFixed(0)} KB (limite 4096 KB)`)
    return
  }
  const outFile = FILES[command]
  if (!outFile) throw new Error('Uso: node scripts/roku.mjs sim|integration|deploy|test|size|config')
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
