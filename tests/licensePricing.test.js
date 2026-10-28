import { describe, it, expect } from 'vitest'
import {
  MIN_CREDITS,
  DEVICE_ANNUAL_PRICE,
  creditUnitPrice,
  creditTotal,
  partnerMonthlyPrice,
} from '../server/license/pricing.mjs'

/** Tabelas de preço da RFC-019 (R1, R5, R6). Valores em centavos. */

describe('créditos do revendedor (R1)', () => {
  it.each([
    [10, 1000],
    [19, 1000],
    [20, 900],
    [50, 900],
    [51, 800],
    [99, 800],
    [100, 700],
    [499, 700],
    [500, 600],
    [999, 600],
    [1000, 500],
    [5000, 500],
  ])('%i créditos custam %i centavos cada', (qty, unit) => {
    expect(creditUnitPrice(qty)).toBe(unit)
  })

  it('exemplo do dono: 20 créditos = R$ 180', () => {
    expect(creditTotal(20)).toBe(18000)
  })

  it('o mínimo é 10: abaixo disso, ou quantidade inválida, não há preço', () => {
    expect(MIN_CREDITS).toBe(10)
    for (const qty of [9, 0, -5, 10.5, NaN, '20']) expect(creditTotal(qty)).toBeNull()
  })
})

describe('assinatura do aparelho (R6)', () => {
  it('custa R$ 25', () => {
    expect(DEVICE_ANNUAL_PRICE).toBe(2500)
  })
})

describe('mensalidade do parceiro (R5)', () => {
  it.each([
    [0, 0],
    [1, 35000],
    [250, 35000],
    [251, 60000],
    [500, 60000],
    [501, 85000],
    [1000, 85000],
    [1001, 150000],
    [2000, 150000],
    [2001, 300000],
    [5000, 300000],
    [5001, 460000],
    [10000, 460000],
  ])('%i ativos: %i centavos', (actives, price) => {
    expect(partnerMonthlyPrice(actives)).toBe(price)
  })

  it('acima de 10000 ativos é sob consulta', () => {
    expect(partnerMonthlyPrice(10001)).toBeNull()
  })
})
