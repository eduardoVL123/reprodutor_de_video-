import { registerPlugin } from '@capacitor/core'
import { isNativeApp } from '@/services/netEnv'
import { cancellable } from '@/services/platform'

/**
 * Transmitir para o Chromecast (Google Cast) no APK de celular/tablet.
 * Plugin nativo do app: android/.../CastPlugin.java, com o receptor padrão do Google.
 * Em TVs, Samsung/LG e navegador nunca está disponível.
 *
 * SEGURANÇA: a URL enviada contém usuário e senha da lista; nunca registrar sem maskSecrets().
 */
const Cast = registerPlugin('Cast')

const CONTENT_TYPES = {
  m3u8: 'application/x-mpegurl',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  ts: 'video/mp2t',
}

/**
 * O que mandar para o Chromecast a partir do stream montado por buildStreamUrl.
 * @returns {{ url: string, contentType: string, title: string, live: boolean }|null}
 */
export function castMediaFor(stream, item, section) {
  if (!stream || !stream.primaryUrl) return null
  const ext = stream.isHls ? 'm3u8' : String(stream.containerExtension || '').toLowerCase()
  return {
    url: stream.primaryUrl,
    contentType: CONTENT_TYPES[ext] || 'video/mp4',
    title: (item && item.name) || '',
    live: section === 'live',
  }
}

/** Há Google Cast neste aparelho (APK fora de TV, com Google Play Services)? Nunca rejeita. */
export async function isCastAvailable() {
  if (!isNativeApp()) return false
  try {
    const result = await Cast.isAvailable()
    return !!(result && result.available)
  } catch (err) {
    console.warn('[cast] Indisponível:', err && err.message)
    return false
  }
}

/** Abre o seletor de aparelhos do Android. Resolve com o nome da TV escolhida; rejeita se cancelado. */
export async function requestCastSession() {
  const result = await Cast.requestSession()
  return (result && result.deviceName) || ''
}

/** Toca a mídia na TV conectada. Rejeita se o Chromecast não conseguir abrir. */
export function loadOnCast(media) {
  return Cast.load(media)
}

export const playOnCast = () => Cast.play().catch(() => {})
export const pauseOnCast = () => Cast.pause().catch(() => {})
/** Para o vídeo na TV e encerra a transmissão. */
export const stopCasting = () => Cast.stop().catch(() => {})

/**
 * Estado da mídia na TV: `{ state: 'playing'|'paused'|'buffering'|'idle'|'error'|'ended' }`.
 * `ended` = a transmissão terminou (pelo seletor, pela TV ou pela notificação).
 * @returns {() => void} cancela o aviso
 */
export function onCastMediaStatus(callback) {
  if (!isNativeApp()) return () => {}
  return cancellable(Cast.addListener('castMediaStatus', (data) => callback(data || {})))
}
