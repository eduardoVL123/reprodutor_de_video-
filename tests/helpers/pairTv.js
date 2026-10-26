/** Lado da TV no pareamento (RFC-016), só para testes: gera a chave e abre o `box` que o celular cifrou. */

export const b64u = {
  encode: (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
}

export async function newTv() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
  const pub = b64u.encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
  async function open(box, code) {
    const bytes = b64u.decode(box)
    const ephemeral = await crypto.subtle.importKey('raw', bytes.slice(0, 65), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: ephemeral }, pair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(65, 77), additionalData: new TextEncoder().encode(code) },
      aes,
      bytes.slice(77),
    )
    return JSON.parse(new TextDecoder().decode(plain))
  }
  return { pub, open }
}
