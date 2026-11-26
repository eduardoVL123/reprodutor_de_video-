import { describe, it, expect, beforeEach } from 'vitest'
import { openSqlite } from '../server/license/sqlite-d1.mjs'
import { migrate } from '../server/license/license-db.mjs'
import { createLicenseHandler } from '../server/license/license-core.mjs'
import { licenseSignedText, normalizeHost } from '../server/license/license-rules.mjs'
import { parseRokuDate, validTransactionId, ROKU_VALIDATE_URL, ROKU_MAX_DEVICES } from '../server/license/license-roku.mjs'

/** Licença na Roku (docs/roku/domains/10-servidor.md, passos 1 a 3): Roku Pay vira ativação e a resposta sai em RSA. */

const NOW = Date.UTC(2026, 10, 24, 12)
const DAY = 24 * 60 * 60 * 1000
const TX = 'roku-tx-0001'

let db
let calls
let rokuReply

function rokuFetch(url) {
  calls.push(url)
  if (rokuReply instanceof Error) return Promise.reject(rokuReply)
  return Promise.resolve({ ok: rokuReply.status === undefined || rokuReply.status === 200, json: async () => rokuReply.body })
}

function handler(options = {}) {
  return createLicenseHandler({ db, now: () => options.now ?? NOW, rokuApiKey: 'chave-parceiro', rokuFetch, ...options })
}

async function access(handle, body, ip = '10.0.0.9') {
  const res = await handle(new Request('http://license.test/v1/access', { method: 'POST', body: JSON.stringify(body) }), ip)
  return res.json()
}

beforeEach(async () => {
  db = openSqlite(':memory:')
  await migrate(db)
  calls = []
  rokuReply = { body: { status: 'Success', isEntitled: true, expirationDate: '/Date(' + (NOW + 30 * DAY) + '+0000)/' } }
})

describe('Roku Pay — leitura da resposta', () => {
  it('lê a data nos formatos ISO, /Date(ms)/ dos serviços .svc e número', () => {
    expect(parseRokuDate('2026-12-01T00:00:00Z')).toBe(Date.UTC(2026, 11, 1))
    expect(parseRokuDate('/Date(1764547200000+0000)/')).toBe(1764547200000)
    expect(parseRokuDate('/Date(1764547200000)/')).toBe(1764547200000)
    expect(parseRokuDate(1764547200000)).toBe(1764547200000)
    expect(parseRokuDate('')).toBeNull()
    expect(parseRokuDate('ontem')).toBeNull()
    expect(parseRokuDate(null)).toBeNull()
  })

  it('só aceita transactionId com letras, números e hífen', () => {
    expect(validTransactionId('abc-123-def')).toBe('abc-123-def')
    expect(validTransactionId('../../x')).toBe('')
    expect(validTransactionId('curto')).toBe('')
    expect(validTransactionId(42)).toBe('')
  })
})

