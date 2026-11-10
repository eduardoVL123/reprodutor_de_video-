import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'
import { licenseSignedText } from '../server/license/license-rules.mjs'
import { generateCode, CODE_ALPHABET } from '../server/pair/pair-core.mjs'

const brt = (y, m, d, h = 12, min = 0) => Date.UTC(y, m - 1, d, h + 3, min)
const KEY = 'a'.repeat(64)

let db
let clock
let handle

async function post(path, body, ip = '10.0.0.1') {
  const res = await handle(
    new Request(`http://license.test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    ip,
  )
  return { status: res.status, body: res.status < 300 ? await res.json() : null }
}

async function addPartner(host, startedOn, active = 1) {
  const r = await db.prepare('INSERT INTO partners (name, started_on, active) VALUES (?, ?, ?)').bind('Parceiro', startedOn, active).run()
  await db.prepare('INSERT INTO partner_hosts (host, partner_id) VALUES (?, ?)').bind(host, r.meta.last_row_id).run()
  return r.meta.last_row_id
}

beforeEach(async () => {
  db = openSqlite(':memory:')
  await migrate(db)
  clock = brt(2026, 3, 20)
  handle = createLicenseHandler({ db, now: () => clock, adminToken: 'segredo' })
})

describe('pair-core — código de tamanho variável (reuso na licença)', () => {
  it('gera código com o tamanho pedido, só com o alfabeto sem ambíguos', () => {
    const code = generateCode(null, 8)
    expect(code).toHaveLength(8)
    expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true)
  })
})

describe('licença — /v1/hello', () => {
  it('aparelho novo ganha código de 8 caracteres e 7 dias de teste pelo relógio do servidor', async () => {
    const { status, body } = await post('/v1/hello', { deviceKey: KEY, platform: 'android', now: 0 })
    expect(status).toBe(200)
    expect(body.code).toHaveLength(8)
    expect(body.trialEndsAt).toBe(clock + 7 * 24 * 3600e3)
    expect(body.serverTime).toBe(clock)
    expect(body.activationEndsAt).toBeNull()
  })

  it('reinstalar (hello de novo com a mesma chave) não renova o teste nem troca o código', async () => {
    const first = (await post('/v1/hello', { deviceKey: KEY, platform: 'android' })).body
    clock += 3 * 24 * 3600e3
    const again = (await post('/v1/hello', { deviceKey: KEY, platform: 'android' })).body
    expect(again.code).toBe(first.code)
    expect(again.trialEndsAt).toBe(first.trialEndsAt)
  })

  it('recusa chave vazia, curta demais ou com caracteres estranhos', async () => {
    for (const deviceKey of ['', 'abc', 'x'.repeat(200), 'chave com espaço e acento ção ok?']) {
      expect((await post('/v1/hello', { deviceKey, platform: 'web' })).status).toBe(400)
    }
  })

  it('recusa corpo maior que 4 KB', async () => {
    expect((await post('/v1/hello', { deviceKey: KEY, platform: 'web', pad: 'x'.repeat(5000) })).status).toBe(413)
  })
})

describe('licença — /v1/access', () => {
  it('no teste qualquer lista libera como teste', async () => {
    const { body } = await post('/v1/access', { deviceKey: KEY, host: 'sem-parceria.com' })
    expect(body.access).toBe('trial')
  })

  it('depois do teste: parceiro libera, parceiro inativo e lista sem parceria bloqueiam', async () => {
    await addPartner('parceiro.com', '2026-04-02')
    await addPartner('encerrado.com', '2026-04-02', 0)
    await post('/v1/hello', { deviceKey: KEY, platform: 'android' })
    clock = brt(2026, 4, 5)
    expect((await post('/v1/access', { deviceKey: KEY, host: 'http://PARCEIRO.com:8080/get.php' })).body.access).toBe('partner')
    expect((await post('/v1/access', { deviceKey: KEY, host: 'encerrado.com' })).body.access).toBe('blocked')
    expect((await post('/v1/access', { deviceKey: KEY, host: 'outra.com' })).body.access).toBe('blocked')
  })

  it('parceria que ainda não começou não libera', async () => {
    await addPartner('futuro.com', '2026-05-01')
    await post('/v1/hello', { deviceKey: KEY, platform: 'android' })
    clock = brt(2026, 4, 5)
    expect((await post('/v1/access', { deviceKey: KEY, host: 'futuro.com' })).body.access).toBe('blocked')
  })
})

describe('licença — /v1/entry', () => {
  beforeEach(async () => {
    await addPartner('parceiro.com', '2026-04-02')
    await post('/v1/hello', { deviceKey: KEY, platform: 'android' }) // teste acaba em 27/03
  })

  const entryRow = () => db.prepare('SELECT * FROM partner_cycle_entries WHERE device_key = ?').bind(KEY).first()

  it('entrada durante o teste não é gravada', async () => {
    clock = brt(2026, 3, 22)
    await addPartner('cedo.com', '2026-03-01')
    expect((await post('/v1/entry', { deviceKey: KEY, host: 'cedo.com' })).body.recorded).toBe(false)
  })

  it('depois do teste, entrada em lista de parceiro é gravada no ciclo atual', async () => {
    clock = brt(2026, 4, 5, 10)
    expect((await post('/v1/entry', { deviceKey: KEY, host: 'parceiro.com' })).body.recorded).toBe(true)
    expect(await entryRow()).toMatchObject({ cycle_start: '2026-04-02', first_at: clock, last_at: clock })
  })

  it('lista sem parceria não grava', async () => {
    clock = brt(2026, 4, 5)
    expect((await post('/v1/entry', { deviceKey: KEY, host: 'outra.com' })).body.recorded).toBe(false)
  })

  it('aparelho com ativação anual não conta para o parceiro', async () => {
    clock = brt(2026, 4, 5)
    await db
      .prepare('INSERT INTO activations (device_key, starts_at, ends_at, source) VALUES (?, ?, ?, ?)')
      .bind(KEY, clock, clock + 365 * 24 * 3600e3, 'manual')
      .run()
    expect((await post('/v1/entry', { deviceKey: KEY, host: 'parceiro.com' })).body.recorded).toBe(false)
  })

  it('repetir a entrada várias vezes não infla nada e mantém a primeira', async () => {
    clock = brt(2026, 4, 5, 10)
    const first = clock
    for (let i = 0; i < 5; i++) {
      await post('/v1/entry', { deviceKey: KEY, host: 'parceiro.com' })
      clock += 1000
    }
    const rows = await db.prepare('SELECT COUNT(*) AS n FROM partner_cycle_entries').first()
    expect(rows.n).toBe(1)
    expect((await entryRow()).first_at).toBe(first)
  })

  it('05/04 10:00 e 06/04 10:00 deixam 24 h entre a primeira e a última entrada', async () => {
    clock = brt(2026, 4, 5, 10)
    await post('/v1/entry', { deviceKey: KEY, host: 'parceiro.com' })
    clock = brt(2026, 4, 6, 10)
    await post('/v1/entry', { deviceKey: KEY, host: 'parceiro.com' })
    const row = await entryRow()
    expect(row.last_at - row.first_at).toBe(24 * 3600e3)
  })

  it('não grava nada além da chave, plataforma e domínio, mesmo que o corpo traga mais', async () => {
    clock = brt(2026, 4, 5)
    await post('/v1/entry', { deviceKey: KEY, host: 'http://user:S3nh@@parceiro.com/get.php', password: 'S3nh@', username: 'joao' })
    const dump = JSON.stringify([
      ...(await db.prepare('SELECT * FROM devices').all()).results,
      ...(await db.prepare('SELECT * FROM partner_cycle_entries').all()).results,
    ])
    expect(dump).not.toMatch(/S3nh|joao|get\.php/)
  })
})

describe('licença — limites e rotas', () => {
  it('rota desconhecida é 404', async () => {
    expect((await post('/v1/nada', {})).status).toBe(404)
  })

  it('muitos hello do mesmo IP em 1 minuto viram 429', async () => {
    const statuses = []
    for (let i = 0; i < 35; i++) {
      statuses.push((await post('/v1/hello', { deviceKey: `${'b'.repeat(60)}${String(i).padStart(4, '0')}`, platform: 'web' })).status)
    }
    expect(statuses).toContain(429)
  })
})

describe('licença — guarda de 24 meses (PRIVACY.md)', () => {
  it('apaga entradas, ativações vencidas e aparelhos parados há mais de 24 meses; mantém o recente', async () => {
    const { purgeExpired, RETENTION_MS } = await import('../server/license/license-db.mjs')
    const old = 'o'.repeat(64)
    await post('/v1/hello', { deviceKey: old, platform: 'web' })
    await addPartner('velho.com', '2026-03-01')
    clock = brt(2026, 4, 5)
    await post('/v1/entry', { deviceKey: old, host: 'velho.com' })
    await db.prepare('INSERT INTO activations (device_key, starts_at, ends_at, source) VALUES (?, ?, ?, ?)').bind(old, clock, clock + 1000, 'manual').run()
    const order = (id, at) =>
      db
        .prepare("INSERT INTO orders (id, kind, method, buyer_name, quantity, amount_cents, status, view_secret_hash, created_at, expires_at) VALUES (?, 'credits', 'pix', 'Zé', 10, 10000, 'delivered', 'h', ?, ?)")
        .bind(id, at, at)
        .run()
    await order('velho', clock)
    await db.prepare("INSERT INTO device_events (device_key, action, actor, created_at) VALUES (?, 'block', 'admin', ?)").bind(old, clock).run()

    clock += RETENTION_MS + 24 * 3600e3
    await order('novo', clock)
    const fresh = 'n'.repeat(64)
    await post('/v1/hello', { deviceKey: fresh, platform: 'web' })
    await purgeExpired(db, clock)

    const count = async (table) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n
    expect(await count('partner_cycle_entries')).toBe(0)
    expect(await count('activations')).toBe(0)
    expect(await count('device_events')).toBe(0) // o histórico vai junto com o aparelho
    expect((await db.prepare('SELECT device_key FROM devices').all()).results.map((r) => r.device_key)).toEqual([fresh])
    expect((await db.prepare('SELECT id FROM orders').all()).results.map((r) => r.id)).toEqual(['novo']) // pedidos também
  })
})

describe('licença — aparelhos novos por IP (fraude contra parceiro)', () => {
  const access = (deviceKey, ip) => post('/v1/access', { deviceKey, host: 'x.com' }, ip)
  const key = (i) => `${'k'.repeat(60)}${String(i).padStart(4, '0')}`

  it('cada rede IPv6 (/64) cria no máximo 20 aparelhos por dia; os que já existem seguem funcionando', async () => {
    for (let i = 0; i < 20; i++) expect((await access(key(i), '2001:db8:9::9')).status).toBe(200)
    clock += 2 * 60 * 1000 // passa a janela de 1 minuto: o limite de aparelhos novos é por dia
    expect((await access(key(20), '2001:db8:9::9')).status).toBe(429)
    expect((await access(key(0), '2001:db8:9::9')).status).toBe(200)
    expect((await access(key(20), '2001:db8:8::8')).status).toBe(200)
  })

  it('no dia seguinte o mesmo IP volta a poder criar', async () => {
    for (let i = 0; i < 20; i++) await access(key(i), '2001:db8:9::9')
    clock += 24 * 3600e3
    expect((await access(key(21), '2001:db8:9::9')).status).toBe(200)
  })

  it('IPv4 (CGNAT: um IP para milhares de clientes) aceita mais aparelhos novos por dia (auditoria 7)', async () => {
    for (let i = 0; i < 21; i++) {
      if (i === 20) clock += 2 * 60 * 1000 // passa a janela de 1 minuto
      expect((await access(key(i), '10.9.9.9')).status).toBe(200)
    }
  })

  it('o núcleo expõe a limpeza dos contadores para o servidor chamar de tempos em tempos', () => {
    expect(typeof handle.sweep).toBe('function')
    expect(() => handle.sweep()).not.toThrow()
  })
})

describe('assinatura de /v1/access (LICENSE_SIGNING_KEY)', () => {
  it('chave gravada pelo PowerShell (BOM no início e quebra de linha no fim) ainda assina, sem 500', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const priv = '﻿' + JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)) + '\r\n'
    const db = openSqlite(':memory:')
    await migrate(db)
    const handle = createLicenseHandler({ db, now: () => Date.UTC(2026, 10, 4), signingKey: priv })
    const res = await handle(new Request('http://license.test/v1/access', { method: 'POST', body: JSON.stringify({ deviceKey: 'b'.repeat(32), platform: 'android', host: '' }) }), '10.0.0.2')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.code).toMatch(/^[A-Z0-9]{8}$/)
    expect(body.sig).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('chave estragada (vazia, só BOM, ou JSON que não é chave) não derruba o /v1/access: responde sem assinatura', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const [n, bad] of ['﻿', '﻿\r\n', 'não é json', '{"kty":"EC"}'].entries()) {
      const db = openSqlite(':memory:')
      await migrate(db)
      const handle = createLicenseHandler({ db, now: () => Date.UTC(2026, 10, 4), signingKey: bad })
      const res = await handle(new Request('http://license.test/v1/access', { method: 'POST', body: JSON.stringify({ deviceKey: `c${n}`.repeat(16), platform: 'android', host: '' }) }), '10.0.0.3')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.code).toMatch(/^[A-Z0-9]{8}$/)
      expect(body.sig).toBeUndefined()
    }
    expect(warn.mock.calls.flat().join(' ')).toMatch(/LICENSE_SIGNING_KEY/)
    warn.mockRestore()
  })

  it('chave gravada em UTF-16 pelo PowerShell (FF FE + byte nulo em cada letra) também funciona', async () => {
    const { cleanJwk } = await import('../server/license/license-sign.mjs')
    const json = JSON.stringify({ kty: 'EC', crv: 'P-256', d: 'abc' })
    const utf16AsUtf8 = '��' + [...json].map((c) => c + '\u0000').join('') + '\r\u0000\n\u0000'
    expect(JSON.parse(cleanJwk(utf16AsUtf8))).toEqual({ kty: 'EC', crv: 'P-256', d: 'abc' })
  })

  it('assina o acesso para a chave do aparelho e a lista; a chave pública confere', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const priv = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
    const db = openSqlite(':memory:')
    await migrate(db)
    const handle = createLicenseHandler({ db, now: () => Date.UTC(2026, 10, 3), signingKey: priv })
    const deviceKey = 'a'.repeat(32)
    const res = await handle(
      new Request('http://license.test/v1/access', { method: 'POST', body: JSON.stringify({ deviceKey, platform: 'tizen', host: 'HTTP://Lista.com:8080/x' }) }),
      '10.0.0.1',
    )
    const body = await res.json()
    expect(body.sig).toMatch(/^[A-Za-z0-9_-]+$/)
    const sig = Uint8Array.from(atob(body.sig.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (body.sig.length % 4)) % 4)), (c) => c.charCodeAt(0))
    const verify = (host) =>
      crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, new TextEncoder().encode(licenseSignedText({ ...body, deviceKey, host })))
    expect(await verify('lista.com')).toBe(true)
    expect(await verify('outra.com')).toBe(false)
  })

  it('aceita a plataforma desktop (app de PC)', async () => {
    const db = openSqlite(':memory:')
    await migrate(db)
    const handle = createLicenseHandler({ db, now: () => Date.UTC(2026, 10, 3) })
    await handle(new Request('http://license.test/v1/access', { method: 'POST', body: JSON.stringify({ deviceKey: 'c'.repeat(64), platform: 'desktop', host: 'x.com' }) }), '10.0.0.2')
    expect((await db.prepare('SELECT platform FROM devices').first()).platform).toBe('desktop')
  })

  it('com nonce do app, a assinatura cobre o nonce (resposta gravada não serve para outra consulta)', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const db = openSqlite(':memory:')
    await migrate(db)
    const handle = createLicenseHandler({ db, now: () => Date.UTC(2026, 10, 3), signingKey: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)) })
    const deviceKey = 'a'.repeat(32)
    const nonce = 'f'.repeat(32)
    const res = await handle(new Request('http://license.test/v1/access', { method: 'POST', body: JSON.stringify({ deviceKey, host: 'lista.com', nonce }) }), '10.0.0.1')
    const body = await res.json()
    const sig = Uint8Array.from(atob(body.sig.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (body.sig.length % 4)) % 4)), (c) => c.charCodeAt(0))
    const verify = (n) =>
      crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, new TextEncoder().encode(licenseSignedText({ ...body, deviceKey, host: 'lista.com', nonce: n })))
    expect(await verify(nonce)).toBe(true)
    expect(await verify('0'.repeat(32))).toBe(false)
    expect(await verify(undefined)).toBe(false)
  })
})
