import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

// Verificação estática do código nativo (o APK é compilado no CI; não há JDK nesta máquina).
const JAVA_DIR = 'android/app/src/main/java/com/pulseplayer/app'
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const manifest = read('android/app/src/main/AndroidManifest.xml')
const activity = read(`${JAVA_DIR}/MainActivity.java`)
const plugin = read(`${JAVA_DIR}/PictureInPicturePlugin.java`)

describe('Android — pop-up (Picture-in-Picture) em celular e tablet', () => {
  it('a Activity declara suporte a Picture-in-Picture', () => {
    expect(manifest).toContain('android:supportsPictureInPicture="true"')
    expect(manifest).toContain('android:resizeableActivity="true"')
  })

  it('o plugin nativo existe com o nome usado pelo JavaScript', () => {
    expect(plugin).toContain('@CapacitorPlugin(name = "PictureInPicture")')
    expect(plugin).toMatch(/@PluginMethod\s+public void setEnabled\(PluginCall call\)/)
    expect(plugin).toContain('notifyListeners("pictureInPictureChange"')
  })

  it('não usa pop-up em TV (Android TV / Google TV)', () => {
    expect(plugin).toContain('FEATURE_LEANBACK')
    expect(plugin).toContain('FEATURE_PICTURE_IN_PICTURE')
  })

  it('protege as APIs novas por versão do Android (minSdk 24)', () => {
    expect(plugin).toContain('Build.VERSION_CODES.O')
    expect(plugin).toContain('Build.VERSION_CODES.S')
    expect(plugin).toContain('@RequiresApi')
  })

  it('a Activity registra o plugin antes de iniciar o Capacitor e repassa os eventos', () => {
    const register = activity.indexOf('registerPlugin(PictureInPicturePlugin.class)')
    const superCreate = activity.indexOf('super.onCreate(savedInstanceState)')
    expect(register).toBeGreaterThan(-1)
    expect(register).toBeLessThan(superCreate)
    expect(activity).toContain('public void onUserLeaveHint()')
    expect(activity).toContain('public void onPictureInPictureModeChanged(')
  })
})
