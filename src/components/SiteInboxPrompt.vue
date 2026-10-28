<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useSiteInbox } from '@/composables/useSiteInbox'
import { useLicenseStore } from '@/stores/licenseStore'
import { pushFocusScope } from '@/utils/spatialNavigation'

/**
 * Enviar a lista pelo site (RFC-021), lado da TV: dica com o endereço do site e o código do aparelho e, quando
 * chega uma lista, "Adicionar esta lista?" por cima da tela (a TV sempre confirma antes, G20).
 * `done`: entrou na lista recebida.
 */
const emit = defineEmits(['done'])
const inbox = useSiteInbox()
const license = useLicenseStore()
const { received, connecting } = inbox
const rootEl = ref(null)
const siteHost = String(import.meta.env.VITE_LICENSE_BASE_URL || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '')
const showHint = computed(() => !!(siteHost && license.code))
let popScope = null

watch(received, async (value) => {
  if (popScope) popScope()
  popScope = null
  if (!value) return
  await nextTick()
  popScope = pushFocusScope(rootEl.value)
  document.getElementById('site-inbox-accept')?.focus()
})

async function accept() {
  if (await inbox.confirm()) emit('done')
}

onMounted(async () => {
  if (!license.code) {
    await license.announce() // TV sem lista: registra e publica a chave para o site poder enviar
    inbox.check()
  }
  if (received.value) {
    await nextTick()
    popScope = pushFocusScope(rootEl.value)
    document.getElementById('site-inbox-accept')?.focus()
  }
})
onBeforeUnmount(() => {
  if (popScope) popScope()
})
</script>

<template>
  <p v-if="showHint" id="site-hint" class="text-tv-xs text-neutral-400">
    Ou envie a lista pelo site <span class="text-white font-semibold">{{ siteHost }}</span> com o código
    <span class="font-mono tracking-widest text-tv-accent">{{ license.code }}</span>
  </p>

  <div
    v-if="received"
    id="site-inbox-dialog"
    ref="rootEl"
    role="dialog"
    aria-modal="true"
    aria-labelledby="site-inbox-title"
    data-focus-group="site-inbox"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 select-none"
  >
    <div class="w-[52rem] max-w-full rounded-2xl border border-white/10 bg-tv-surface px-12 py-10 shadow-2xl">
      <p class="text-tv-xs uppercase tracking-[0.25em] text-tv-accent font-bold">Chegou uma lista pelo site</p>
      <h2 id="site-inbox-title" class="mt-2 text-tv-xl font-bold text-white">
        {{ connecting ? 'Conectando…' : 'Adicionar esta lista?' }}
      </h2>
      <p class="mt-5 text-tv-lg font-extrabold text-white break-all">{{ received.host }}</p>
      <p v-if="received.label" class="mt-2 text-tv-sm text-neutral-300">Apelido: {{ received.label }}</p>
      <p v-if="received.insecure" class="mt-2 text-tv-sm text-amber-300">Conexão sem criptografia (http).</p>
      <div v-if="!connecting" class="mt-8 flex gap-4">
        <button id="site-inbox-accept" type="button" class="tv-btn tv-btn-primary min-w-[12rem]" @click="accept">Adicionar</button>
        <button id="site-inbox-discard" type="button" class="tv-btn min-w-[12rem]" @click="inbox.discard()">Descartar</button>
      </div>
    </div>
  </div>
</template>
