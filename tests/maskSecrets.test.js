import { describe, it, expect } from 'vitest'
import { maskSecrets } from '@/services/netEnv'

describe('maskSecrets', () => {
  it.each([
    ['http://h.test/live/joao/segredo/12.m3u8', 'segredo'],
    ['http://h.test:8080/joao/segredo/12', 'segredo'],
    ['http://h.test/get.php?username=joao&password=segredo&type=m3u', 'segredo'],
    ['http://h.test/lista.m3u?token=segredo', 'segredo'],
    ['http://joao:segredo@h.test/lista.m3u', 'segredo'],
  ])('esconde a senha em %s', (url, secret) => {
    expect(maskSecrets(`Falhou ${url} agora`)).not.toContain(secret)
  })

  it('não mexe em endereço sem credenciais', () => {
    expect(maskSecrets('http://h.test/lista.m3u')).toBe('http://h.test/lista.m3u')
  })
})
