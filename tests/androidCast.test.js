import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

// Verificação estática do código nativo (o APK é compilado no CI; não há JDK nesta máquina).
const JAVA_DIR = 'android/app/src/main/java/com/pulseplayer/app'
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const manifest = read('android/app/src/main/AndroidManifest.xml')
const gradle = read('android/app/build.gradle')
const activity = read(`${JAVA_DIR}/MainActivity.java`)
const plugin = read(`${JAVA_DIR}/CastPlugin.java`)
const options = read(`${JAVA_DIR}/CastOptionsProvider.java`)

describe('Android — transmitir para o Chromecast', () => {
  it('o plugin nativo existe com o nome e os métodos usados pelo JavaScript', () => {
    expect(plugin).toContain('@CapacitorPlugin(name = "Cast")')
    for (const method of ['isAvailable', 'requestSession', 'load', 'play', 'pause', 'stop']) {
      expect(plugin).toMatch(new RegExp(`@PluginMethod\\s+public void ${method}\\(PluginCall call\\)`))
    }
    expect(plugin).toContain('notifyListeners("castMediaStatus"')
  })

  it('não oferece transmissão em TV (Android TV / Google TV)', () => {
    expect(plugin).toContain('FEATURE_LEANBACK')
  })

  it('usa o receptor padrão do Google, declarado no manifest', () => {
    expect(options).toContain('DEFAULT_MEDIA_RECEIVER_APPLICATION_ID')
    expect(manifest).toContain('com.google.android.gms.cast.framework.OPTIONS_PROVIDER_CLASS_NAME')
    expect(manifest).toContain('com.pulseplayer.app.CastOptionsProvider')
    expect(gradle).toContain('play-services-cast-framework')
  })

  it('nunca registra a URL da mídia (leva usuário e senha) no log', () => {
    expect(plugin).not.toMatch(/Log\.\w\(/)
  })

  it('a Activity registra o plugin antes de iniciar o Capacitor', () => {
    const register = activity.indexOf('registerPlugin(CastPlugin.class)')
    expect(register).toBeGreaterThan(-1)
    expect(register).toBeLessThan(activity.indexOf('super.onCreate(savedInstanceState)'))
  })
})
