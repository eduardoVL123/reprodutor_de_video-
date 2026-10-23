<script setup>
import { ref, nextTick, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { registerBackHandler, pushFocusScope, focusFirstIn } from '@/utils/spatialNavigation'

/**
 * Gerenciador de listas (servidores/playlists salvos). O pai abre com `open()` (via ref) e é
 * avisado por `changed` quando a lista ativa muda (ativar ou adicionar) e por `logged-out`
 * quando o usuário sai da conta. Cuida do próprio foco, escopo de navegação e tecla Voltar.
 */
const emit = defineEmits(['changed', 'logged-out'])

const auth = useAuthStore()

const emptyForm = () => ({ label: '', dns: '', username: '', password: '' })

const isOpen = ref(false)
const formError = ref('')
const formErrorDetail = ref('')
const isConnecting = ref(false)
const isSwitching = ref(false)
const form = ref(emptyForm())

let triggerId = 'btn-manage-lists'
let popScope = null
let cleanupBack = null

function clearErrors() {
  formError.value = ''
  formErrorDetail.value = ''
}

function release() {
  if (popScope) {
    popScope()
    popScope = null
  }
  if (cleanupBack) {
    cleanupBack()
    cleanupBack = null
  }
}

function open() {
  triggerId = document.activeElement?.id || 'btn-manage-lists'
  isOpen.value = true
  clearErrors()
  form.value = emptyForm()

  nextTick(() => {
    const el = document.getElementById('modal-lists')
    if (el) {
      if (popScope) popScope()
      popScope = pushFocusScope(el)
      focusFirstIn(el)
    }
  })

  if (cleanupBack) cleanupBack()
  cleanupBack = registerBackHandler(() => {
    if (!isOpen.value) return false
    close()
    return true
  })
}

function close() {
  isOpen.value = false
  release()
  const idToFocus = triggerId || 'btn-manage-lists'
  nextTick(() => {
    document.getElementById(idToFocus)?.focus()
  })
}

async function switchList(listId) {
  try {
    isSwitching.value = true
    clearErrors()
    const ok = await auth.switchList(listId)
    if (!ok) {
      formError.value = auth.error || 'Não foi possível alternar para a lista selecionada.'
      formErrorDetail.value = auth.errorDetail || ''
      return
    }
    close()
    emit('changed')
  } catch (err) {
    formError.value = err.message || 'Falha ao alternar para a lista selecionada.'
    formErrorDetail.value = err.detail || String(err)
  } finally {
    isSwitching.value = false
  }
}

async function removeList(listId) {
  try {
    clearErrors()
    await auth.removeList(listId)
  } catch (err) {
    formError.value = err.message || 'Falha ao excluir a lista.'
    formErrorDetail.value = err.detail || String(err)
  }
}

async function addList() {
  if (!form.value.dns) {
    formError.value = 'Informe o endereço do servidor ou da playlist.'
    formErrorDetail.value = 'Campo de endereço vazio.'
    return
  }

  try {
    isConnecting.value = true
    clearErrors()
    const ok = await auth.login({
      dns: form.value.dns,
      username: form.value.username,
      password: form.value.password,
      label: form.value.label || '',
    })
    if (!ok) {
      formError.value = auth.error || 'Não foi possível conectar a esta lista. Verifique os dados.'
      formErrorDetail.value = auth.errorDetail || ''
      return
    }
    close()
    emit('changed')
  } catch (err) {
    formError.value = err.message || 'Falha ao conectar com o servidor.'
    formErrorDetail.value = err.detail || String(err)
  } finally {
    isConnecting.value = false
  }
}

async function logout() {
  await auth.logout()
  close()
  emit('logged-out')
}

onBeforeUnmount(release)

defineExpose({ open, close })
</script>

<template>
  <div
    v-if="isOpen"
    id="modal-lists"
    class="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-12 select-none"
    role="dialog"
    aria-modal="true"
    data-focus-group="modal-lists-dialog"
  >
    <div class="w-full max-w-[70rem] max-h-[44rem] bg-[#121215] border border-white/10 rounded-2xl p-8 flex flex-col shadow-2xl">
      <!-- Topo do modal -->
      <header class="flex items-center justify-between pb-5 border-b border-white/[0.08]">
        <div>
          <h2 class="text-tv-xl font-bold text-white tracking-tight">Gerenciador de Listas</h2>
          <p class="text-tv-xs text-neutral-400 mt-1">
            Alterne entre suas listas cadastradas ou adicione um novo servidor ou playlist
          </p>
        </div>
        <button
          id="modal-close-btn"
          type="button"
          class="tv-btn !px-4 !py-2 text-tv-sm flex items-center gap-2"
          @click="close"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span>Fechar</span>
        </button>
      </header>

      <!-- Mensagem de erro -->
      <div
        v-if="formError"
        class="mt-4 p-4 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-tv-xs flex flex-col gap-2"
        role="alert"
      >
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-red-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span class="font-semibold">{{ formError }}</span>
        </div>
        <p
          v-if="formErrorDetail"
          class="font-mono text-tv-xs text-red-300/90 bg-black/50 border border-red-500/20 rounded p-2.5 break-all"
        >
          Causa técnica: {{ formErrorDetail }}
        </p>
      </div>

      <!-- Conteúdo do modal: 2 colunas -->
      <div class="grid grid-cols-2 gap-8 flex-1 min-h-0 pt-6">
        <!-- Coluna 1: listas salvas -->
        <div class="flex flex-col min-h-0">
          <h3 class="text-tv-sm font-bold text-neutral-200 mb-3 uppercase tracking-wider">
            Listas Salvas ({{ auth.savedLists.length }})
          </h3>

          <div class="flex-1 overflow-y-auto pr-3 space-y-3">
            <div
              v-for="list in auth.savedLists"
              :id="'saved-list-card-' + list.id"
              :key="list.id"
              class="rounded-xl border p-4 flex items-center justify-between transition-colors"
              :class="
                list.id === auth.currentListId
                  ? 'border-tv-accent bg-white/[0.04]'
                  : 'border-white/10 bg-white/[0.02]'
              "
            >
              <div class="min-w-0 pr-3">
                <div class="flex items-center gap-2.5 mb-1">
                  <span class="text-tv-sm font-bold text-white truncate">
                    {{ list.label || list.username }}
                  </span>
                  <span
                    v-if="list.id === auth.currentListId"
                    class="px-2 py-0.5 rounded text-tv-xs font-bold bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30 uppercase"
                  >
                    ATIVA
                  </span>
                </div>
                <p class="text-tv-xs text-neutral-400 truncate">
                  {{ list.username }} @ {{ list.baseUrl }}
                </p>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <button
                  v-if="list.id !== auth.currentListId"
                  :id="'btn-switch-' + list.id"
                  type="button"
                  class="tv-btn tv-btn-primary !px-4 !py-1.5 text-tv-xs font-semibold"
                  :disabled="isSwitching"
                  @click="switchList(list.id)"
                >
                  Ativar
                </button>

                <button
                  :id="'btn-remove-' + list.id"
                  type="button"
                  class="tv-btn !p-2 text-neutral-400 hover:text-red-400"
                  title="Excluir lista"
                  @click="removeList(list.id)"
                >
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>

            <div
              v-if="auth.savedLists.length === 0"
              class="text-tv-sm text-neutral-500 py-6 text-center"
            >
              Nenhuma lista adicional cadastrada.
            </div>
          </div>

          <!-- Botão Sair da Conta -->
          <div class="pt-4 border-t border-white/[0.06] mt-auto">
            <button
              id="btn-modal-logout"
              type="button"
              class="tv-btn !px-4 !py-2 text-tv-xs text-red-400 hover:text-red-300 flex items-center gap-2"
              @click="logout"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Sair da conta atual</span>
            </button>
          </div>
        </div>

        <!-- Coluna 2: adicionar nova lista -->
        <div class="flex flex-col min-h-0 pl-6 border-l border-white/[0.08]">
          <h3 class="text-tv-sm font-bold text-neutral-200 mb-1 uppercase tracking-wider">
            Adicionar Nova Lista
          </h3>
          <p class="text-tv-xs text-neutral-400 mb-3">
            Navegue com as setas e pressione OK para abrir o teclado
          </p>

          <form class="space-y-3.5 overflow-y-auto pr-2 pb-[20rem]" @submit.prevent="addList">
            <div>
              <label for="new-list-label" class="block text-tv-xs text-neutral-400 mb-1 font-medium">
                Nome / Apelido (opcional)
              </label>
              <input
                id="new-list-label"
                v-model="form.label"
                type="text"
                readonly="readonly"
                data-tv-editing="false"
                class="tv-input w-full"
                placeholder="Ex: Minha lista"
              />
            </div>

            <div>
              <label for="new-list-dns" class="block text-tv-xs text-neutral-400 mb-1 font-medium">
                Link Curto ou URL do Servidor
              </label>
              <input
                id="new-list-dns"
                v-model="form.dns"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                readonly="readonly"
                data-tv-editing="false"
                class="tv-input w-full"
                placeholder="Ex: servidor.com:8080"
              />
            </div>

            <div>
              <label for="new-list-user" class="block text-tv-xs text-neutral-400 mb-1 font-medium">
                Usuário (opcional para link curto)
              </label>
              <input
                id="new-list-user"
                v-model="form.username"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                readonly="readonly"
                data-tv-editing="false"
                class="tv-input w-full"
                placeholder="Seu usuário"
              />
            </div>

            <div>
              <label for="new-list-pass" class="block text-tv-xs text-neutral-400 mb-1 font-medium">
                Senha (opcional para link curto)
              </label>
              <input
                id="new-list-pass"
                v-model="form.password"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                readonly="readonly"
                data-tv-editing="false"
                class="tv-input w-full"
                placeholder="Sua senha"
              />
            </div>

            <div class="pt-2">
              <button
                id="btn-save-new-list"
                type="submit"
                class="tv-btn tv-btn-primary w-full !py-3 font-semibold flex items-center justify-center gap-2 text-tv-sm"
                :disabled="isConnecting"
              >
                <svg
                  v-if="isConnecting"
                  class="w-4 h-4 animate-spin text-black"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                </svg>
                <span>{{ isConnecting ? 'Conectando...' : 'Conectar e Salvar Lista' }}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
