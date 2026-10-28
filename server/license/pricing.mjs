/**
 * Tabelas de preço do dono (RFC-019 R1, R5, R6). Tudo em centavos inteiros (G10): nunca float, nunca vindo do cliente.
 */

export const MIN_CREDITS = 10
export const DEVICE_ANNUAL_PRICE = 2500

/** [quantidade mínima, preço por crédito], da faixa mais alta para a mais baixa. */
export const CREDIT_TIERS = [
  [1000, 500],
  [500, 600],
  [100, 700],
  [51, 800],
  [20, 900],
  [10, 1000],
]

/** [ativos até, valor do mês]; acima da última faixa é sob consulta. */
export const PARTNER_TIERS = [
  [250, 35000],
  [500, 60000],
  [1000, 85000],
  [2000, 150000],
  [5000, 300000],
  [10000, 460000],
]

const validQuantity = (qty) => Number.isInteger(qty) && qty >= MIN_CREDITS

export function creditUnitPrice(qty) {
  if (!validQuantity(qty)) return null
  return CREDIT_TIERS.find(([min]) => qty >= min)[1]
}

export function creditTotal(qty) {
  const unit = creditUnitPrice(qty)
  return unit === null ? null : unit * qty
}

/** Valor do mês do parceiro; 0 sem ativos; null = sob consulta. */
export function partnerMonthlyPrice(actives) {
  if (actives <= 0) return 0
  const tier = PARTNER_TIERS.find(([max]) => actives <= max)
  return tier ? tier[1] : null
}
