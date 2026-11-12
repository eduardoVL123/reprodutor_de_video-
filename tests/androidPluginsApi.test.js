import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * O Capacitor lê as assinaturas de todos os métodos de cada plugin ao abrir o app (Plugin.initializeActivityLaunchers).
 * Uma classe que o aparelho não tem numa assinatura derruba o app na abertura: com PictureInPictureParams (Android 8+)
 * no PictureInPicturePlugin, o APK fechava sozinho no Fire OS 6 (Android 7.1) e a Amazon reprovou
 * (NoClassDefFoundError no logcat do teste, 2026-11-13). minSdk do app = 24 (Android 7.0).
 */

const DIR = 'android/app/src/main/java/com/pulseplayer/app'
// Classes do Android que não existem no Android 7.0/7.1 e que este app usa ou já usou.
const NEWER_THAN_MIN_SDK = ['PictureInPictureParams', 'RemoteAction', 'NotificationChannel', 'AudioFocusRequest']

const plugins = readdirSync(DIR)
  .filter((f) => f.endsWith('.java'))
  .map((f) => ({ file: f, source: readFileSync(join(DIR, f), 'utf8') }))
  .filter(({ source }) => source.includes('@CapacitorPlugin'))

describe('plugins Android abrem no Android 7 (Fire OS 6)', () => {
  it('acha os plugins do app', () => {
    expect(plugins.map((p) => p.file).sort()).toEqual(['CastPlugin.java', 'OrientationPlugin.java', 'PictureInPicturePlugin.java'])
  })

  it.each(plugins.map((p) => [p.file, p.source]))('%s não usa classe mais nova que o minSdk', (_, source) => {
    for (const name of NEWER_THAN_MIN_SDK) expect(source).not.toMatch(new RegExp(`\\b${name}\\b`))
  })

  it('o pop-up do Android 8+ mora numa classe à parte, que só carrega depois de conferir a versão', () => {
    const api = readFileSync(join(DIR, 'PictureInPictureApi.java'), 'utf8')
    expect(api).toMatch(/@RequiresApi\(api = Build\.VERSION_CODES\.O\)\s+final class PictureInPictureApi/)
    expect(api).not.toContain('@CapacitorPlugin')
  })
})
