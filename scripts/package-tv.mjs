import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Prepara a pasta de empacotamento das lojas a partir do build web (dist/):
 *
 *   node scripts/package-tv.mjs tizen   ->  build/tizen  (depois: `tizen package -t wgt -- build/tizen`)
 *   node scripts/package-tv.mjs webos   ->  build/webos   (depois: `ares-package build/webos`)
 *
 * Variáveis de ambiente: PULSE_TIZEN_PACKAGE_ID (10 caracteres alfanuméricos, id do certificado Samsung).
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEV_TIZEN_PACKAGE_ID = 'PulsePlay1' // só para testes locais; publique com o id do seu certificado

const PLATFORMS = {
  tizen: { manifest: 'config.xml', files: ['icon.png'] },
  webos: { manifest: 'appinfo.json', files: ['icon.png', 'largeIcon.png'] },
}

function resolveValues(platform, version, env) {
  const values = { __VERSION__: version }
  if (platform === 'tizen') {
    const packageId = env.PULSE_TIZEN_PACKAGE_ID || DEV_TIZEN_PACKAGE_ID
    if (!/^[A-Za-z0-9]{10}$/.test(packageId)) {
      throw new Error('PULSE_TIZEN_PACKAGE_ID deve ter exatamente 10 caracteres alfanuméricos.')
    }
    values.__TIZEN_PACKAGE_ID__ = packageId
  }
  return values
}

export function prepareTvPackage({ platform, distDir, outDir, version, env = process.env }) {
  const spec = PLATFORMS[platform]
  if (!spec) throw new Error(`Plataforma desconhecida: "${platform}". Use: ${Object.keys(PLATFORMS).join(', ')}.`)
  const values = resolveValues(platform, version, env)

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  cpSync(distDir, outDir, { recursive: true })

  const platformDir = join(ROOT, 'platforms', platform)
  let manifest = readFileSync(join(platformDir, spec.manifest), 'utf8')
  for (const [marker, value] of Object.entries(values)) manifest = manifest.split(marker).join(value)
  writeFileSync(join(outDir, spec.manifest), manifest)
  for (const file of spec.files) cpSync(join(platformDir, file), join(outDir, file))
  return outDir
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const platform = process.argv[2]
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  try {
    const out = prepareTvPackage({ platform, distDir: join(ROOT, 'dist'), outDir: join(ROOT, 'build', platform), version })
    console.log(`[package-tv] ${platform} pronto em ${out}`)
  } catch (err) {
    console.error(`[package-tv] ${err.message}`)
    process.exit(1)
  }
}
