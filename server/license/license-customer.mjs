/**
 * Área do cliente sem conta (RFC-025 §3, página /cliente): pelo código da TV, ver até quando está ativo e cancelar a
 * renovação automática (com o e-mail do pagamento). Não vira detector de códigos: código inexistente, vencido ou
 * suspenso dão a mesma resposta (`none`), e erros seguidos travam a rede (D1).
 */
import { readJsonBody, CODE_ALPHABET } from '../pair/pair-core.mjs'
import { DAY_MS } from './license-rules.mjs'
import { findDeviceByCode, activationEndsAt, hitLimit, lockedFor } from './license-db.mjs'

const HOUR_MS = 60 * 60 * 1000
const MAX_BODY = 1024
const CODE = new RegExp(`^[${CODE_ALPHABET}]{8}$`)
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/
/** Por minuto na memória do isolate; por hora/dia no D1 (vale para o serviço todo). */
export const CUSTOMER_LIMITS = { deviceStatus: 20, subscriptionCancel: 5 }
export const CUSTOMER_DB_LIMITS = {
  statusPerNetworkHour: 60,
  missPerNetworkHour: 15,
  cancelPerNetworkHour: 5,
  cancelPerCodeDay: 5,
}
const TOO_MANY = 'Muitas tentativas. Aguarde um pouco.'

export function createCustomerRoutes({ db, now, json, limiter, checkout, dbLimits = CUSTOMER_DB_LIMITS }) {
  const busy = (seconds) => json(429, { error: TOO_MANY }, { 'Retry-After': String(seconds) })

  function throttled(bucket, ip) {
    const wait = limiter.retryAfter(bucket, ip, CUSTOMER_LIMITS[bucket])
    if (wait) return busy(wait)
    limiter.add(bucket, ip)
    return null
  }

  async function readCode(request) {
    const body = await readJsonBody(request, MAX_BODY)
    const code = String(body.code || '').trim().toUpperCase()
    return { body, code: CODE.test(code) ? code : null }
  }

  /** Só estado e data; nada de plataforma, revenda, parceiro, e-mail ou valores. */
  async function deviceStatus(request, ip) {
    const at = now()
    const miss = { bucket: 'statusMiss', key: ip, limit: dbLimits.missPerNetworkHour, windowMs: HOUR_MS }
    const missWait = await lockedFor(db, { ...miss, now: at })
    if (missWait) return busy(missWait)
    const netWait = await hitLimit(db, { bucket: 'statusNet', key: ip, limit: dbLimits.statusPerNetworkHour, windowMs: HOUR_MS, now: at })
    if (netWait) return busy(netWait)

    const { code } = await readCode(request)
    if (!code) return json(400, { error: 'Digite os 8 caracteres do código que aparece na TV.' })
    const device = await findDeviceByCode(db, code)
    // Mesmas consultas com ou sem aparelho: a resposta não sai mais rápida para código inexistente.
    const activationEnd = await activationEndsAt(db, device ? device.device_key : '')
    const sub = await db.prepare("SELECT 1 AS open FROM subscriptions WHERE device_code = ? AND status <> 'cancelled' LIMIT 1").bind(code).first()
    const usable = device && !device.blocked_at
    if (usable && activationEnd && activationEnd > at) return json(200, { state: 'active', until: activationEnd, renews: !!sub })
    if (usable && device.trial_ends_at > at) return json(200, { state: 'trial', until: device.trial_ends_at, renews: false })
    await hitLimit(db, { ...miss, now: at })
    return json(200, { state: 'none', until: null, renews: false })
  }

  async function cancelRenewal(request, ip) {
    const at = now()
    const netWait = await hitLimit(db, { bucket: 'cancelNet', key: ip, limit: dbLimits.cancelPerNetworkHour, windowMs: HOUR_MS, now: at })
    if (netWait) return busy(netWait)
    const { body, code } = await readCode(request)
    if (!code) return json(400, { error: 'Digite os 8 caracteres do código que aparece na TV.' })
    const email = String(body.email || '').trim()
    if (!EMAIL.test(email) || email.length > 254) return json(400, { error: 'Informe o e-mail usado no pagamento.' })
    const codeWait = await hitLimit(db, { bucket: 'cancelCode', key: code, limit: dbLimits.cancelPerCodeDay, windowMs: DAY_MS, now: at })
    if (codeWait) return busy(codeWait)
    return json(200, await checkout.cancelForPayer(code, email))
  }

  const routes = { '/v1/device-status': ['deviceStatus', deviceStatus], '/v1/subscription/cancel': ['subscriptionCancel', cancelRenewal] }

  /** null = não é rota daqui. */
  return async function handleCustomer(request, url, ip) {
    const route = routes[url.pathname]
    if (!route) return null
    if (request.method !== 'POST') return json(404, { error: 'Não encontrado.' })
    const limited = throttled(route[0], ip)
    if (limited) return limited
    try {
      return await route[1](request, ip)
    } catch (err) {
      if (err.status) return json(err.status, { error: err.message })
      throw err
    }
  }
}
