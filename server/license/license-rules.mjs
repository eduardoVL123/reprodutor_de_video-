/**
 * Regras de licença do Pulse Player (RFC-018): teste, ativação anual, ciclos do parceiro e ativo do ciclo.
 * Funções puras, sem rede nem banco. Usadas pelo servidor (server/license) e pelo app (normalizeHost).
 * Nada roda no import: o app carrega este módulo também no Chromium 63 das TVs.
 */

export const DAY_MS = 24 * 3600 * 1000
export const TRIAL_MS = 7 * DAY_MS
export const ACTIVE_GAP_MS = DAY_MS
export const TIME_ZONE = 'America/Sao_Paulo'

let dateFormat = null

/** Data 'YYYY-MM-DD' do instante no horário de Brasília. */
export function localDate(at) {
  if (!dateFormat) {
    dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
  }
  return dateFormat.format(new Date(at))
}

const pad = (n) => String(n).padStart(2, '0')
const toIso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const parseIso = (iso) => iso.split('-').map(Number)
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

function nextDay(iso) {
  const [y, m, d] = parseIso(iso)
  const t = new Date(Date.UTC(y, m - 1, d + 1))
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** Mesmo dia do mês seguinte; dia inexistente (31/02) vira o último dia do mês. */
function sameDayNextMonth(iso) {
  const [y, m, d] = parseIso(iso)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  return toIso(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

/**
 * Ciclos da parceria (D3): o ciclo vai do dia de início até o mesmo dia do mês seguinte, inclusive;
 * o próximo começa no dia seguinte. Devolve todos os ciclos até o que contém `at`.
 */
export function cyclesUntil(startedOn, at) {
  const today = localDate(at)
  const cycles = []
  if (today < startedOn) return cycles
  let start = startedOn
  for (let index = 0; ; index++) {
    const end = sameDayNextMonth(start)
    cycles.push({ index, start, end })
    if (today <= end) return cycles
    start = nextDay(end)
  }
}

/** Ciclo que contém `at`, ou null antes da parceria. */
export function cycleFor(startedOn, at) {
  const cycles = cyclesUntil(startedOn, at)
  return cycles.length ? cycles[cycles.length - 1] : null
}

/** Domínio da lista em minúsculas, sem esquema, porta, caminho nem credenciais ('' se inválido). */
export function normalizeHost(urlOrHost) {
  const text = String(urlOrHost || '').trim()
  if (!text) return ''
  try {
    const host = new URL(text.includes('://') ? text : `http://${text}`).hostname.toLowerCase()
    return host.includes('.') ? host : ''
  } catch (_) {
    return ''
  }
}

/** Acesso do aparelho (R3): ativação vale sobre tudo; no teste ninguém paga; depois, parceiro ou bloqueio. */
export function accessFor({ trialEndsAt, activationEndsAt, isPartner, now }) {
  if (activationEndsAt && activationEndsAt > now) return 'activated'
  if (now < trialEndsAt) return 'trial'
  return isPartner ? 'partner' : 'blocked'
}

/** Ativo do ciclo (R5): duas entradas com 24 h ou mais de diferença. */
export function isActive({ firstAt, lastAt }) {
  return lastAt - firstAt >= ACTIVE_GAP_MS
}

/** Nova data de fim da ativação: 1 ano somado ao fim atual, ou a agora se já venceu. */
export function extendActivation(currentEndsAt, now) {
  const from = new Date(Math.max(now, currentEndsAt || 0))
  from.setUTCFullYear(from.getUTCFullYear() + 1)
  return from.getTime()
}
