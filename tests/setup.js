import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { webcrypto } from 'node:crypto'
import { beforeEach, vi } from 'vitest'

// jsdom não traz WebCrypto completo; o do Node tem AES-GCM e clona CryptoKey no IndexedDB falso.
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

// jsdom não implementa reprodução de mídia.
window.HTMLMediaElement.prototype.load = vi.fn()
window.HTMLMediaElement.prototype.pause = vi.fn()
window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())

// Isolamento: IndexedDB novo e módulos recarregados a cada teste.
// Os testes importam o código sob teste dinamicamente (`await import(...)`) depois disso.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  vi.resetModules()
})
