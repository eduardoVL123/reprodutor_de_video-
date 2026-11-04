#!/usr/bin/env node
/**
 * Envia a lista de um cliente direto para a TV dele, pelo código do aparelho (8 letras que aparecem no app).
 * Faz o mesmo que a página pulseplayer.com.br/enviar: cifra endereço, usuário e senha AQUI, com a chave pública da
 * TV, e manda só o texto cifrado. O servidor do Pulse Player nunca vê a senha. A TV pergunta "Adicionar esta lista?".
 *
 * Arquivo único, sem dependências: Node 18 ou mais novo. Copie para o seu sistema e use assim:
 *
 *   node enviar-lista.mjs --codigo ABCD2345 --url http://servidor.com:8080 --usuario joao --senha 1234 --nome "Sala"
 *   node enviar-lista.mjs --codigo ABCD2345 --url "http://servidor.com/get.php?username=joao&password=1234&type=m3u"
 *
 * Ou dentro do seu código:  import { enviarLista } from './enviar-lista.mjs'
 *                           await enviarLista({ codigo, url, usuario, senha, nome })
 *
 * Formato do envio (igual ao do site): base64url( chave pública efêmera [65 bytes] | iv [12] | AES-GCM(JSON) ),
 * chave AES-256 = ECDH P-256(efêmera, chave da TV), com o código da TV como dado autenticado adicional.
 */

import { pathToFileURL } from 'node:url'

export const BASE_URL = 'https://pulseplayer.com.br'
const MAX_PLAINTEXT_BYTES = 2000
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/

const toBase64Url = (bytes) => Buffer.from(bytes).toString('base64url')
const fromBase64Url = (text) => new Uint8Array(Buffer.from(String(text), 'base64url'))

/** Cifra a lista para a chave pública da TV (mesmo formato do site e do pareamento). */
export async function selar(chavePublicaTv, codigo, dados) {
  const encoder = new TextEncoder()
  const plain = encoder.encode(JSON.stringify(dados))
  if (plain.length > MAX_PLAINTEXT_BYTES) throw new Error('Lista grande demais para enviar (máximo 2000 caracteres).')
  const { subtle } = globalThis.crypto
  const tvKey = await subtle.importKey('raw', fromBase64Url(chavePublicaTv), ECDH, false, [])
  const ephemeral = await subtle.generateKey(ECDH, false, ['deriveKey'])
  const aes = await subtle.deriveKey({ name: 'ECDH', public: tvKey }, ephemeral.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(codigo) }, aes, plain))
  const ephemeralPublic = new Uint8Array(await subtle.exportKey('raw', ephemeral.publicKey))
  const box = new Uint8Array(ephemeralPublic.length + iv.length + sealed.length)
  box.set(ephemeralPublic, 0)
  box.set(iv, ephemeralPublic.length)
  box.set(sealed, ephemeralPublic.length + iv.length)
  return toBase64Url(box)
}

async function lerErro(res) {
  try {
    return (await res.json()).error || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

/**
 * Envia a lista para a TV. `url`: link M3U ou endereço do servidor Xtream; `usuario`/`senha`: opcionais (Xtream).
 * Resolve com { enviado: true }; rejeita com a mensagem do servidor (ex.: código não encontrado, muitas tentativas).
 */
export async function enviarLista({ codigo, url, usuario = '', senha = '', nome = '', base = BASE_URL, fetchImpl = fetch }) {
  const code = String(codigo || '').trim().toUpperCase()
  if (!CODE.test(code)) throw new Error('Código inválido: são 8 letras e números do app (sem 0, 1, I, L e O).')
  if (!String(url || '').trim()) throw new Error('Informe o link da lista ou o endereço do servidor.')
  const keyRes = await fetchImpl(`${base}/v1/inbox/${code}/key`)
  if (!keyRes.ok) throw new Error(await lerErro(keyRes))
  const { pub } = await keyRes.json()
  const box = await selar(pub, code, { dns: String(url).trim(), username: String(usuario).trim(), password: String(senha), label: String(nome).trim() })
  const res = await fetchImpl(`${base}/v1/inbox/${code}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ box }) })
  if (!res.ok) throw new Error(await lerErro(res))
  return { enviado: true }
}

function argumentos(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : ''
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = argumentos(process.argv.slice(2))
  enviarLista({ codigo: a.codigo, url: a.url, usuario: a.usuario, senha: a.senha, nome: a.nome, base: a.base || BASE_URL })
    .then(() => console.log('Enviado! Na TV, confirme "Adicionar esta lista?".'))
    .catch((err) => {
      console.error(`Não enviado: ${err.message}`)
      process.exitCode = 1
    })
}
