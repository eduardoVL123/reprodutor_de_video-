import { describe, it, expect, vi, afterEach } from 'vitest'
import http from 'node:http'

/**
 * Contrato do pareamento (RFC-016) de ponta a ponta, sem simulações: o servidor de verdade, a página do
 * celular (`PairLib`) de verdade e o código da TV de verdade conversando por HTTP.
 */

const servers = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))))
})

async function startServer() {
  const { createPairHandler } = await import('../server/pair/pair-server.mjs')
  const server = http.createServer(createPairHandler())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const base = `http://127.0.0.1:${server.address().port}`
  vi.stubEnv('VITE_PAIR_BASE_URL', base)
  return base
}

/** O que a página do celular faz ao tocar em "Enviar para a TV". */
async function phoneSends(base, code, data) {
  await import('../server/pair/public/pair-lib.js')
  const { pub } = await (await fetch(`${base}/v1/sessions/${code}`)).json()
  const box = await globalThis.PairLib.seal(pub, code, data)
  const res = await fetch(`${base}/v1/sessions/${code}/payload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ box }),
  })
  return res.status
}

const LISTA = { dns: 'http://srv.com/get.php?username=ana&password=123&type=m3u_plus', username: '', password: '', label: 'Casa' }

describe('pareamento de ponta a ponta', () => {
  it('a TV cria a sessão, o celular envia cifrado e a TV recebe e abre a lista', async () => {
    const base = await startServer()
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const { createSession, pollSession } = await import('@/services/pairingApi')
    const keys = await createPairingKeys()
    const session = await createSession(keys.publicKey)

    expect(await pollSession(session.code, session.secret)).toEqual({ status: 'pending' })
    expect(await phoneSends(base, session.code, LISTA)).toBe(204)
    const result = await pollSession(session.code, session.secret)

    expect(result.status).toBe('ready')
    expect(result.box).not.toContain('srv.com')
    expect(await keys.open(result.box, session.code)).toEqual(LISTA)
    await expect(pollSession(session.code, session.secret)).rejects.toMatchObject({ code: 'EXPIRED' })
  })

  it('o usePairing real recebe a lista enviada pelo celular e mostra o servidor para confirmar', async () => {
    const base = await startServer()
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { usePairing } = await import('@/composables/usePairing')
    const pairing = usePairing()

    await pairing.start()
    expect(pairing.pageUrl.value).toBe(`${base}/${pairing.code.value}`)
    expect(await phoneSends(base, pairing.code.value, LISTA)).toBe(204)
    await vi.waitFor(() => expect(pairing.state.value).toBe('received'), { timeout: 5000, interval: 100 })
    pairing.stop()

    expect(pairing.received.value).toEqual({ host: 'srv.com', label: 'Casa', insecure: true })
  })

  it('uma lista cifrada para outra TV não abre nesta', async () => {
    const base = await startServer()
    const { createPairingKeys } = await import('@/services/pairingCrypto')
    const { createSession, pollSession } = await import('@/services/pairingApi')
    const tv = await createPairingKeys()
    const other = await createPairingKeys()
    const mine = await createSession(tv.publicKey)
    const theirs = await createSession(other.publicKey)
    await phoneSends(base, theirs.code, LISTA)
    const stolen = await pollSession(theirs.code, theirs.secret)

    await expect(tv.open(stolen.box, mine.code)).rejects.toThrow('BAD_DATA')
  })
})
