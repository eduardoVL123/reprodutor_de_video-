import { describe, it, expect, vi } from 'vitest'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import config from '../tailwind.config.js'

const compact = (css) => css.replace(/\s+/g, '')

async function buildCss(html) {
  const result = await postcss([tailwindcss({ ...config, content: [{ raw: html }] })]).process('@tailwind utilities;', {
    from: undefined,
  })
  return compact(result.css)
}

describe('fallback de gap em flexbox para TVs com Chromium < 84', () => {
  it('mantém o gap padrão e adiciona margens equivalentes em linha', async () => {
    const css = await buildCss('<div class="flex gap-4"></div>')

    expect(css).toContain('.gap-4{grid-gap:1rem;gap:1rem;}')
    expect(css).toContain('.no-flex-gap.gap-4.flex:not(.flex-col)>*+*{margin-left:1rem;}')
  })

  it('usa margem superior quando o flex é uma coluna', async () => {
    const css = await buildCss('<div class="flex flex-col gap-2"></div>')

    expect(css).toContain('.no-flex-gap.gap-2.flex.flex-col>*+*{margin-top:0.5rem;}')
  })

  it('gap-x e gap-y também existem (sem eles o Diagnóstico grudava "código" e "plataforma")', async () => {
    const css = await buildCss('<div class="flex flex-wrap gap-x-8 gap-y-1"></div>')

    expect(css).toContain('.gap-x-8{grid-column-gap:2rem;column-gap:2rem;}')
    expect(css).toContain('.gap-y-1{grid-row-gap:0.25rem;row-gap:0.25rem;}')
    expect(css).toContain('.no-flex-gap.gap-x-8.flex:not(.flex-col)>*+*{margin-left:2rem;}')
  })

  it('grades: sai também grid-gap (no Chromium 57 a 65, Tizen 5.0, `gap` ainda não valia em grade)', async () => {
    const css = await buildCss('<div class="grid grid-cols-4 gap-5 gap-x-2 gap-y-3"></div>')

    expect(css).toContain('.gap-5{grid-gap:1.25rem;gap:1.25rem;}')
    expect(css).toContain('.gap-x-2{grid-column-gap:0.5rem;column-gap:0.5rem;}')
    expect(css).toContain('.gap-y-3{grid-row-gap:0.75rem;row-gap:0.75rem;}')
    expect(css).not.toContain('.no-flex-gap.gap-5.grid') // as margens são só para flex
  })
})

describe('classes de compatibilidade', () => {
  it('marca o <html> quando o WebView não suporta gap em flexbox', async () => {
    const { applyCompatClasses } = await import('@/utils/compat')
    const root = document.createElement('html')

    applyCompatClasses(root, () => false)

    expect(root.classList.contains('no-flex-gap')).toBe(true)
  })

  it('não marca o <html> quando o gap é suportado', async () => {
    const { applyCompatClasses } = await import('@/utils/compat')
    const root = document.createElement('html')

    applyCompatClasses(root, () => true)

    expect(root.classList.contains('no-flex-gap')).toBe(false)
  })
})

describe('build para Smart TVs (arquivos file://)', () => {
  it('gera um script clássico único, sem módulos ES nem crossorigin', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'pulse-build-'))
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir, '--emptyOutDir'], {
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' }, // o vitest define "test"; o build precisa do Vue de produção
    })

    const html = readFileSync(join(outDir, 'index.html'), 'utf8')
    expect(html).not.toContain('type="module"')
    expect(html).not.toContain('crossorigin')
    expect(html).toMatch(/<script defer src="\.\/assets\/[^"]+\.js"><\/script>/)

    const files = readdirSync(join(outDir, 'assets'))
    expect(files).toHaveLength(1) // um bundle só; o CSS vai embutido nele (formato IIFE)
    const js = readFileSync(join(outDir, 'assets', files[0]), 'utf8')
    expect(js.includes('import.meta')).toBe(false)
    expect(js.includes('import(')).toBe(false)
    expect(js.includes('no-flex-gap')).toBe(true)
    expect(js.includes('grid-gap:')).toBe(true) // o minificador não pode descartar o nome antigo (Tizen 5.0)
    // Aviso de falha ao iniciar (tests/bootGuard.test.js): script comum, roda antes do bundle porque o bundle é `defer`.
    expect(html).toContain('<script id="boot-guard">')
    expect(js.includes('Vue warn')).toBe(false) // build de produção do Vue
  }, 180000)
})

