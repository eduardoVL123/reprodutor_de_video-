<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import BrandMark from '@/components/BrandMark.vue'
import { qrSvgData } from '@/utils/qrSvg'
import { plansPageUrl, isStoreBuild } from '@/services/licenseApi'
import { pushFocusScope } from '@/utils/spatialNavigation'

/**
 * "Ative este aparelho" (RFC-018 R7): o teste de 7 dias acabou e a lista não é de parceiro.
 * QR e endereço levam à página de planos com o código; na versão das lojas (D4) não há QR nem preço.
 * Fica abaixo dos diálogos (z-40): Gerenciar listas e "Sair do app?" abrem por cima.
 */
const props = defineProps({ code: { type: String, required: true } })
defineEmits(['retry', 'manage-lists'])

const rootEl = ref(null)
const storeBuild = isStoreBuild()
const pageUrl = computed(() => plansPageUrl(props.code))
const displayUrl = computed(() => pageUrl.value.replace(/^https?:\/\//i, ''))
const qr = computed(() => {
  if (storeBuild) return null
  try {
    return qrSvgData(pageUrl.value)
  } catch (_) {
    return null // endereço grande demais para o QR: o endereço escrito continua na tela
  }
})
let popScope = null

onMounted(() => {
  nextTick(() => {
    popScope = pushFocusScope(rootEl.value)
    const retry = document.getElementById('activation-retry')
    if (retry) retry.focus()
  })
})

onBeforeUnmount(() => {
  if (popScope) popScope()
})
</script>

<template>
  <div
    id="activation-required"
    ref="rootEl"
    role="dialog"
    aria-modal="true"
    aria-labelledby="activation-title"
    data-focus-group="activation"
    class="fixed inset-0 z-40 flex items-center justify-center bg-tv-deep px-24 py-14 select-none"
  >
    <div class="flex items-center gap-16 max-w-full">
      <svg
        v-if="qr"
        id="activation-qr"
        class="shrink-0 rounded-xl w-[18rem] h-[18rem]"
        :viewBox="`-4 -4 ${qr.size + 8} ${qr.size + 8}`"
        shape-rendering="crispEdges"
        role="img"
        :aria-label="`QR code para abrir ${displayUrl}`"
      >
        <rect x="-4" y="-4" :width="qr.size + 8" :height="qr.size + 8" fill="#fff" />
        <path :d="qr.path" fill="#000" />
      </svg>

      <div class="min-w-0 max-w-[48rem]">
        <BrandMark :size="2.5" class="block mb-5 text-tv-accent" />
        <h1 id="activation-title" class="text-tv-xl font-bold text-white">Ative este aparelho</h1>
        <p class="mt-3 text-tv-sm text-neutral-300 leading-relaxed">
          O período de teste de 7 dias terminou. Para continuar com esta lista, ative o aparelho.
        </p>
        <p v-if="!storeBuild" class="mt-2 text-tv-sm text-neutral-300 leading-relaxed">
          Escaneie o QR code ou abra <span class="text-white font-semibold">{{ displayUrl }}</span> e veja os planos.
        </p>
        <p v-else class="mt-2 text-tv-sm text-neutral-300 leading-relaxed">
          Fale com seu fornecedor e informe o código abaixo.
        </p>

        <p class="mt-6 text-tv-xs uppercase tracking-[0.25em] text-neutral-500 font-bold">Código do aparelho</p>
        <p id="activation-code" class="mt-1 font-mono text-tv-2xl font-black tracking-[0.2em] text-tv-accent">{{ code }}</p>

        <div class="mt-8 flex flex-wrap gap-4">
          <button id="activation-retry" type="button" class="tv-btn tv-btn-primary min-w-[16rem]" @click="$emit('retry')">
            Já paguei, verificar
          </button>
          <button id="activation-lists" type="button" class="tv-btn min-w-[16rem]" @click="$emit('manage-lists')">
            Usar outra lista
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
