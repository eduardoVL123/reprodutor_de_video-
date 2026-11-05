<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import PinDialog from '@/components/PinDialog.vue'
import { useParentalStore } from '@/stores/parentalStore'
import { registerBackHandler, pushFocusScope } from '@/utils/spatialNavigation'

/**
 * Controle parental de uma seção (item 1 e 3 do plano): para cada categoria, Visível → Bloqueada (abre com PIN) →
 * Escondida (some de tudo). Só abre com o PIN; dá para trocar o PIN aqui. Vale para o perfil atual.
 */
const props = defineProps({
  section: { type: String, required: true },
  categories: { type: Array, required: true }, // sem a entrada "Todos"
})
const emit = defineEmits(['close'])

const parental = useParentalStore()
const rootEl = ref(null)
const step = ref('pin') // 'pin' | 'list' | 'pin-current' | 'pin-new'
const currentPin = ref('')
let releaseBack = null
let popScope = null

const LABELS = { visible: 'Visível', locked: 'Bloqueada', hidden: 'Escondida' }
const NEXT = { visible: 'locked', locked: 'hidden', hidden: 'visible' }
const rows = computed(() => props.categories.map((c) => ({ category: c, status: parental.statusOf(props.section, c) })))
const defaultPinHint = computed(() =>
  parental.needsPin() ? 'Crie um PIN de 4 a 8 números. Ele protege as categorias bloqueadas; guarde-o.' : '',
)

async function enterList(pin) {
  if (!(await parental.checkPin(pin))) return parental.pinError()
  step.value = 'list'
  nextTick(() => {
    popScope = pushFocusScope(rootEl.value)
    document.getElementById('parental-row-0')?.focus()
  })
  return true
}

async function keepCurrent(pin) {
  if (!(await parental.checkPin(pin))) return parental.pinError()
  currentPin.value = pin
  step.value = 'pin-new'
  return true
}

async function saveNew(pin) {
  const problem = await parental.changePin(currentPin.value, pin)
  if (problem) return problem
  currentPin.value = ''
  step.value = 'list'
  return true
}

function cycle(row) {
  parental.setStatus(props.section, row.category, NEXT[row.status])
}

onMounted(() => {
  releaseBack = registerBackHandler(() => {
    if (step.value !== 'list') return false // o PinDialog trata o próprio Voltar
    emit('close')
    return true
  })
})

onBeforeUnmount(() => {
  if (releaseBack) releaseBack()
  if (popScope) popScope()
})
</script>

<template>
  <PinDialog
    v-if="step === 'pin'"
    title="Controle parental"
    :hint="defaultPinHint || 'Digite o PIN para escolher o que aparece.'"
    :submit="enterList"
    @cancel="emit('close')"
  />
  <PinDialog v-else-if="step === 'pin-current'" title="Trocar PIN" hint="Digite o PIN atual." :submit="keepCurrent" @cancel="step = 'list'" />
  <PinDialog v-else-if="step === 'pin-new'" title="Novo PIN" hint="De 4 a 8 números." :submit="saveNew" @cancel="step = 'list'" />

  <div
    v-show="step === 'list'"
    ref="rootEl"
    role="dialog"
    aria-modal="true"
    aria-labelledby="parental-title"
    data-focus-group="parental"
    class="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-8 phone-portrait:p-3"
  >
    <div class="w-full max-w-[56rem] max-h-[44rem] phone-portrait:max-h-full bg-[#121215] border border-white/10 rounded-2xl p-8 phone-portrait:p-5 flex flex-col shadow-2xl">
      <header class="flex items-start justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div class="min-w-0">
          <h2 id="parental-title" class="text-tv-xl font-bold text-white">Controle parental</h2>
          <p class="mt-1 text-tv-sm text-neutral-400">
            Bloqueada: abre só com o PIN. Escondida: some do app. Vale para este perfil.
          </p>
        </div>
        <div data-focus-row="parental-actions" class="flex gap-3 shrink-0 phone-portrait:flex-col phone-portrait:gap-2">
          <button id="parental-change-pin" type="button" class="tv-btn" @click="step = 'pin-current'">Trocar PIN</button>
          <button id="parental-close" type="button" class="tv-btn tv-btn-primary" @click="emit('close')">Pronto</button>
        </div>
      </header>

      <p v-if="!rows.length" class="py-8 text-tv-sm text-neutral-400">Esta lista não tem categorias.</p>
      <ul v-else class="flex-1 min-h-0 overflow-y-auto pt-3 space-y-2">
        <li
          v-for="(row, i) in rows"
          :key="row.category.category_id"
          :data-focus-row="'parental-row-' + i"
          class="flex items-center justify-between gap-4 rounded-xl px-4 py-2.5 bg-white/[0.03] border border-white/[0.06]"
        >
          <span class="text-tv-sm text-white truncate min-w-0">{{ row.category.category_name }}</span>
          <button
            :id="'parental-row-' + i"
            type="button"
            class="tv-focusable shrink-0 min-w-[10rem] phone-portrait:min-w-[7rem] rounded-lg px-4 py-2 text-tv-sm font-semibold border"
            :class="{
              'border-white/15 text-neutral-200': row.status === 'visible',
              'border-amber-400/60 text-amber-300 bg-amber-400/10': row.status === 'locked',
              'border-red-400/60 text-red-300 bg-red-400/10': row.status === 'hidden',
            }"
            :aria-label="`${row.category.category_name}: ${LABELS[row.status]}. Toque para mudar.`"
            @click="cycle(row)"
          >
            {{ LABELS[row.status] }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
