/**
 * Biblioteca da página do celular (RFC-016). Script clássico: no navegador cria `PairLib` global.
 * Contrato do `box` (a TV abre do outro lado): base64url( chave pública efêmera do celular [65 bytes]
 * | iv [12] | AES-GCM(JSON) ), chave AES-256 = ECDH P-256(efêmera, chave da TV), com o código da
 * sessão como dado autenticado adicional.
 */
;(function (root) {
  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sem 0/O/1/I/L, igual ao servidor
  var CODE_LENGTH = 6
  var MAX_PLAINTEXT_CHARS = 2000
  var ECDH = { name: 'ECDH', namedCurve: 'P-256' }

  /** Primeiro link http(s) do texto colado; sem link, um endereço solto (ex.: servidor.com:8080); senão vazio. */
  function extractUrl(text) {
    var raw = String(text == null ? '' : text).trim()
    if (!raw) return ''
    var found = raw.match(/https?:\/\/[^\s<>"']+/i)
    if (found) return found[0].replace(/[.,;:!?)\]}]+$/, '')
    // shortcut: aceita qualquer palavra com "." ou ":"; quem valida de verdade é a TV (resolveShortInput)
    return !/\s/.test(raw) && /[.:]/.test(raw) ? raw : ''
  }

  function normalizeCode(text) {
    var letters = String(text == null ? '' : text).toUpperCase()
    var out = ''
    for (var i = 0; i < letters.length && out.length < CODE_LENGTH; i++) {
      if (CODE_ALPHABET.indexOf(letters.charAt(i)) !== -1) out += letters.charAt(i)
    }
    return out
  }

  function toBase64Url(bytes) {
    var binary = ''
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  function fromBase64Url(text) {
    var base64 = String(text).replace(/-/g, '+').replace(/_/g, '/')
    var binary = atob(base64 + '==='.slice((base64.length + 3) % 4))
    var bytes = new Uint8Array(binary.length)
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  /** Cifra `data` (objeto) para a chave pública da TV; devolve o `box` em base64url. Rejeita com 'too_long' se passar do limite. */
  async function seal(tvPublicKey, code, data) {
    var encoder = new TextEncoder()
    var plain = encoder.encode(JSON.stringify(data))
    if (plain.length > MAX_PLAINTEXT_CHARS) throw new Error('too_long')

    var subtle = root.crypto.subtle
    var tvKey = await subtle.importKey('raw', fromBase64Url(tvPublicKey), ECDH, false, [])
    var ephemeral = await subtle.generateKey(ECDH, false, ['deriveKey'])
    var aes = await subtle.deriveKey({ name: 'ECDH', public: tvKey }, ephemeral.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
    var iv = root.crypto.getRandomValues(new Uint8Array(12))
    var sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: encoder.encode(code) }, aes, plain))
    var ephemeralPublic = new Uint8Array(await subtle.exportKey('raw', ephemeral.publicKey))

    var box = new Uint8Array(ephemeralPublic.length + iv.length + sealed.length)
    box.set(ephemeralPublic, 0)
    box.set(iv, ephemeralPublic.length)
    box.set(sealed, ephemeralPublic.length + iv.length)
    return toBase64Url(box)
  }

  root.PairLib = { extractUrl: extractUrl, normalizeCode: normalizeCode, seal: seal, MAX_PLAINTEXT_CHARS: MAX_PLAINTEXT_CHARS, CODE_LENGTH: CODE_LENGTH }
})(typeof globalThis !== 'undefined' ? globalThis : self)
