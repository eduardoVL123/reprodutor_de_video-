import { describe, it, expect } from 'vitest'

describe('crypto — cifra de segredos', () => {
  it('cifra e decifra uma senha', async () => {
    const { encryptSecret, decryptSecret } = await import('@/services/crypto')

    expect(await decryptSecret(await encryptSecret('senha-secreta'))).toBe('senha-secreta')
  })

  it('cifrações simultâneas na primeira execução usam a mesma chave (todas decifram)', async () => {
    const { encryptSecret, decryptSecret } = await import('@/services/crypto')

    const blobs = await Promise.all(['a', 'b', 'c', 'd'].map((s) => encryptSecret(s)))

    expect(await Promise.all(blobs.map((b) => decryptSecret(b)))).toEqual(['a', 'b', 'c', 'd'])
  })
})
