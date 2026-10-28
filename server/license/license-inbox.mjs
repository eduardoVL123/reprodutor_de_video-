/**
 * Caixa de entrada cifrada da TV (RFC-021): o site cifra a lista no navegador para a chave pública da TV
 * (`devices.inbox_pub`, publicada no /v1/access) e o servidor guarda só o texto cifrado até a TV buscar.
 * Mesmo formato do pareamento (RFC-016): `seal` em pair-lib.js, `open` em src/services/pairingCrypto.js.
 */
import { readJsonBody, BASE64URL, MAX_BOX_CHARS, MAX_PUB_CHARS } from '../pair/pair-core.mjs'
import { DAY_MS } from './license-rules.mjs'
import { findDevice, findDeviceByCode } from './license-db.mjs'

export const INBOX_TTL_MS = 7 * DAY_MS
export const INBOX_MAX_PENDING = 3
export const INBOX_LIMITS = { inboxKey: 30, inboxSend: 10, inboxPull: 30 }
const DEVICE_KEY = /^[A-Za-z0-9_-]{16,128}$/
const KEY_ROUTE = /^\/v1\/inbox\/([A-Za-z0-9]{4,16})\/key$/
const SEND_ROUTE = /^\/v1\/inbox\/([A-Za-z0-9]{4,16})$/
const NOT_READY = 'Código não encontrado. Abra o Pulse Player na TV uma vez (com internet) e tente de novo.'

/** Chave pública da TV em base64url (P-256 crua = 87 caracteres); outra coisa é ignorada. */
export const validPub = (pub) => typeof pub === 'string' && pub.length >= 40 && pub.length <= MAX_PUB_CHARS && BASE64URL.test(pub)

const validBox = (box) => typeof box === 'string' && box.length > 0 && box.length <= MAX_BOX_CHARS && BASE64URL.test(box)

export function createInboxRoutes({ db, now, json, limiter }) {
  function throttled(bucket, ip) {
    const wait = limiter.retryAfter(bucket, ip, INBOX_LIMITS[bucket])
    if (wait) return json(429, { error: 'Muitas tentativas. Aguarde um pouco.' }, { 'Retry-After': String(wait) })
    limiter.add(bucket, ip)
    return null
  }

  async function deviceFromBody(body) {
    if (typeof body.deviceKey !== 'string' || !DEVICE_KEY.test(body.deviceKey)) return null
    return findDevice(db, body.deviceKey)
  }

  async function send(code, request) {
    const body = await readJsonBody(request, MAX_BOX_CHARS + 512)
    if (!validBox(body.box)) return json(400, { error: 'Envie a lista cifrada pelo site do Pulse Player.' })
    const device = await findDeviceByCode(db, code.toUpperCase())
    if (!device || !device.inbox_pub) return json(404, { error: NOT_READY })
    const at = now()
    await db.batch([
      db.prepare('INSERT INTO inbox (device_key, box, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(device.device_key, body.box, at, at + INBOX_TTL_MS),
      // Fica só as INBOX_MAX_PENDING mais novas: a mais antiga sai.
      db
        .prepare('DELETE FROM inbox WHERE device_key = ? AND id NOT IN (SELECT id FROM inbox WHERE device_key = ? ORDER BY id DESC LIMIT ?)')
        .bind(device.device_key, device.device_key, INBOX_MAX_PENDING),
    ])
    return json(201, { sent: true })
  }

  return async function handleInbox(request, url, ip) {
    try {
      if (request.method === 'GET') {
        const match = url.pathname.match(KEY_ROUTE)
        if (!match) return json(404, { error: 'Não encontrado.' })
        const limited = throttled('inboxKey', ip)
        if (limited) return limited
        const device = await findDeviceByCode(db, match[1].toUpperCase())
        return device && device.inbox_pub ? json(200, { pub: device.inbox_pub }) : json(404, { error: NOT_READY })
      }
      if (request.method !== 'POST') return json(404, { error: 'Não encontrado.' })

      if (url.pathname === '/v1/inbox/pull' || url.pathname === '/v1/inbox/ack') {
        const limited = throttled('inboxPull', ip)
        if (limited) return limited
        const body = await readJsonBody(request, 4096)
        const device = await deviceFromBody(body)
        if (!device) return json(200, url.pathname.endsWith('pull') ? [] : { acked: 0 })
        if (url.pathname.endsWith('pull')) {
          const rows = await db.prepare('SELECT id, box FROM inbox WHERE device_key = ? AND expires_at > ? ORDER BY id').bind(device.device_key, now()).all()
          return json(200, rows.results.map((r) => ({ id: r.id, box: r.box })))
        }
        const ids = (Array.isArray(body.ids) ? body.ids : []).filter(Number.isInteger).slice(0, INBOX_MAX_PENDING * 2)
        for (const id of ids) await db.prepare('DELETE FROM inbox WHERE id = ? AND device_key = ?').bind(id, device.device_key).run()
        return json(200, { acked: ids.length })
      }

      const match = url.pathname.match(SEND_ROUTE)
      if (!match) return json(404, { error: 'Não encontrado.' })
      const limited = throttled('inboxSend', ip)
      if (limited) return limited
      return await send(match[1], request)
    } catch (err) {
      return json(err.status || 500, { error: err.status ? err.message : 'Erro interno.' })
    }
  }
}
