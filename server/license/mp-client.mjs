/**
 * Cliente mínimo da API do Mercado Pago (RFC-020) com `fetch`, sem SDK (decisão do dono). O `fetch` é injetável para
 * os testes nunca chamarem o Mercado Pago de verdade. Nada do corpo nem do token vai para log (G17).
 */
const BASE_URL = 'https://api.mercadopago.com'

export class MpError extends Error {
  constructor(status) {
    super(`Mercado Pago respondeu ${status}`)
    this.status = status
  }
}

/** Centavos inteiros (G10) -> texto com duas casas, como a API Orders exige ("25.00", nunca "25"). */
export const toAmount = (cents) => (cents / 100).toFixed(2)

export function createMpClient({ accessToken, fetch = globalThis.fetch }) {
  async function call(method, path, { body, idempotencyKey } = {}) {
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey
    const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
    if (!res.ok) throw new MpError(res.status)
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
