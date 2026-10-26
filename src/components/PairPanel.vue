<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { usePairing } from '@/composables/usePairing'
import { qrSvgData } from '@/utils/qrSvg'
import { formatTime } from '@/utils/formatTime'

/**
 * Adicionar lista pelo celular (RFC-016): QR + código na TV, confirmação do que chegou e erros.
 * Cuida do próprio foco: sempre no botão principal do estado atual. Avisa o pai com `done` (entrou na lista)
 * e `manual` (o usuário prefere digitar; só aparece com `showManual`).
 */
const props = defineProps({
  qrRem: { type: Number, default: 20 },
  /** Coluna estreita (gerenciador de listas): código e espaçamento menores para caber ao lado do QR. */
  compact: { type: Boolean, default: false },
  showManual: { type: Boolean, default: false },
})
const emit = defineEmits(['done', 'manual'])

const pairing = usePairing()
const { state, code, pageUrl, displayUrl, secondsLeft, received, error, errorDetail, errorKind } = pairing

const root = ref(null)

const qr = computed(() => {
  if (!pageUrl.value) return null
  try {
    return qrSvgData(pageUrl.value)
  } catch (_) {
    return null // sem QR (endereço grande demais): o código e o endereço curto continuam na tela
  }
})
const qrStyle = computed(() => ({ width: `${props.qrRem}rem`, height: `${props.qrRem}rem` }))

const ERROR_TITLES = {
  unavailable: 'Não consegui gerar o código',
  badData: 'Não deu para ler o envio',
  login: 'Não deu para abrir a lista',
}
const errorTitle = computed(() => ERROR_TITLES[errorKind.value] || ERROR_TITLES.unavailable)
const retryLabel = computed(() => (errorKind.value === 'unavailable' ? 'Tentar de novo' : 'Enviar de novo'))

const PRIMARY_ID = {
  starting: 'pair-refresh',
  waiting: 'pair-refresh',
  expired: 'pair-refresh',
  received: 'pair-accept',
  connecting: 'pair-busy',
  error: 'pair-retry',
}

/** Foco no botão principal, a menos que o usuário já tenha ido para outro campo da tela. */
function focusPrimary() {
  nextTick(() => {
    const active = document.activeElement
    const free = !active || active === document.body || (root.value && root.value.contains(active))
    const el = free && document.getElementById(PRIMARY_ID[state.value])
    if (el) el.focus()
  })
}

watch(state, (next) => {
  if (next === 'done') emit('done')
  else focusPrimary()
})

onMounted(() => {
  pairing.start()
  focusPrimary()
})
</script>

