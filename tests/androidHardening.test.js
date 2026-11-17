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

describe('Android — app ocupa a tela inteira do celular', () => {
  it('a página declara viewport-fit=cover (desenha também ao lado da câmera)', () => {
    expect(read('index.html')).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover/)
    expect(capacitorConfig.plugins.SystemBars).toMatchObject({ initialViewportFitValueHint: 'cover' })
  })

  it('a janela usa a área ao lado da câmera (Android 9 a 14 deixava uma faixa preta na horizontal)', () => {
    expect(activity).toContain('LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES')
  })

  it('o SystemBars não aplica margens: com WebView < 140 (TVs, celulares sem atualização) ele encolhia o app', () => {
    expect(capacitorConfig.plugins.SystemBars).toMatchObject({ insetsHandling: 'disable' })
  })

  it('só o teclado reduz a área do app (o que o SystemBars fazia antes de ser desligado)', () => {
    expect(activity).toMatch(/setOnApplyWindowInsetsListener[\s\S]*WindowInsetsCompat\.Type\.ime\(\)/)
  })
})

describe('Android — nome do pacote por destino', () => {
  it('AAB da Play sai como com.playerpulse.app; o APK direto segue com.pulseplayer.app (TVs já instaladas atualizam)', () => {
    const gradle = read('android/app/build.gradle')
    const ci = read('.github/workflows/build-apk.yml')
    expect(gradle).toMatch(/applicationId project\.findProperty\('pulseApplicationId'\) \?: "com\.pulseplayer\.app"/)
    expect(ci).toMatch(/bundleRelease -PpulseApplicationId=com\.playerpulse\.app/)
    expect(ci).toMatch(/run: \.\/gradlew assembleRelease\s*$/m)
  })

  it('APK da Amazon: versão de loja com com.playerpulse.app, sem sobrescrever o APK do Downloader', () => {
    const ci = read('.github/workflows/build-apk.yml')
    const at = (text) => {
      const i = ci.indexOf(text)
      expect(i, text).toBeGreaterThan(-1)
      return i
    }
    const keepDownloader = at('cp android/app/build/outputs/apk/release/*.apk pulse-player.apk')
    const storeWeb = at("VITE_LICENSE_STORE_BUILD: '1'")
    const amazon = at('assembleRelease -PpulseApplicationId=com.playerpulse.app')

    // O APK do Downloader (versão completa, com.pulseplayer.app) é guardado antes de a pasta release ser reaproveitada.
    expect(keepDownloader).toBeLessThan(storeWeb)
    expect(storeWeb).toBeLessThan(amazon)
    expect(ci).toContain('pulse-player-amazon.apk')
    // O Release do GitHub (link do Downloader) continua publicando só o APK completo.
    const publish = ci.slice(at('Publicar Release com APK para Smart TV (Downloader)'))
    expect(publish).toContain('files: pulse-player.apk')
    expect(publish).not.toContain('amazon')
  })
})

describe('Android — botão Voltar no Android 16+', () => {
  // Com targetSdk 36, o Android 16 deixa de entregar KEYCODE_BACK à Activity (o Voltar "preditivo" vira o padrão).
  // O app depende dessa tecla: a MainActivity a transforma em Escape para o JavaScript fechar player e diálogos.
  it('pede ao sistema o Voltar antigo, que a MainActivity sabe tratar', () => {
    expect(manifest).toMatch(/<application[^>]*android:enableOnBackInvokedCallback="false"/)
    expect(activity).toContain('event.getKeyCode() == KeyEvent.KEYCODE_BACK')
  })
})
