import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')
const activity = read('android/app/src/main/java/com/pulseplayer/app/MainActivity.java')
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

  it('só publica no Release o APK assinado com a chave privada, nunca o de debug (chave pública)', () => {
    const workflow = read('.github/workflows/build-apk.yml')
    const publish = workflow.slice(workflow.indexOf('Preparar APK assinado para download direto'))

    expect(publish).toContain("steps.release_key.outputs.available == 'true'")
    expect(publish).toContain('apk/release/')
    expect(publish).not.toContain('app-debug.apk')
  })
})

describe('Android — tela cheia no celular', () => {
  it('o plugin SystemBars do Capacitor 8 esconde as barras (sem isso ele mostra a barra de notificações ao abrir)', () => {
    expect(capacitorConfig.plugins.SystemBars).toMatchObject({ hidden: true })
  })
})
