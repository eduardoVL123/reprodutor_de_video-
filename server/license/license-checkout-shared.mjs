/** Peças comuns do pagamento (RFC-020): usadas por license-checkout.mjs e pelas duas metades dele. */
export const ALREADY_RENEWING = 'Este aparelho já tem renovação automática no cartão. Para trocar o cartão, fale com o suporte pelo WhatsApp.'
// Status de estorno do Mercado Pago (pedido, pagamento ou parcela). shortcut: confirmar os nomes na etapa 7 (teste).
export const REVERSED = ['refunded', 'charged_back']
export const DELIVERED_BY = 'mercadopago'

export class CheckoutError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
