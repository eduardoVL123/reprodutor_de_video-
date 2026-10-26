import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

/**
 * Guarda de deploy do servidor de pareamento no Cloudflare Workers (RFC-017).
 * Vigia para que configurações críticas de segurança e limites do plano grátis não sejam
 * quebradas por edições descuidadas.
 */

const read = (file) => readFileSync(file, 'utf8')

describe('configuração do Cloudflare Workers (server/pair/wrangler.jsonc)', () => {
  const configFile = 'server/pair/wrangler.jsonc'

  it('o arquivo de configuração existe e é um JSON válido', () => {
    expect(existsSync(configFile)).toBe(true)
    const content = read(configFile)
    // Remove comentários simples se houver antes do JSON.parse
    const sanitized = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
    const parsed = JSON.parse(sanitized)
    expect(parsed.name).toBe('pulse-pair')
    expect(parsed.main).toBe('worker.mjs')
  })

  it('data de compatibilidade está configurada com data no formato YYYY-MM-DD', () => {
    const parsed = JSON.parse(read(configFile).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''))
    expect(parsed.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('observabilidade e logs do Worker estão desligados por privacidade', () => {
    const parsed = JSON.parse(read(configFile).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''))
    expect(parsed.observability).toBeDefined()
    expect(parsed.observability.enabled).toBe(false)
  })

  it('configura ativos estáticos com run_worker_first para interceptar rotas antes dos arquivos', () => {
    const parsed = JSON.parse(read(configFile).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''))
    expect(parsed.assets).toEqual({
      directory: './public',
      binding: 'ASSETS',
      run_worker_first: true,
    })
  })

  it('Durable Object PairHub usa SQLite (exigência do plano grátis do Cloudflare)', () => {
    const parsed = JSON.parse(read(configFile).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''))
    expect(parsed.durable_objects).toBeDefined()
    expect(parsed.durable_objects.bindings).toContainEqual({
      name: 'PAIR',
      class_name: 'PairHub',
    })

    expect(parsed.migrations).toBeDefined()
    expect(parsed.migrations).toContainEqual(
      expect.objectContaining({
        new_sqlite_classes: expect.arrayContaining(['PairHub']),
      })
    )
  })

  it('não contém nenhum ID de conta, token, segredo ou domínio fixo gravado', () => {
    const raw = read(configFile)
    expect(raw).not.toMatch(/account_id/i)
    expect(raw).not.toMatch(/zone_id/i)
    expect(raw).not.toMatch(/api_token/i)
    expect(raw).not.toMatch(/par\.pulseplayer/i)
    expect(raw).not.toMatch(/pulseplayer\.com\.br/i)
  })
})

describe('remoção da infraestrutura antiga de VM (Docker e Caddy)', () => {
  it('Dockerfile e pasta deploy não existem mais (substituídos pelo Cloudflare Worker)', () => {
    expect(existsSync('server/pair/Dockerfile')).toBe(false)
    expect(existsSync('server/pair/deploy')).toBe(false)
  })
})

describe('scripts no package.json', () => {
  it('contém os scripts pair:dev e pair:deploy para o Worker e mantém pair local', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['pair']).toBe('node server/pair/pair-server.mjs')
    expect(pkg.scripts['pair:dev']).toContain('wrangler dev')
    expect(pkg.scripts['pair:dev']).toContain('8788')
    expect(pkg.scripts['pair:deploy']).toContain('wrangler deploy')
  })
})

describe('CI (.github/workflows/build-apk.yml)', () => {
  const workflow = () => read('.github/workflows/build-apk.yml')

  it('o build do app continua recebendo VITE_PAIR_BASE_URL', () => {
    expect(workflow()).toContain('VITE_PAIR_BASE_URL: ${{ vars.PULSE_PAIR_BASE_URL }}')
  })

  it('o job pair-server valida o Worker com wrangler deploy --dry-run sem Docker', () => {
    expect(workflow()).not.toMatch(/docker build/i)
    expect(workflow()).toMatch(/wrangler deploy --dry-run/i)
  })
})