describe('Roku Pay — /v1/access', () => {
  it('aparelho Roku fica gravado como roku', async () => {
    const handle = handler()
    await access(handle, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '' })
    const row = await db.prepare('SELECT platform FROM devices WHERE device_key = ?').bind('r'.repeat(32)).first()
    expect(row.platform).toBe('roku')
  })

  it('assinatura ativa vira ativação até o fim do período, na API de parceiro da Roku com a chave e a compra', async () => {
    const handle = handler()
    const reply = await access(handle, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    expect(reply.access).toBe('activated')
    expect(reply.activationEndsAt).toBe(NOW + 30 * DAY)
    expect(calls[0]).toBe(`${ROKU_VALIDATE_URL}/chave-parceiro/${TX}`)
    // Abrir de novo logo depois não pergunta à Roku outra vez (cache) e não duplica a ativação.
    await access(handle, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    expect(calls.length).toBe(1)
    const rows = await db.prepare('SELECT COUNT(*) AS n FROM activations WHERE source = ?').bind('roku_pay').first()
    expect(rows.n).toBe(1)
  })

  it('renovação estende a mesma ativação; cancelamento revoga e o aparelho volta à regra normal', async () => {
    let clock = NOW
    const at = () => clock
    const h = createLicenseHandler({ db, now: at, rokuApiKey: 'chave-parceiro', rokuFetch })
    await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    clock = NOW + 11 * 60 * 1000 // passou o cache
    rokuReply = { body: { status: 'Success', isEntitled: true, expirationDate: new Date(NOW + 60 * DAY).toISOString() } }
    let reply = await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    expect(reply.activationEndsAt).toBe(NOW + 60 * DAY)
    clock = NOW + 22 * 60 * 1000
    rokuReply = { body: { status: 'Success', isEntitled: false, expirationDate: new Date(NOW).toISOString() } }
    reply = await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    expect(reply.access).toBe('trial')
    expect(reply.activationEndsAt).toBeNull()
  })

  it('aparelho Roku revogado no painel continua revogado (auditoria 2026-11-26, item 2)', async () => {
    let clock = NOW
    const h = createLicenseHandler({ db, now: () => clock, adminToken: 'x', rokuApiKey: 'chave-parceiro', rokuFetch })
    const first = await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    expect(first.access).toBe('activated')
    const res = await h(new Request(`http://license.test/admin/api/devices/${first.code}/revoke`, { method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: '{}' }), '10.0.0.1')
    expect(res.status).toBe(200)
    clock = NOW + 11 * 60 * 1000 // passou o cache: a Roku ainda diz que a assinatura vale
    const after = await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    expect(after.access).not.toBe('activated')
    expect(after.activationEndsAt).toBeNull()
  })

  it('Roku cancelada com um Pix empilhado depois dela: o Pix é puxado para trás, sem tempo grátis (auditoria 2026-11-26, item 9)', async () => {
    let clock = NOW
    const h = createLicenseHandler({ db, now: () => clock, rokuApiKey: 'chave-parceiro', rokuFetch })
    await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    // Pix comprado agora: começa agora e termina 1 ano depois do fim da Roku (extendActivation empilha).
    await db.prepare("INSERT INTO activations (device_key, starts_at, ends_at, source, created_by) VALUES (?, ?, ?, 'pix', 'checkout')").bind('r'.repeat(32), NOW, NOW + 30 * DAY + 365 * DAY).run()
    clock = NOW + 11 * 60 * 1000
    rokuReply = { body: { status: 'Success', isEntitled: false, expirationDate: new Date(NOW).toISOString() } }
    const reply = await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    expect(reply.activationEndsAt).toBe(NOW + 365 * DAY)
  })

  it('cancelada pela Roku e depois assinada de novo com a mesma compra: volta a ativar', async () => {
    let clock = NOW
    const h = createLicenseHandler({ db, now: () => clock, rokuApiKey: 'chave-parceiro', rokuFetch })
    await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    clock = NOW + 11 * 60 * 1000
    rokuReply = { body: { status: 'Success', isEntitled: false, expirationDate: new Date(NOW).toISOString() } }
    await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    clock = NOW + 22 * 60 * 1000
    rokuReply = { body: { status: 'Success', isEntitled: true, expirationDate: new Date(NOW + 60 * DAY).toISOString() } }
    const back = await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    expect(back.access).toBe('activated')
  })

  it('Roku fora do ar ou resposta estranha não muda nada (o estado anterior vale)', async () => {
    const h = createLicenseHandler({ db, now: () => NOW, rokuApiKey: 'chave-parceiro', rokuFetch })
    await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    for (const reply of [new Error('rede'), { status: 503, body: {} }, { body: 'texto' }]) {
      rokuReply = reply
      const other = createLicenseHandler({ db, now: () => NOW, rokuApiKey: 'chave-parceiro', rokuFetch })
      const state = await access(other, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
      expect(state.access).toBe('activated')
    }
  })

  it('compra que a Roku não reconhece (status de falha) não ativa', async () => {
    rokuReply = { body: { status: 'Failure', isEntitled: true, expirationDate: new Date(NOW + 30 * DAY).toISOString(), errorMessage: 'not found' } }
    const reply = await access(handler(), { deviceKey: 'r'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    expect(reply.access).toBe('trial')
  })

  it('outras plataformas e Roku sem chave de parceiro ignoram o transactionId', async () => {
    await access(handler(), { deviceKey: 'a'.repeat(32), platform: 'android', host: '', transactionId: TX })
    await access(createLicenseHandler({ db, now: () => NOW, rokuFetch }), { deviceKey: 'b'.repeat(32), platform: 'roku', host: '', transactionId: TX })
    expect(calls.length).toBe(0)
  })

  it(`a mesma compra libera até ${ROKU_MAX_DEVICES} aparelhos (a conta Roku inteira), não um número sem fim`, async () => {
    const h = handler()
    for (let i = 0; i < ROKU_MAX_DEVICES; i++) {
      const reply = await access(h, { deviceKey: `d${String(i).padStart(2, '0')}`.repeat(11).slice(0, 32), platform: 'roku', host: '', transactionId: TX }, `10.0.${i}.1`)
      expect(reply.access).toBe('activated')
    }
    const extra = await access(h, { deviceKey: 'z'.repeat(32), platform: 'roku', host: '', transactionId: TX }, '10.9.9.9')
    expect(extra.access).toBe('trial')
  })
})

describe('assinatura RSA da Roku (LICENSE_RSA_KEY)', () => {
  const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }

  it('Roku recebe sigRsa do mesmo texto assinado; a chave pública confere; as outras plataformas não', async () => {
    const pair = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])
    const rsaKey = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
    const h = createLicenseHandler({ db, now: () => NOW, rsaKey })
    const deviceKey = 'r'.repeat(32)
    const reply = await access(h, { deviceKey, platform: 'roku', host: 'http://Lista.com:8080/x', nonce: 'n'.repeat(22) })
    expect(reply.sigRsa).toMatch(/^[A-Za-z0-9_-]+$/)
    const text = licenseSignedText({ ...reply, deviceKey, host: normalizeHost('http://Lista.com:8080/x'), nonce: 'n'.repeat(22) })
    const sig = Uint8Array.from(atob(reply.sigRsa.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    expect(await crypto.subtle.verify(RSA, pair.publicKey, sig, new TextEncoder().encode(text))).toBe(true)
    expect(await crypto.subtle.verify(RSA, pair.publicKey, sig, new TextEncoder().encode(text.replace('trial', 'activated')))).toBe(false)

    const android = await access(h, { deviceKey: 'a'.repeat(32), platform: 'android', host: '' })
    expect(android.sigRsa).toBeUndefined()
  })

  it('chave RSA estragada não derruba o /v1/access: responde sem sigRsa', async () => {
    const h = createLicenseHandler({ db, now: () => NOW, rsaKey: '{"kty":"RSA"}' })
    const reply = await access(h, { deviceKey: 'r'.repeat(32), platform: 'roku', host: '' })
    expect(reply.code).toMatch(/^[A-Z0-9]{8}$/)
    expect(reply.sigRsa).toBeUndefined()
  })
})
