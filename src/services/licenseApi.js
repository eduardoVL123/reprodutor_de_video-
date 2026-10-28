/**
 * Chamadas do app ao serviço de licença (RFC-018, server/license).
 * O endereço vem de `VITE_LICENSE_BASE_URL`; vazio = recurso desligado e o app funciona como antes.
 * G3: o corpo leva só deviceKey, platform e o domínio da lista.
 */

const REQUEST_TIMEOUT_MS = 8000

export class LicenseError extends Error {}

function baseUrl() {
  return String(import.meta.env.VITE_LICENSE_BASE_URL || '').trim().replace(/\/+$/, '')
}

export function isLicenseEnabled() {
  return !!baseUrl()
}

/** Versão das lojas (D4): a tela de bloqueio não mostra preço nem QR de pagamento. */
export function isStoreBuild() {
  return String(import.meta.env.VITE_LICENSE_STORE_BUILD || '') === '1'
}

/** Página de planos aberta pelo QR da tela de ativação. */
export function plansPageUrl(code) {
  return `${baseUrl()}/a/${code}`
}

/** POST com tempo limite por Promise.race (TVs com Chromium < 66 não têm AbortController). */
async function post(path, body) {
  if (!baseUrl()) throw new LicenseError('desligado')
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new LicenseError('tempo esgotado')), REQUEST_TIMEOUT_MS)
  })
  try {
    const res = await Promise.race([
      fetch(baseUrl() + path, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      timeout,
    ])
    if (!res.ok) throw new LicenseError(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    throw err instanceof LicenseError ? err : new LicenseError(err && err.message)
  } finally {
    clearTimeout(timer)
  }
}

/** @returns {Promise<{access: 'trial'|'partner'|'activated'|'blocked', code: string, trialEndsAt: number, activationEndsAt: number|null}>} */
export const checkAccess = ({ deviceKey, platform, host }) => post('/v1/access', { deviceKey, platform, host })

export const sendEntry = ({ deviceKey, platform, host }) => post('/v1/entry', { deviceKey, platform, host })
