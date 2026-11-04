/**
 * Cliente mínimo da API do Mercado Pago (RFC-020) com `fetch`, sem SDK (decisão do dono). O `fetch` é injetável para
 * os testes nunca chamarem o Mercado Pago de verdade. Nada do corpo nem do token vai para log (G17).
 */
const BASE_URL = 'https://api.mercadopago.com'

export class MpError extends Error {
  constructor(status, detail = '') {
    super(`Mercado Pago respondeu ${status}${detail ? ` (${detail})` : ''}`)
    this.status = status
  }
}

/**
 * Só o texto do erro que o Mercado Pago devolve (message/error/cause), sem o corpo do pedido: é o que explica uma
 * recusa 400. E-mails e números longos (CPF, cartão) são mascarados por garantia (G17).
 */
export function mpErrorDetail(body) {
  if (!body || typeof body !== 'object') return ''
  const causes = Array.isArray(body.cause) ? body.cause : Array.isArray(body.errors) ? body.errors : []
  const parts = [body.message, body.error, ...causes.map((c) => c && (c.description || c.message || c.code))].filter(Boolean)
  return parts
    .join('; ')
    .replace(/[^\s@]+@[^\s@]+/g, '[e-mail]')
    .replace(/\d{6,}/g, '[número]')
    .slice(0, 300)
}

/** Centavos inteiros (G10) -> texto com duas casas, como a API Orders exige ("25.00", nunca "25"). */
export const toAmount = (cents) => (cents / 100).toFixed(2)

export const MP_TIMEOUT_MS = 10 * 1000

export function createMpClient({ accessToken, fetch = globalThis.fetch, timeoutMs = MP_TIMEOUT_MS }) {
  async function call(method, path, { body, idempotencyKey } = {}) {
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey
    let res
    try {
      res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      // Demora ou queda de rede: resultado incerto (pode ter cobrado), então vira erro 5xx, nunca "recusado".
      throw new MpError(err && err.name === 'TimeoutError' ? 504 : 502)
    }
    if (!res.ok) throw new MpError(res.status, mpErrorDetail(await res.json().catch(() => null)))
    return res.json()
  }

  return {
    createOrder: (body, idempotencyKey) => call('POST', '/v1/orders', { body, idempotencyKey }),
    getOrder: (id) => call('GET', `/v1/orders/${encodeURIComponent(id)}`),
    // Assinaturas: a referência da API não documenta X-Idempotency-Key em /preapproval.
    createPreapproval: (body) => call('POST', '/preapproval', { body }),
    getPreapproval: (id) => call('GET', `/preapproval/${encodeURIComponent(id)}`),
    cancelPreapproval: (id) => call('PUT', `/preapproval/${encodeURIComponent(id)}`, { body: { status: 'cancelled' } }),
    getAuthorizedPayment: (id) => call('GET', `/authorized_payments/${encodeURIComponent(id)}`),
  }
}
