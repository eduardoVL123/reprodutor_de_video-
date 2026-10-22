import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')
const activity = read('android/app/src/main/java/com/neutrotv/player/MainActivity.java')
const manifest = read('android/app/src/main/AndroidManifest.xml')
const capacitorConfig = JSON.parse(read('capacitor.config.json'))

describe('Android — endurecimento (verificação estática; o APK é compilado no CI)', () => {
  it('valida certificados TLS em vez de aceitar qualquer um', () => {
    expect(activity).not.toMatch(/checkServerTrusted\([^)]*\)\s*\{\s*\}/)
    expect(activity).not.toContain('setHostnameVerifier')
    expect(activity).not.toContain('TrustManager')
  })

  it('não libera acesso universal a arquivos locais no WebView', () => {
    expect(activity).not.toContain('setAllowUniversalAccessFromFileURLs(true)')
    expect(activity).not.toContain('setAllowFileAccessFromFileURLs(true)')
    expect(activity).not.toContain('MIXED_CONTENT_ALWAYS_ALLOW')
  })

  it('não entra no backup automático (guarda credenciais)', () => {
    expect(manifest).toContain('android:allowBackup="false"')
  })

  it('declara o banner exigido pela tela inicial do Android TV', () => {
    expect(manifest).toMatch(/android:banner="@drawable\/banner"/)
  })

  it('não permite navegar o WebView para qualquer host', () => {
    expect(capacitorConfig.server.allowNavigation).toBeUndefined()
    expect(capacitorConfig.android.allowMixedContent).not.toBe(true)
  })
})
