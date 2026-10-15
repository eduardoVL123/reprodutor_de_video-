<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const auth = useAuthStore()

const dns = ref('')
const username = ref('')
const password = ref('')

const dnsEl = ref(null)
const userEl = ref(null)
const passEl = ref(null)
const submitEl = ref(null)

async function submit() {
  if (auth.loading) return
  if (!dns.value) {
    auth.error = 'Informe o Link Curto ou URL do Servidor.'
    auth.errorDetail = 'Campo DNS vazio.'
    dnsEl.value?.focus()
    return
  }
  const ok = await auth.login({
    dns: dns.value,
    username: username.value,
    password: password.value,
  })
  if (ok) {
    await router.replace({ name: 'dashboard' })
  } else {
    if (auth.error === 'Este link exige Usuário e Senha. Preencha os campos abaixo.') {
      userEl.value?.focus()
    } else {
      submitEl.value?.focus()
    }
  }
}

onMounted(() => {
  auth.clearError()
  dnsEl.value?.focus() // foco inicial automático no campo DNS
})
onBeforeUnmount(() => auth.clearError())
</script>

<template>
  <section
    class="relative w-full h-full flex justify-center overflow-y-auto bg-[#0a0a0a] p-8"
  >
    <div class="absolute -top-40 -right-40 w-[35rem] h-[35rem] rounded-full bg-[#e50914]/10 pointer-events-none"></div>

    <form
      class="relative w-[50rem] rounded-2xl border border-white/10 bg-[#121215]
             px-14 py-12 pb-[20rem] shadow-2xl my-auto"
      novalidate
      @submit.prevent="submit"
    >
      <header class="mb-8">
        <div class="flex items-center gap-2 mb-3">
          <span class="w-2 h-2 rounded-full bg-[#e50914]"></span>
          <p class="text-tv-xs uppercase tracking-[0.25em] text-[#e50914] font-bold">NEUTRO TV · CONEXÃO</p>
        </div>
        <h1 class="text-tv-xl font-black text-white tracking-tight">Conectar ao servidor</h1>
        <p class="mt-2 text-tv-sm text-neutral-400">
          Informe seu link encurtado, URL Xtream Codes ou playlist M3U.
        </p>
        <p class="mt-2 text-tv-xs text-neutral-500 flex items-center gap-2">
          <svg class="w-4 h-4 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <line x1="6" y1="8" x2="6.01" y2="8" />
            <line x1="10" y1="8" x2="10.01" y2="8" />
            <line x1="14" y1="8" x2="14.01" y2="8" />
            <line x1="18" y1="8" x2="18.01" y2="8" />
          </svg>
          <span>Navegue com as setas e pressione OK para abrir o teclado</span>
        </p>
      </header>

      <div class="space-y-6">
        <label class="block">
          <span class="block mb-2 text-tv-sm text-tv-muted">Link Curto ou URL do Servidor</span>
          <input
            id="login-dns"
            ref="dnsEl"
            v-model="dns"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            readonly="readonly"
            data-tv-editing="false"
            placeholder="Ex: n.tv/vip ou servidor.com:8080"
            class="tv-input"
          />
        </label>

        <label class="block">
          <span class="block mb-2 text-tv-sm text-tv-muted">Usuário (opcional para link curto)</span>
          <input
            id="login-username"
            ref="userEl"
            v-model="username"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            readonly="readonly"
            data-tv-editing="false"
            placeholder="Seu usuário"
            class="tv-input"
          />
        </label>

        <label class="block">
          <span class="block mb-2 text-tv-sm text-tv-muted">Senha (opcional para link curto)</span>
          <input
            id="login-password"
            ref="passEl"
            v-model="password"
            type="password"
            autocomplete="off"
            readonly="readonly"
            data-tv-editing="false"
            placeholder="Sua senha"
            class="tv-input"
          />
        </label>
      </div>

      <div
        v-if="auth.error"
        id="login-error"
        class="mt-8 rounded-2xl border-2 border-red-500/60 bg-red-500/10 px-6 py-4 text-tv-sm text-red-300"
        role="alert"
      >
        <p class="font-semibold">{{ auth.error }}</p>
        <p
          v-if="auth.errorDetail"
          class="font-mono text-tv-xs text-red-300/90 bg-black/50 border border-red-500/20 rounded p-2.5 mt-2.5 break-all"
        >
          Causa técnica: {{ auth.errorDetail }}
        </p>
      </div>

      <button
        id="login-submit"
        ref="submitEl"
        type="submit"
        class="tv-btn tv-btn-primary w-full mt-10"
        :aria-busy="auth.loading"
      >
        <svg
          v-if="auth.loading"
          class="w-8 h-8 mr-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
        {{ auth.loading ? 'Conectando...' : 'Entrar' }}
      </button>
    </form>
  </section>
</template>
