<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { registerBackHandler, pushFocusScope } from '@/utils/spatialNavigation'

/**
 * Pede o PIN do controle parental. `submit(pin)` devolve true (fecha) ou uma mensagem de erro (fica aberto).
 * Voltar ou "Cancelar" emite `cancel`.
 */
const props = defineProps({
  title: { type: String, default: 'Digite o PIN' },
  hint: { type: String, default: '' },
  submit: { type: Function, required: true },
})
const emit = defineEmits(['done', 'cancel'])

const rootEl = ref(null)
const pin = ref('')
const error = ref('')
const busy = ref(false)
let releaseBack = null
let popScope = null

async function confirm() {
  if (busy.value) return
  busy.value = true
  try {
    const result = await props.submit(pin.value)
    if (result === true) emit('done')
    else {
      error.value = result || 'PIN incorreto.'
      pin.value = ''
    }
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  releaseBack = registerBackHandler(() => {
    emit('cancel')
    return true
  })
  nextTick(() => {
    popScope = pushFocusScope(rootEl.value)
    document.getElementById('pin-input')?.focus()
  })
})

onBeforeUnmount(() => {
  if (releaseBack) releaseBack()
  if (popScope) popScope()
})
</script>

<template>
  <div
    ref="rootEl"
    role="dialog"
    aria-modal="true"
    aria-labelledby="pin-title"
    data-focus-group="pin-dialog"
    class="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-8 phone-portrait:p-4"
  >
    <div class="w-full max-w-[30rem] bg-[#121215] border border-white/10 rounded-2xl p-8 phone-portrait:p-5 shadow-2xl">
      <h2 id="pin-title" class="text-tv-lg font-bold text-white">{{ title }}</h2>
      <p v-if="hint" class="mt-2 text-tv-sm text-neutral-400">{{ hint }}</p>
      <div data-focus-row="pin-input-row" class="mt-5">
        <input
          id="pin-input"
          v-model="pin"
          type="password"
          inputmode="numeric"
          autocomplete="off"
          maxlength="8"
          readonly="readonly"
          data-tv-editing="false"
          class="tv-input text-center tracking-[0.5em]"
          aria-label="PIN"
          @keyup.enter="confirm"
        />
      </div>
      <p v-if="error" id="pin-error" class="mt-3 text-tv-sm text-red-400" role="alert">{{ error }}</p>
      <div data-focus-row="pin-actions" class="mt-6 flex justify-end gap-4 phone-portrait:flex-col-reverse phone-portrait:gap-2.5">
        <button id="pin-cancel" type="button" class="tv-btn" @click="emit('cancel')">Cancelar</button>
        <button id="pin-confirm" type="button" class="tv-btn tv-btn-primary" :disabled="busy" @click="confirm">Confirmar</button>
      </div>
    </div>
  </div>
</template>
