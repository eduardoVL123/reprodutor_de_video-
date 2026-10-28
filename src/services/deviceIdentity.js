import { Device } from '@capacitor/device'
import { isNativeApp } from '@/services/netEnv'
import { isWebOS } from '@/services/platform'
import { storage } from '@/services/storage'

/**
 * Identidade do aparelho para a licença (RFC-018 §1). O ID da plataforma vira hash antes de sair do aparelho.
 * - APK: ANDROID_ID. Samsung: DUID (webapis.js, injetado pelo scripts/package-tv.mjs). LG: LGUDID (webOS 3.0+).
 *   Os três sobrevivem a reinstalar o app. A LG exige o consentimento do usuário: só é chamado depois do aviso inicial.
 * - Sem ID da plataforma (navegador, TV antiga, sistema sem resposta): código aleatório guardado no app.
 */

const FALLBACK_KEY = 'license:deviceKey'
const WEBOS_TIMEOUT_MS = 3000
let cached = null

export function devicePlatform() {
  if (isNativeApp()) return 'android'
  if (window.tizen) return 'tizen'
  if (isWebOS()) return 'webos'
  return 'web'
}

/** LGUDID pela ponte nativa do webOS (a mesma que o webOSTV.js usa); '' se o sistema não responder. */
function webosUdid() {
  if (typeof window.PalmServiceBridge !== 'function') return Promise.resolve('')
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(''), WEBOS_TIMEOUT_MS)
    const bridge = new window.PalmServiceBridge()
    bridge.onservicecallback = (message) => {
      clearTimeout(timer)
      try {
        const list = JSON.parse(message).idList || []
        const entry = list.find((item) => item && item.idType === 'LGUDID')
        resolve((entry && entry.idValue) || '')
      } catch (_) {
        resolve('')
      }
    }
    bridge.call('luna://com.webos.service.sm/deviceid/getIDs', JSON.stringify({ idType: ['LGUDID'] }))
  })
}

async function platformId() {
  try {
    if (devicePlatform() === 'android') return (await Device.getId()).identifier || ''
    if (devicePlatform() === 'webos') return await webosUdid()
    if (window.webapis && window.webapis.productinfo && window.webapis.productinfo.getDuid) {
      return window.webapis.productinfo.getDuid() || ''
    }
  } catch (err) {
    console.warn('[licença] ID da plataforma indisponível:', err && err.message)
  }
  return ''
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function fallbackKey() {
  const saved = await storage.get(FALLBACK_KEY)
  if (typeof saved === 'string' && saved) return saved
  const key = randomKey()
  await storage.set(FALLBACK_KEY, key)
  return key
}

/** Chave estável do aparelho (64 caracteres hex). */
export async function getDeviceKey() {
  if (cached) return cached
  const id = await platformId()
  cached = id && crypto.subtle ? await sha256Hex(`pulse-license:${id}`) : await fallbackKey()
  return cached
}