<template>
  <div ref="root" data-focus-group="pair-panel">
    <!-- Esperando o celular -->
    <template v-if="state === 'waiting' || state === 'starting'">
      <h2 class="text-tv-lg font-black text-white tracking-tight">Use o seu celular</h2>
      <p class="mt-2 text-tv-sm text-neutral-400">Escaneie o código, cole o link da lista e pronto. Sem digitar no controle.</p>

      <div class="mt-6 flex items-start" :class="compact ? 'gap-6' : 'gap-8'">
        <svg
          v-if="qr"
          id="pair-qr"
          class="shrink-0 rounded-xl"
          :style="qrStyle"
          :viewBox="`-4 -4 ${qr.size + 8} ${qr.size + 8}`"
          shape-rendering="crispEdges"
          role="img"
          :aria-label="`QR code para abrir ${displayUrl} no celular`"
        >
          <rect x="-4" y="-4" :width="qr.size + 8" :height="qr.size + 8" fill="#fff" />
          <path :d="qr.path" fill="#000" />
        </svg>
        <div
          v-else
          class="shrink-0 rounded-xl border border-white/10 bg-white/[0.06] flex items-center justify-center"
          :style="qrStyle"
        >
          <span class="text-tv-sm text-neutral-400">{{ state === 'starting' ? 'Gerando o código…' : '' }}</span>
        </div>

        <div v-if="code" class="min-w-0">
          <p class="text-tv-xs text-neutral-500">ou abra no celular</p>
          <p id="pair-url" class="font-mono text-tv-base font-bold text-tv-accent-soft break-all">{{ displayUrl }}</p>
          <p class="mt-4 text-tv-xs text-neutral-500">código</p>
          <p
            id="pair-code"
            class="font-mono font-black text-white"
            :class="compact ? 'text-tv-lg tracking-[0.2em]' : 'text-tv-xl tracking-[0.3em]'"
          >
            {{ code }}
          </p>
          <p class="mt-4 flex items-center gap-2 text-tv-xs text-tv-meta">
            <span class="w-3 h-3 rounded-full bg-tv-accent"></span>
            <span>Aguardando · válido por {{ formatTime(secondsLeft) }}</span>
          </p>
        </div>
      </div>

      <div class="mt-8 flex items-center gap-4">
        <button id="pair-refresh" type="button" class="tv-btn" @click="pairing.start()">Novo código</button>
        <button v-if="showManual" id="pair-manual" type="button" class="tv-btn" @click="emit('manual')">Digitar manualmente</button>
      </div>
    </template>

    <!-- Chegou uma lista: confirmar antes de importar (defesa contra quem adivinhe o código) -->
    <template v-else-if="(state === 'received' || state === 'connecting') && received">
      <h2 class="text-tv-lg font-black text-white tracking-tight">
        {{ state === 'received' ? 'Adicionar esta lista?' : 'Conectando…' }}
      </h2>
      <p class="mt-2 text-tv-sm text-neutral-400">
        {{
          state === 'received'
            ? 'Confirme só se foi você quem enviou.'
            : `Baixando a lista de ${received.host}. Listas grandes podem demorar um pouco.`
        }}
      </p>

      <div class="mt-6 rounded-xl border border-white/10 bg-white/[0.04] px-6 py-5">
        <p class="text-tv-xs text-neutral-500">Servidor</p>
        <p id="pair-host" class="text-tv-lg font-extrabold text-white break-all">{{ received.host }}</p>
        <p v-if="received.label || received.insecure" class="mt-2 flex items-center gap-3">
          <span v-if="received.label" class="text-tv-sm text-neutral-300">Apelido: {{ received.label }}</span>
          <span
            v-if="received.insecure"
            class="px-2 py-0.5 rounded text-tv-xs font-bold bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30 uppercase"
          >
            SEM CRIPTOGRAFIA
          </span>
        </p>
      </div>

      <div class="mt-8 flex items-center gap-4">
        <template v-if="state === 'received'">
          <button id="pair-accept" type="button" class="tv-btn tv-btn-primary" @click="pairing.confirm()">Adicionar</button>
          <button id="pair-discard" type="button" class="tv-btn" @click="pairing.discard()">Descartar</button>
        </template>
        <button v-else id="pair-busy" type="button" class="tv-btn tv-btn-primary" aria-busy="true">
          <svg class="w-8 h-8 mr-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
          <span>Conectando…</span>
        </button>
      </div>
    </template>

    <!-- O código venceu -->
    <template v-else-if="state === 'expired'">
      <h2 class="text-tv-lg font-black text-white tracking-tight">O código expirou</h2>
      <p class="mt-2 text-tv-sm text-neutral-400">Por segurança o código vale 10 minutos. Gere outro e tente de novo.</p>
      <div class="mt-8 flex items-center gap-4">
        <button id="pair-refresh" type="button" class="tv-btn tv-btn-primary" @click="pairing.start()">Gerar novo código</button>
        <button v-if="showManual" id="pair-manual" type="button" class="tv-btn" @click="emit('manual')">Digitar manualmente</button>
      </div>
    </template>

    <!-- Algo deu errado -->
    <template v-else-if="state === 'error'">
      <h2 class="text-tv-lg font-black text-white tracking-tight">{{ errorTitle }}</h2>
      <div class="mt-4 rounded-2xl border-2 border-red-500/60 bg-red-500/10 px-6 py-4 text-tv-sm text-red-300" role="alert">
        <p class="font-semibold">{{ error }}</p>
        <p v-if="errorDetail" class="font-mono text-tv-xs text-red-300/90 bg-black/50 border border-red-500/20 rounded p-2.5 mt-2.5 break-all">
          Causa técnica: {{ errorDetail }}
        </p>
      </div>
      <div class="mt-8 flex items-center gap-4">
        <button id="pair-retry" type="button" class="tv-btn tv-btn-primary" @click="pairing.start()">{{ retryLabel }}</button>
        <button v-if="showManual" id="pair-manual" type="button" class="tv-btn" @click="emit('manual')">Digitar manualmente</button>
      </div>
    </template>
  </div>
</template>
