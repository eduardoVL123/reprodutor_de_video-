/**
 * Chamadas da TV ao servidor de pareamento (RFC-016, protocolo em server/pair/pair-server.mjs).
 * O endereço vem de `VITE_PAIR_BASE_URL`; vazio = o recurso fica desligado e o login manual continua igual.
 */

import { isCryptoSupported } from '@/services/crypto'

export const PAIRING_ERRORS = { UNAVAILABLE: 'UNAVAILABLE', EXPIRED: 'EXPIRED', BUSY: 'BUSY' }

const MESSAGES = {
  UNAVAILABLE: 'Não consegui falar com o serviço de pareamento. Você ainda pode digitar o endereço pelo controle.',
  EXPIRED: 'O código expirou. Gere um novo código.',
  BUSY: 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.',
}

const REQUEST_TIMEOUT_MS = 15000

export class PairingError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES.UNAVAILABLE)
    this.name = 'PairingError'
    this.code = MESSAGES[code] ? code : PAIRING_ERRORS.UNAVAILABLE
    this.userMessage = this.message
  }
}

function baseUrl() {
  return String(import.meta.env.VITE_PAIR_BASE_URL || '').trim().replace(/\/+$/, '')
}

export function isPairingConfigured() {
  return baseUrl() !== ''
}

/** O login só oferece "pelo celular" com o serviço configurado e a cifra disponível no aparelho. */
export function isPairingAvailable() {
  return isPairingConfigured() && isCryptoSupported()
}

/** Endereço completo da página do celular (vai dentro do QR code). */
export function pairPageUrl(code) {
  return `${baseUrl()}/${code}`
}

/** Mesmo endereço sem o protocolo, curto o bastante para ler na TV. */
export function pairDisplayUrl(code) {
  return pairPageUrl(code).replace(/^https?:\/\//i, '')
}

/** fetch com tempo limite por Promise.race (TVs com Chromium < 66 não têm AbortController). */
async function request(path, init) {
  const base = baseUrl()
  if (!base) throw new PairingError(PAIRING_ERRORS.UNAVAILABLE)
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new PairingError(PAIRING_ERRORS.UNAVAILABLE)), REQUEST_TIMEOUT_MS)
  })
  try {
    return await Promise.race([fetch(base + path, { credentials: 'omit', cache: 'no-store', ...init }), timeout])
  } catch (err) {
    throw err instanceof PairingError ? err : new PairingError(PAIRING_ERRORS.UNAVAILABLE)
  } finally {
    clearTimeout(timer)
  }
}

async function readJson(res) {
  try {
    return await res.json()
  } catch (_) {
    throw new PairingError(PAIRING_ERRORS.UNAVAILABLE)
  }
}

/** @returns {Promise<{ code: string, secret: string, expiresIn: number }>} */
export async function createSession(publicKey) {
  const res = await request('/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pub: publicKey }),
  })
  if (res.status === 429) throw new PairingError(PAIRING_ERRORS.BUSY)
  if (res.status !== 201) throw new PairingError(PAIRING_ERRORS.UNAVAILABLE)
  const data = await readJson(res)
  if (!data || typeof data.code !== 'string' || typeof data.secret !== 'string' || typeof data.expiresIn !== 'number') {
    throw new PairingError(PAIRING_ERRORS.UNAVAILABLE)
  }
  return { code: data.code, secret: data.secret, expiresIn: data.expiresIn }
}

/** @returns {Promise<{ status: 'pending' } | { status: 'ready', box: string }>} */
export async function pollSession(code, secret) {
  const res = await request(`/v1/sessions/${code}/payload`, { method: 'GET', headers: { 'X-Pair-Secret': secret } })
  if (res.status === 204) return { status: 'pending' }
  if (res.status === 404) throw new PairingError(PAIRING_ERRORS.EXPIRED)
  if (res.status === 429) throw new PairingError(PAIRING_ERRORS.BUSY)
  if (res.status !== 200) throw new PairingError(PAIRING_ERRORS.UNAVAILABLE)
  const data = await readJson(res)
  if (!data || typeof data.box !== 'string') throw new PairingError(PAIRING_ERRORS.UNAVAILABLE)
  return { status: 'ready', box: data.box }
}
