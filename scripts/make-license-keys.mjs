/**
 * Gera o par de chaves que assina as respostas da licença (server/license/license-sign.mjs).
 * Rode no SEU terminal e não cole a chave privada em lugar nenhum além do comando do wrangler:
 *
 *   node scripts/make-license-keys.mjs
 *
 * - Chave privada → segredo do Worker: `npx wrangler secret put LICENSE_SIGNING_KEY --config server/license/wrangler.jsonc`
 * - Chave pública → build do app: variável VITE_LICENSE_PUBLIC_KEY (no GitHub: variável PULSE_LICENSE_PUBLIC_KEY).
 *
 * Com --rsa: o par RSA da Roku (server/license/license-roku.mjs), que o roRSA confere.
 * - Chave privada → `npx wrangler secret put LICENSE_RSA_KEY --config server/license/wrangler.jsonc`
 * - Chave pública (PEM) → build da Roku: variável PULSE_LICENSE_RSA_PUBLIC_KEY (o texto do PEM; vira pkg:/license-rsa.pem).
 *
 * Trocar o par invalida o estado salvo nas TVs: elas voltam a consultar o servidor na próxima abertura.
 */
import { pathToFileURL } from 'node:url'

export async function rsaPair() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const base64 = btoa(String.fromCharCode(...spki))
  const pem = `-----BEGIN PUBLIC KEY-----\n${base64.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`
  return { privateJwk: JSON.stringify(privateJwk), publicPem: pem }
}

async function main() {
  if (process.argv.includes('--rsa')) {
    const { privateJwk, publicPem } = await rsaPair()
    console.log('Chave PRIVADA RSA (LICENSE_RSA_KEY, segredo do servidor):')
    console.log(privateJwk)
    console.log('')
    console.log('Chave PÚBLICA RSA (PULSE_LICENSE_RSA_PUBLIC_KEY, vai no pacote da Roku):')
    console.log(publicPem)
    return
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)

  console.log('Chave PRIVADA (LICENSE_SIGNING_KEY, segredo do servidor):')
  console.log(JSON.stringify({ kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y, d: privateJwk.d }))
  console.log('')
  console.log('Chave PÚBLICA (VITE_LICENSE_PUBLIC_KEY, vai no app):')
  console.log(`${publicJwk.x}.${publicJwk.y}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
