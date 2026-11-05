import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { storage } from '@/services/storage'

/**
 * Controle parental e categorias escondidas (por perfil). Cada categoria fica em um de três estados:
 *  - 'visible': aparece normalmente;
 *  - 'locked': o nome aparece com cadeado, mas os itens só abrem com o PIN (e ficam fora de "Todos", Início e busca);
 *  - 'hidden': some de tudo.
 * Sem escolha do usuário, categorias com nome adulto começam bloqueadas. O PIN vale para o aparelho (todos os
 * perfis) e é criado no primeiro uso (não há PIN de fábrica); desbloquear com o PIN vale até fechar o app.
 */

const PIN_KEY = 'parental:pin'
export const PIN_PATTERN = /^\d{4,8}$/
// Por perfil E por lista: o id de categoria só vale dentro da lista (na M3U é a posição do grupo).
const settingsKey = (profileId, listId) => `parental:categories:${profileId || 'default'}:${listId || 'none'}`
const UNREADABLE = '!' // nenhum hash é igual: com o storage falhando, nada abre e o PIN salvo não é sobrescrito
const MAX_PIN_FAILS = 5
const PIN_LOCK_MS = 30e3
// Nomes de categoria que entram bloqueados por padrão (listas costumam usar estes termos para conteúdo adulto).
export const ADULT_NAME = /adult|xxx|\+\s?18|18\s?\+|porn|er[oó]tic|sexy|playboy/i
const SECTIONS = ['live', 'vod', 'series']
const emptySettings = () => ({ live: {}, vod: {}, series: {} })

async function hashPin(pin) {
  const text = `pulse-pin:${pin}`
  const subtle = globalThis.crypto && globalThis.crypto.subtle
  // shortcut: TV sem Web Crypto guarda o PIN como texto; é um PIN de 4 a 8 dígitos, não uma senha.
  if (!subtle) return `plain:${pin}`
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const useParentalStore = defineStore('parental', () => {
  const settings = shallowRef(emptySettings())
  const pinHash = ref('')
  const unlocked = ref(new Set()) // `${section}:${id}` desbloqueadas nesta abertura do app
  let key = settingsKey()
  let loadSeq = 0
  let pinFails = 0
  let pinLockedUntil = 0

  async function load(profileId, listId) {
    const seq = ++loadSeq
    key = settingsKey(profileId, listId)
    unlocked.value = new Set() // desbloqueio do pai não passa para outro perfil nem outra lista
    settings.value = emptySettings()
    try {
      const saved = await storage.get(key)
      const savedPin = await storage.get(PIN_KEY)
      if (seq !== loadSeq) return // troca rápida: a leitura velha não sobrescreve a nova
      const next = emptySettings()
      if (saved && typeof saved === 'object') SECTIONS.forEach((s) => Object.assign(next[s], saved[s] || {}))
      settings.value = next
      pinHash.value = typeof savedPin === 'string' && savedPin ? savedPin : ''
    } catch (_) {
      if (seq === loadSeq) pinHash.value = UNREADABLE
    }
  }

  /** Estado da categoria: escolha do usuário, ou bloqueada se o nome for adulto. */
  function statusOf(section, category) {
    if (!category) return 'visible'
    const chosen = settings.value[section] && settings.value[section][String(category.category_id)]
    if (chosen) return chosen
    return ADULT_NAME.test(String(category.category_name || '')) ? 'locked' : 'visible'
  }

  function isLocked(section, category) {
    return statusOf(section, category) === 'locked' && !unlocked.value.has(`${section}:${category.category_id}`)
  }

  /** Ids fora de "Todos", Início e busca: escondidas e bloqueadas ainda sem PIN. */
  function blockedIds(section, categories) {
    return (categories || [])
      .filter((c) => statusOf(section, c) === 'hidden' || isLocked(section, c))
      .map((c) => String(c.category_id))
  }

  async function setStatus(section, category, status) {
    const next = { ...settings.value, [section]: { ...settings.value[section], [String(category.category_id)]: status } }
    settings.value = next
    await storage.set(key, next).catch((err) => console.warn('[parental] Falha ao salvar:', err))
  }

  /** Ainda não há PIN: o primeiro que o usuário digitar vira o PIN (não existe PIN de fábrica). */
  const needsPin = () => !pinHash.value

  async function savePin(pin) {
    pinHash.value = await hashPin(pin)
    await storage.set(PIN_KEY, pinHash.value)
  }

  /**
   * Confere o PIN. Sem PIN criado, o PIN digitado (4 a 8 números) passa a ser o PIN do aparelho.
   * @returns {Promise<boolean>}
   */
  async function checkPin(pin) {
    if (Date.now() < pinLockedUntil || !PIN_PATTERN.test(String(pin || ''))) return false
    if (needsPin()) {
      await savePin(pin)
      return true
    }
    if ((await hashPin(pin)) === pinHash.value) {
      pinFails = 0
      return true
    }
    // Só 10 mil PINs de 4 dígitos: depois de 5 erros, espera 30 s (pelo controle, testar todos leva dias).
    if (++pinFails >= MAX_PIN_FAILS) {
      pinFails = 0
      pinLockedUntil = Date.now() + PIN_LOCK_MS
    }
    return false
  }

  /** Mensagem para PIN recusado: em espera depois de muitos erros, ou só incorreto. */
  const pinError = () =>
    Date.now() < pinLockedUntil
      ? `Muitas tentativas. Espere ${Math.ceil((pinLockedUntil - Date.now()) / 1000)} s.`
      : 'PIN incorreto.'

  /** @returns {Promise<boolean>} PIN certo: a categoria abre até fechar o app. */
  async function unlock(section, category, pin) {
    if (!(await checkPin(pin))) return false
    unlocked.value = new Set(unlocked.value).add(`${section}:${category.category_id}`)
    return true
  }

  /** @returns {Promise<string>} '' se trocou; senão o motivo. */
  async function changePin(current, next) {
    if (!(await checkPin(current))) return Date.now() < pinLockedUntil ? pinError() : 'PIN atual incorreto.'
    if (!PIN_PATTERN.test(String(next || ''))) return 'O novo PIN precisa ter de 4 a 8 números.'
    await savePin(next)
    return ''
  }

  return { settings, unlocked, load, statusOf, isLocked, blockedIds, setStatus, checkPin, unlock, changePin, needsPin, pinError }
})
