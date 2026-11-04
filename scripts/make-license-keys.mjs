/**
 * Gera o par de chaves que assina as respostas da licença (server/license/license-sign.mjs).
 * Rode no SEU terminal e não cole a chave privada em lugar nenhum além do comando do wrangler:
 *
 *   node scripts/make-license-keys.mjs
 *
 * - Chave privada → segredo do Worker: `npx wrangler secret put LICENSE_SIGNING_KEY --config server/license/wrangler.jsonc`
 * - Chave pública → build do app: variável VITE_LICENSE_PUBLIC_KEY (no GitHub: variável PULSE_LICENSE_PUBLIC_KEY).
 *
 * Trocar o par invalida o estado salvo nas TVs: elas voltam a consultar o servidor na próxima abertura.
 */
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)

console.log('Chave PRIVADA (LICENSE_SIGNING_KEY, segredo do servidor):')
console.log(JSON.stringify({ kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y, d: privateJwk.d }))
console.log('')
console.log('Chave PÚBLICA (VITE_LICENSE_PUBLIC_KEY, vai no app):')
console.log(`${publicJwk.x}.${publicJwk.y}`)
