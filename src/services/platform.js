import { registerPlugin } from '@capacitor/core'
import { isNativeApp } from '@/services/netEnv'

/**
 * Integração com a plataforma hospedeira (Samsung Tizen, LG webOS, APK Capacitor, navegador).
 * Módulo sem estado: cada função detecta a plataforma no momento da chamada.
 */

/** Plugin nativo do APK (android/.../PictureInPicturePlugin.java). */
const PictureInPicture = registerPlugin('PictureInPicture')

const isWebOS = () => !!window.PalmSystem || /Web0S|webOS/.test(navigator.userAgent || '')

/**
 * Encerra o aplicativo. Samsung e LG exigem que a tecla Voltar na tela inicial saia do app,
 * e no Android TV o WebView não fecha a Activity sozinho. No navegador do PC não faz nada:
 * Esc/Voltar não pode fechar a aba ou a janela do usuário.
 * Nunca rejeita.
 */
export async function exitApp() {
  try {
    if (window.tizen && window.tizen.application) {
      window.tizen.application.getCurrentApplication().exit()
      return
    }
    if (window.webOS && typeof window.webOS.platformBack === 'function') {
      window.webOS.platformBack()
      return
    }
    if (isWebOS()) {
      window.close()
      return
    }
    if (isNativeApp()) {
      const { App } = await import('@capacitor/app')
      await App.exitApp()
    }
  } catch (err) {
    console.warn('[platform] Não foi possível encerrar o aplicativo:', err && err.message)
  }
}

/**
 * O app consegue se fechar sozinho? Tizen, webOS e APK sim; no navegador do PC não (lá Voltar não pode
 * fechar a janela do usuário). Usado para só oferecer "Sair" onde ele funciona.
 */
export function canExitApp() {
  return !!(window.tizen && window.tizen.application) || isWebOS() || isNativeApp()
}

/**
 * Pop-up (Picture-in-Picture) no APK de celular/tablet: com `true`, sair do app (Home ou troca
 * de app) leva o vídeo para uma janela flutuante. O Android ignora em TVs. Fora do APK, não faz nada.
 */
export async function setPictureInPictureEnabled(enabled) {
  if (!isNativeApp()) return
  try {
    await PictureInPicture.setEnabled({ enabled: !!enabled })
  } catch (err) {
    console.warn('[platform] Pop-up indisponível:', err && err.message)
  }
}

/** Listener nativo (registro assíncrono) com cancelamento síncrono. */
function cancellable(handlePromise) {
  let handle = null
  let cancelled = false
  handlePromise
    .then((h) => {
      handle = h
      if (cancelled) h.remove()
    })
    .catch((err) => console.warn('[platform] Evento nativo indisponível:', err && err.message))
  return () => {
    cancelled = true
    if (handle) handle.remove()
  }
}

/**
 * Avisa quando o app entra (`true`) ou sai (`false`) do pop-up.
 * @returns {() => void} cancela o aviso
 */
export function onPictureInPictureChange(callback) {
  if (!isNativeApp()) return () => {}
  return cancellable(
    PictureInPicture.addListener('pictureInPictureChange', (data) => callback(!!(data && data.active))),
  )
}

/**
 * Avisa quando o app deixa de estar na tela: Home/troca de app na TV (exigência Samsung/LG:
 * a reprodução precisa parar) ou no Android (Home sem pop-up, ou pop-up fechado). No navegador
 * do PC não avisa: trocar de aba não deve interromper o áudio.
 * @returns {() => void} cancela o aviso
 */
export function onAppBackground(callback) {
  if (isNativeApp()) {
    return cancellable(
      import('@capacitor/app').then(({ App }) =>
        App.addListener('appStateChange', (state) => {
          if (state && state.isActive === false) callback()
        }),
      ),
    )
  }
  if (window.tizen || window.webOS || isWebOS()) {
    const onVisibility = () => {
      if (document.hidden) callback()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }
  return () => {}
}
