import { describe, it, expect } from 'vitest'
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

    expect(css).toContain('.gap-4{gap:1rem;}')
    expect(css).toContain('.no-flex-gap.gap-4.flex:not(.flex-col)>*+*{margin-left:1rem;}')
  })

  it('usa margem superior quando o flex é uma coluna', async () => {
    const css = await buildCss('<div class="flex flex-col gap-2"></div>')

    expect(css).toContain('.no-flex-gap.gap-2.flex.flex-col>*+*{margin-top:0.5rem;}')
  })

  it('não mexe em grades (grid gap tem suporte desde o Chromium 57)', async () => {
    const css = await buildCss('<div class="grid grid-cols-4 gap-5"></div>')

    expect(css).not.toContain('.no-flex-gap.gap-5.grid')
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
    expect(js.includes('Vue warn')).toBe(false) // build de produção do Vue
  }, 180000)
})

describe('detecção de celular', () => {
  const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
  const ANDROID_TV = 'Mozilla/5.0 (Linux; Android 11; BRAVIA 4K UR2) AppleWebKit/537.36 Chrome/96.0 Safari/537.36'
  const TABLET = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
  const TIZEN = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 Chrome/63.0 TV Safari/537.36'
  const WEBOS = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0 Safari/537.36 WebAppManager'

  it.each([
    [PIXEL, true],
    [IPHONE, true],
    [ANDROID_TV, false],
    [TABLET, false],
    [TIZEN, false],
    [WEBOS, false],
  ])('isPhone(%s) = %s', async (ua, expected) => {
    const { isPhone } = await import('@/utils/compat')

    expect(isPhone(ua)).toBe(expected)
  })

  it('marca o <html> com is-phone só em celular', async () => {
    const { applyCompatClasses } = await import('@/utils/compat')
    const phone = document.createElement('html')
    const tv = document.createElement('html')

    applyCompatClasses(phone, () => true, PIXEL)
    applyCompatClasses(tv, () => true, ANDROID_TV)

    expect(phone.classList.contains('is-phone')).toBe(true)
    expect(tv.classList.contains('is-phone')).toBe(false)
  })
})
