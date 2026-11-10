<script setup>
import { ref, nextTick, onBeforeUnmount } from 'vue'
import { useLicenseStore } from '@/stores/licenseStore'
import { devicePlatform } from '@/services/deviceIdentity'
import { readErrors, clearErrors } from '@/services/errorLog'
import { pushFocusScope, registerBackHandler } from '@/utils/spatialNavigation'

/**
 * Diagnóstico (Plano de robustez, item 6): código do aparelho e últimos erros guardados só nele, para o cliente
 * fotografar e mandar ao suporte. Abre pelo menu lateral (TV) e pela aba Conta (celular).
 */
const SHOWN = 8 // cabe na tela da TV sem rolagem (texto solto não recebe foco)

const license = useLicenseStore()
const open = ref(false)
const errors = ref([])
const rootEl = ref(null)
const platform = ref('')
let previousFocus = null
let popScope = null
let cleanupBack = null

const fmt = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

async function show() {
  if (open.value) return
  previousFocus = document.activeElement
  errors.value = await readErrors()
  platform.value = devicePlatform()
  open.value = true
  await nextTick()
  popScope = pushFocusScope(rootEl.value)
  cleanupBack = registerBackHandler(() => {
    close()
    return true
  })
  const first = document.getElementById('diag-close')
  if (first) first.focus()
}

function release() {
  if (popScope) popScope()
  if (cleanupBack) cleanupBack()
  popScope = null
  cleanupBack = null
}

function close() {
  open.value = false
  release()
  const el = previousFocus
  previousFocus = null
  nextTick(() => {
    if (el && document.body.contains(el)) el.focus()
  })
}

async function clear() {
  await clearErrors()
  errors.value = []
  const btn = document.getElementById('diag-close')
  if (btn) btn.focus()
}

onBeforeUnmount(release)
defineExpose({ open: show })
</script>

<template>
  <div
    v-if="open"
    id="diagnostics-dialog"
    ref="rootEl"
    role="dialog"
    aria-modal="true"
    aria-labelledby="diagnostics-title"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 select-none px-4"
  >
    <div class="w-[52rem] max-w-full max-h-full overflow-y-auto rounded-2xl border border-white/10 bg-tv-surface px-10 py-8 phone:px-5 phone:py-6 shadow-2xl">
      <h2 id="diagnostics-title" class="text-tv-xl font-bold text-white">Diagnóstico</h2>
      <p class="mt-2 text-tv-xs text-neutral-400">Fotografe esta tela e envie ao suporte. Nada daqui sai do aparelho sozinho.</p>

      <div class="mt-5 flex flex-wrap gap-x-8 gap-y-1 text-tv-sm">
        <span><span class="text-neutral-400">Código do aparelho: </span><span class="font-mono font-bold text-white">{{ license.code || '—' }}</span></span>
        <span><span class="text-neutral-400">Plataforma: </span><span class="text-white">{{ platform }}</span></span>
      </div>

      <h3 class="mt-6 text-tv-sm font-semibold text-white">Últimos erros</h3>
      <p v-if="!errors.length" id="diag-empty" class="mt-2 text-tv-xs text-neutral-400">Nenhum erro registrado.</p>
      <ul v-else id="diag-list" class="mt-2 flex flex-col gap-2">
        <li v-for="(e, i) in errors.slice(0, SHOWN)" :key="i" class="text-tv-xs text-neutral-300 leading-snug">
          <span class="font-mono text-neutral-400">{{ fmt(e.at) }}</span>
          <span v-if="e.where" class="text-neutral-400"> · {{ e.where }}</span>
          <span class="block text-white break-words">{{ e.message }}</span>
        </li>
        <li v-if="errors.length > SHOWN" class="text-tv-xs text-neutral-400">
          <span>e mais {{ errors.length - SHOWN }} anteriores</span>
        </li>
      </ul>

      <div class="mt-7 flex justify-end gap-4" data-focus-row="diagnostics-actions">
        <button v-if="errors.length" id="diag-clear" type="button" class="tv-focusable tv-btn min-w-[10rem]" @click="clear">Limpar</button>
        <button id="diag-close" type="button" class="tv-focusable tv-btn tv-btn-primary min-w-[10rem]" @click="close">Fechar</button>
      </div>
    </div>
  </div>
</template>
