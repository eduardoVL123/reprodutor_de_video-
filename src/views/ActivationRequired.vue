<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import BrandMark from '@/components/BrandMark.vue'
import { qrSvgData } from '@/utils/qrSvg'
import { plansPageUrl, isStoreBuild } from '@/services/licenseApi'
import { openExternal } from '@/services/platform'
import { isPhone } from '@/utils/compat'
import { pushFocusScope } from '@/utils/spatialNavigation'
import { useAuthStore } from '@/stores/authStore'

/**
 * "Ative este aparelho" (RFC-018 R7): o teste de 7 dias acabou e a lista não é de parceiro.
 * QR e endereço levam à página de planos com o código; na versão das lojas (D4) não há QR nem preço.
 * Fica abaixo dos diálogos (z-40): Gerenciar listas e "Sair do app?" abrem por cima.
 */
// reason (licenseStore.blockReason): 'blocked' = teste acabou; 'suspended' = o dono bloqueou o aparelho (RFC-019),
// só falar com o suporte; 'offline' = a licença não foi confirmada há mais de 7 dias (ou nunca), precisa de conexão.
const props = defineProps({ code: { type: String, default: '' }, reason: { type: String, default: 'blocked' } })
const emit = defineEmits(['retry', 'manage-lists', 'demo-opened'])
const auth = useAuthStore()
const demoPlaylistUrl = String(import.meta.env.VITE_DEMO_PLAYLIST_URL || '').trim()

async function tryDemo() {
  const ok = await auth.login({ dns: demoPlaylistUrl, username: '', password: '', label: 'Demonstração' })
  if (ok) emit('demo-opened')
}

const rootEl = ref(null)
const storeBuild = isStoreBuild()
// Celular: o QR leria a própria tela; vira um botão que abre a mesma página de planos (RFC-023).
const onPhone = isPhone()
const suspended = computed(() => props.reason === 'suspended')
const offline = computed(() => props.reason === 'offline')
const pageUrl = computed(() => plansPageUrl(props.code))
const displayUrl = computed(() => pageUrl.value.replace(/^https?:\/\//i, ''))
const qr = computed(() => {
  if (onPhone || storeBuild || suspended.value || offline.value || !props.code) return null
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
    class="fixed inset-0 z-40 flex items-center justify-center bg-tv-deep px-24 py-14 select-none phone-portrait:px-6 phone-portrait:py-8 phone-portrait:overflow-y-auto"
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
        <template v-if="offline">
          <h1 id="activation-title" class="text-tv-xl font-bold text-white">Verifique a conexão</h1>
          <p class="mt-3 text-tv-sm text-neutral-300 leading-relaxed">
            Não foi possível confirmar a licença deste aparelho. Confira se a TV está conectada à internet e tente de novo.
          </p>
        </template>
        <template v-else-if="suspended">
          <h1 id="activation-title" class="text-tv-xl font-bold text-white">Aparelho suspenso</h1>
          <p class="mt-3 text-tv-sm text-neutral-300 leading-relaxed">
            O acesso deste aparelho foi suspenso. Fale com o suporte e informe o código abaixo.
          </p>
        </template>
        <template v-else>
          <h1 id="activation-title" class="text-tv-xl font-bold text-white">Ative este aparelho</h1>
          <p class="mt-3 text-tv-sm text-neutral-300 leading-relaxed">
            O período de teste de 7 dias terminou. Para continuar com esta lista, ative o aparelho.
          </p>
          <p v-if="!storeBuild && !onPhone" class="mt-2 text-tv-sm text-neutral-300 leading-relaxed">
            Escaneie o QR code ou abra <span class="text-white font-semibold">{{ displayUrl }}</span> e veja os planos.
          </p>
          <p v-else class="mt-2 text-tv-sm text-neutral-300 leading-relaxed">
            Use o código abaixo para ativar este aparelho.
          </p>
        </template>

        <template v-if="code">
          <p class="mt-6 text-tv-xs uppercase tracking-[0.25em] text-neutral-500 font-bold">Código do aparelho</p>
          <p id="activation-code" class="mt-1 font-mono text-tv-2xl font-black tracking-[0.2em] text-tv-accent">{{ code }}</p>
        </template>

        <div class="mt-8 flex flex-wrap gap-4 phone-portrait:flex-col phone-portrait:gap-2.5">
          <button
            v-if="onPhone && !storeBuild && !suspended && !offline && code"
            id="activation-plans"
            type="button"
            class="tv-btn tv-btn-primary min-w-[16rem]"
            @click="openExternal(pageUrl)"
          >
            Ver planos e ativar
          </button>
          <button id="activation-retry" type="button" class="tv-btn min-w-[16rem]" :class="onPhone && !storeBuild && !suspended && !offline && code ? '' : 'tv-btn-primary'" @click="$emit('retry')">
            {{ offline ? 'Tentar de novo' : storeBuild ? 'Verificar ativação' : 'Já paguei, verificar' }}
          </button>
          <button id="activation-lists" type="button" class="tv-btn min-w-[16rem]" @click="$emit('manage-lists')">
            Usar outra lista
          </button>
          <button v-if="demoPlaylistUrl" id="activation-demo" type="button" class="tv-btn min-w-[16rem]" :disabled="auth.loading" @click="tryDemo">
            {{ auth.loading ? 'Abrindo demonstração…' : 'Experimentar demonstração' }}
          </button>
        </div>
        <p v-if="auth.error" role="alert" class="mt-3 text-tv-sm text-red-400">{{ auth.error }}</p>
      </div>
    </div>
  </div>
</template>