describe('detecção de celular', () => {
  const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
  const ANDROID_TV = 'Mozilla/5.0 (Linux; Android 11; BRAVIA 4K UR2) AppleWebKit/537.36 Chrome/96.0 Safari/537.36'
  // APK na TV: o WebView do Android diz "Mobile" até em TV (ex.: Philips com Android TV).
  const ANDROID_TV_WEBVIEW =
    'Mozilla/5.0 (Linux; Android 12; 65PUS8807/12; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36'
  const TABLET = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
  const TIZEN = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 Chrome/63.0 TV Safari/537.36'
  const WEBOS = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0 Safari/537.36 WebAppManager'

  it.each([
    [PIXEL, 5, true],
    [IPHONE, 5, true],
    [ANDROID_TV_WEBVIEW, 0, false], // diz "Mobile", mas TV não tem tela de toque
    [ANDROID_TV, 0, false],
    [TABLET, 10, true], // RFC-023: tablet usa o layout de celular (deitado e em pé)
    [TIZEN, 0, false],
    [WEBOS, 0, false],
  ])('isPhone(%s, %s toques) = %s', async (ua, touchPoints, expected) => {
    const { isPhone } = await import('@/utils/compat')

    expect(isPhone(ua, touchPoints)).toBe(expected)
  })

  it('marca o <html> com is-phone só em celular (o APK na TV fica com a escala de TV)', async () => {
    const { applyCompatClasses } = await import('@/utils/compat')
    const phone = document.createElement('html')
    const tv = document.createElement('html')

    applyCompatClasses(phone, () => true, PIXEL, 5)
    applyCompatClasses(tv, () => true, ANDROID_TV_WEBVIEW, 0)

    expect(phone.classList.contains('is-phone')).toBe(true)
    expect(tv.classList.contains('is-phone')).toBe(false)
  })
})

describe('celular em pé (RFC-023)', () => {
  it('phone-portrait: só vale com is-phone e em pé; a TV nunca pega', async () => {
    const css = await buildCss('<div class="phone-portrait:hidden phone:px-4"></div>')

    expect(css).toContain('@media(orientation:portrait){html.is-phone.phone-portrait\\:hidden{display:none}}')
    expect(css).toContain('html.is-phone.phone\\:px-4{')
  })

  it('a escala em pé fica atrás de is-phone (TV girada ou janela estreita do PC não mudam)', () => {
    const css = compact(readFileSync('src/style.css', 'utf8'))

    expect(css).toContain('@media(orientation:portrait){html.is-phone{font-size:calc(100vw/25);}}')
    expect(css).toContain('@media(orientation:portrait)and(min-width:600px){html.is-phone{font-size:calc(100vw/45);}}')
    expect(css).toContain('html{font-size:calc(100vw/120);}')
  })

  it('em pé, sem anel nem zoom de foco no toque; a TV continua com o foco de sempre', () => {
    const css = compact(readFileSync('src/style.css', 'utf8'))

    expect(css).toContain('@media(orientation:portrait){html.is-phone.tv-focusable:focus,html.is-phone.tv-focusable.is-focused{--tw-ring-shadow:00#0000;')
    expect(css).toContain('.tv-focusable:focus,.tv-focusable.is-focused{@applyoutline-nonering-2ring-white')
  })

  function mockOrientation(portrait) {
    const listeners = []
    const query = {
      matches: portrait,
      addEventListener: (_type, fn) => listeners.push(fn),
      removeEventListener: (_type, fn) => listeners.splice(listeners.indexOf(fn), 1),
    }
    window.matchMedia = () => query
    return { rotate: (next) => listeners.forEach((fn) => fn({ matches: next })), listeners }
  }

  it('useFormFactor: celular troca entre em pé e deitado ao girar; TV fica "tv" mesmo com tela em pé', async () => {
    const screen = mockOrientation(true)
    vi.doMock('@/utils/compat', () => ({ isPhone: () => true }))
    const { useFormFactor } = await import('@/composables/useFormFactor')
    const { layout, isPhonePortrait } = useFormFactor()
    expect(layout.value).toBe('phone-portrait')
    expect(isPhonePortrait.value).toBe(true)
    screen.rotate(false)
    expect(layout.value).toBe('phone-landscape')

    vi.resetModules()
    vi.doMock('@/utils/compat', () => ({ isPhone: () => false }))
    const tv = (await import('@/composables/useFormFactor')).useFormFactor()
    expect(tv.layout.value).toBe('tv')
    vi.doUnmock('@/utils/compat')
  })
})
