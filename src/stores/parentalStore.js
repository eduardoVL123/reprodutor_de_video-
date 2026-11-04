import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { storage } from '@/services/storage'

/**
 * Controle parental e categorias escondidas (por perfil). Cada categoria fica em um de três estados:
 *  - 'visible': aparece normalmente;
 *  - 'locked': o nome aparece com cadeado, mas os itens só abrem com o PIN (e ficam fora de "Todos", Início e busca);
 *  - 'hidden': some de tudo.
 * Sem escolha do usuário, categorias com nome adulto começam bloqueadas. O PIN vale para o aparelho (todos os
 * perfis); desbloquear com o PIN vale até fechar o app.
 */

const PIN_KEY = 'parental:pin'
export const DEFAULT_PIN = '0000'
export const PIN_PATTERN = /^\d{4,8}$/
const settingsKey = (profileId) => `parental:categories:${profileId || 'default'}`
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
  let profileId = ''

  async function load(id) {
    profileId = id || 'default'
    try {
      const saved = await storage.get(settingsKey(profileId))
      const next = emptySettings()
      if (saved && typeof saved === 'object') SECTIONS.forEach((s) => Object.assign(next[s], saved[s] || {}))
      settings.value = next
      const savedPin = await storage.get(PIN_KEY)
      pinHash.value = typeof savedPin === 'string' && savedPin ? savedPin : ''
    } catch (_) {
      settings.value = emptySettings()
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
    await storage.set(settingsKey(profileId), next).catch((err) => console.warn('[parental] Falha ao salvar:', err))
  }

  async function checkPin(pin) {
    if (!PIN_PATTERN.test(String(pin || ''))) return false
    const expected = pinHash.value || (await hashPin(DEFAULT_PIN))
    return (await hashPin(pin)) === expected
  }

  /** @returns {Promise<boolean>} PIN certo: a categoria abre até fechar o app. */
  async function unlock(section, category, pin) {
    if (!(await checkPin(pin))) return false
    unlocked.value = new Set(unlocked.value).add(`${section}:${category.category_id}`)
    return true
  }

  /** @returns {Promise<string>} '' se trocou; senão o motivo. */
  async function changePin(current, next) {
    if (!(await checkPin(current))) return 'PIN atual incorreto.'
    if (!PIN_PATTERN.test(String(next || ''))) return 'O novo PIN precisa ter de 4 a 8 números.'
    pinHash.value = await hashPin(next)
    await storage.set(PIN_KEY, pinHash.value)
    return ''
  }

  const usingDefaultPin = () => !pinHash.value

  return { settings, unlocked, load, statusOf, isLocked, blockedIds, setStatus, checkPin, unlock, changePin, usingDefaultPin }
})
