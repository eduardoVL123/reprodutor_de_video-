import { describe, it, expect } from 'vitest'
import {
  TRIAL_MS,
  ACTIVE_GAP_MS,
  localDate,
  cycleFor,
  cyclesUntil,
  normalizeHost,
  accessFor,
  isActive,
  extendActivation,
} from '../server/license/license-rules.mjs'

/** Instante em horário de Brasília (UTC-3, sem horário de verão desde 2019). */
const brt = (y, m, d, h = 12, min = 0) => Date.UTC(y, m - 1, d, h + 3, min)
const DAY = 24 * 3600e3

describe('licença — ciclo do parceiro (RFC-018 R6, D3)', () => {
  it('parceria em 02/04: 05/04 está no ciclo 0, que vai de 02/04 a 02/05', () => {
    expect(cycleFor('2026-04-02', brt(2026, 4, 5))).toEqual({ index: 0, start: '2026-04-02', end: '2026-05-02' })
  })

  it('02/05 às 23:59 ainda é do ciclo 0', () => {
    expect(cycleFor('2026-04-02', brt(2026, 5, 2, 23, 59)).index).toBe(0)
  })

  it('03/05 à meia-noite já é o ciclo 1, de 03/05 a 03/06', () => {
    expect(cycleFor('2026-04-02', brt(2026, 5, 3, 0, 0))).toEqual({ index: 1, start: '2026-05-03', end: '2026-06-03' })
  })

  it('parceria no dia 31: o ciclo 0 termina no último dia de fevereiro e o 1 começa em 01/03', () => {
    expect(cycleFor('2026-01-31', brt(2026, 2, 10)).end).toBe('2026-02-28')
    expect(cycleFor('2026-01-31', brt(2026, 3, 1))).toEqual({ index: 1, start: '2026-03-01', end: '2026-04-01' })
  })

  it('usa o dia de Brasília: 01/02 02:00 UTC é 31/01 23:00 em Brasília', () => {
    const at = Date.UTC(2026, 1, 1, 2, 0)
    expect(localDate(at)).toBe('2026-01-31')
    expect(cycleFor('2026-01-01', at).index).toBe(0)
  })

  it('antes da data da parceria não há ciclo', () => {
    expect(cycleFor('2026-04-02', brt(2026, 4, 1))).toBeNull()
  })

  it('lista os ciclos da parceria até hoje, inclusive o em andamento', () => {
    expect(cyclesUntil('2026-04-02', brt(2026, 5, 10)).map((c) => c.start)).toEqual(['2026-04-02', '2026-05-03'])
  })
})

describe('licença — ativo do ciclo (R5)', () => {
  it('23h59 entre a primeira e a última entrada não é ativo', () => {
    expect(isActive({ firstAt: 0, lastAt: ACTIVE_GAP_MS - 60e3 })).toBe(false)
  })

  it('24 horas exatas entre a primeira e a última entrada é ativo', () => {
    expect(isActive({ firstAt: 0, lastAt: ACTIVE_GAP_MS })).toBe(true)
  })
})

describe('licença — acesso do aparelho (R2, R3)', () => {
  const now = brt(2026, 4, 10)
  const inTrial = { trialEndsAt: now + DAY, activationEndsAt: null, now }
  const afterTrial = { trialEndsAt: now - DAY, activationEndsAt: null, now }

  it('no teste, lista sem parceria libera como teste', () => {
    expect(accessFor({ ...inTrial, isPartner: false })).toBe('trial')
  })

  it('no teste, lista de parceiro também é teste (ninguém paga)', () => {
    expect(accessFor({ ...inTrial, isPartner: true })).toBe('trial')
  })

  it('depois do teste, lista de parceiro libera pelo parceiro', () => {
    expect(accessFor({ ...afterTrial, isPartner: true })).toBe('partner')
  })

  it('depois do teste, lista sem parceria bloqueia', () => {
    expect(accessFor({ ...afterTrial, isPartner: false })).toBe('blocked')
  })

  it('ativação válida libera qualquer lista, mesmo durante o teste', () => {
    expect(accessFor({ ...inTrial, activationEndsAt: now + DAY, isPartner: true })).toBe('activated')
    expect(accessFor({ ...afterTrial, activationEndsAt: now + DAY, isPartner: false })).toBe('activated')
  })

  it('ativação vencida volta à regra normal', () => {
    expect(accessFor({ ...afterTrial, activationEndsAt: now - 1, isPartner: false })).toBe('blocked')
  })

  it('o teste dura 7 dias', () => {
    expect(TRIAL_MS).toBe(7 * DAY)
  })
})

describe('licença — domínio da lista', () => {
  it('ignora esquema, maiúsculas, porta, caminho e consulta', () => {
    expect(normalizeHost('HTTP://AppScdd.Top:8080/get.php?x=1')).toBe('appscdd.top')
  })

  it('aceita só o host, sem esquema', () => {
    expect(normalizeHost('appscdd.top:80')).toBe('appscdd.top')
  })

  it('www é outro domínio (o parceiro cadastra os dois se usar os dois)', () => {
    expect(normalizeHost('http://www.a.com')).toBe('www.a.com')
  })

  it('não deixa passar usuário e senha embutidos na URL', () => {
    expect(normalizeHost('http://user:pass@a.com/x')).toBe('a.com')
  })

  it('texto inválido vira vazio', () => {
    expect(normalizeHost('')).toBe('')
    expect(normalizeHost('lixo')).toBe('')
    expect(normalizeHost(null)).toBe('')
  })
})

describe('licença — ativação anual (R7)', () => {
  const now = brt(2026, 4, 10)

  it('sem ativação: vale 1 ano a partir de agora', () => {
    expect(extendActivation(null, now)).toBe(brt(2027, 4, 10))
  })

  it('com ativação ainda válida: soma 1 ano ao fim da atual', () => {
    expect(extendActivation(brt(2026, 5, 10), now)).toBe(brt(2027, 5, 10))
  })

  it('com ativação vencida: conta a partir de agora', () => {
    expect(extendActivation(brt(2026, 1, 1), now)).toBe(brt(2027, 4, 10))
  })
})
