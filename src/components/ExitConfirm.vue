<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import BrandMark from '@/components/BrandMark.vue'
import { canExitApp, exitApp } from '@/services/platform'
import { pushFocusScope, registerBackHandler, setExitHandler } from '@/utils/spatialNavigation'

/**
 * "Sair do Pulse Player?" ao apertar Voltar na tela inicial: Samsung e LG (webOS 6+) exigem a confirmação
 * e só fecham o app no "Sim". O foco começa em "Cancelar" para um Voltar a mais não fechar o app sem querer.
 */
const open = ref(false)
const rootEl = ref(null)
let previousFocus = null
let popScope = null
let cleanupBack = null
let unregisterExit = null

function ask() {
  if (open.value) return
  previousFocus = document.activeElement
  open.value = true
  nextTick(() => {
    popScope = pushFocusScope(rootEl.value)
    cleanupBack = registerBackHandler(() => {
      close()
      return true
    })
    const cancel = document.getElementById('exit-cancel')
    if (cancel) cancel.focus()
  })
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

onMounted(() => {
  if (canExitApp()) unregisterExit = setExitHandler(ask)
})

onBeforeUnmount(() => {
  if (unregisterExit) unregisterExit()
  release()
})
</script>

<template>
  <div
    v-if="open"
    id="exit-confirm-dialog"
    ref="rootEl"
    role="dialog"
    aria-modal="true"
    aria-labelledby="exit-confirm-title"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 select-none"
  >
    <div class="w-[44rem] rounded-2xl border border-white/10 bg-tv-surface px-12 py-10 text-center shadow-2xl">
      <BrandMark :size="3" class="block mx-auto mb-5 text-tv-accent" />
      <h2 id="exit-confirm-title" class="text-tv-xl font-bold text-white">Sair do Pulse Player?</h2>
      <div class="mt-8 flex justify-center gap-4">
        <button id="exit-cancel" type="button" class="tv-btn tv-btn-primary min-w-[12rem]" @click="close">Cancelar</button>
        <button id="exit-confirm" type="button" class="tv-btn min-w-[12rem]" @click="exitApp">Sair</button>
      </div>
    </div>
  </div>
</template>
