/**
 * Detecção do ambiente de rede (módulo puro, sem estado reativo).
 *
 *  - APK Capacitor (Android TV): o `MainActivity` intercepta as chamadas a player_api.php, get.php,
 *    .m3u e .m3u8 e as refaz pelo HttpURLConnection nativo (sem CORS); o plugin CapacitorHttp fica
 *    desligado. NÃO usar o proxy local.
 *  - Navegador no PC (vite dev/preview em localhost): usar `/__proxy__` quando o
 *    servidor IPTV não enviar cabeçalhos CORS.
 *  - Tizen/webOS empacotados (file://): o WebView já não aplica CORS do mesmo jeito.
 */

export const DEV_PROXY_PATH = '/__proxy__'

/** true quando rodando dentro do APK nativo do Capacitor. */
export function isNativeApp() {
  try {
    const cap = typeof window !== 'undefined' ? window.Capacitor : null
    if (!cap) return false
    if (typeof cap.isNativePlatform === 'function') return !!cap.isNativePlatform()
    return cap.platform === 'android' || cap.platform === 'ios'
  } catch (_) {
    return false
  }
}

/** true quando o proxy local do Vite está disponível (PC em localhost). */
export function canUseDevProxy() {
  if (typeof location === 'undefined' || isNativeApp()) return false
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return false
  const host = location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

/** Monta a URL do proxy local para um destino absoluto. */
export function devProxyUrl(targetUrl, { hls = false } = {}) {
  return `${DEV_PROXY_PATH}?${hls ? 'hls=1&' : ''}url=${encodeURIComponent(targetUrl)}`
}

/** Mascara a senha em URLs/textos antes de exibir ou registrar. */
export function maskSecrets(text) {
  return String(text == null ? '' : text)
    .replace(/((?:password|pass|pwd|token)=)[^&\s]*/gi, '$1***')
    .replace(/\/\/[^/\s:@]+:[^/\s@]*@/g, '//***:***@')
    .replace(/\/(live|movie|series)\/([^/]+)\/([^/]+)\//gi, '/$1/$2/***/')
    .replace(/(https?:\/\/[^/\s]+)\/[^/\s?]+\/[^/\s?]+\/(\d+)(?=[.?\s]|$)/gi, '$1/***/***/$2')
}
