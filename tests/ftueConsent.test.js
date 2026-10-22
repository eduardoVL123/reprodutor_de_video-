import { describe, it, expect } from 'vitest'

describe('FTUE — versão do aceite', () => {
  it('pede um novo aceite quando o texto legal mudou desde a versão aceita', async () => {
    const { storage, STORAGE_KEYS, hasAcceptedFtue } = await import('@/services/storage')
    await storage.set(STORAGE_KEYS.FTUE_ACCEPTED, { accepted: true, acceptedAt: '2026-01-01T00:00:00.000Z', version: 1 })

    expect(await hasAcceptedFtue()).toBe(false)
  })

  it('aceita o consentimento gravado na versão atual', async () => {
    const { acceptFtue, hasAcceptedFtue } = await import('@/services/storage')

    await acceptFtue()

    expect(await hasAcceptedFtue()).toBe(true)
  })

  it('não considera aceito sem registro', async () => {
    const { hasAcceptedFtue } = await import('@/services/storage')

    expect(await hasAcceptedFtue()).toBe(false)
  })
})
