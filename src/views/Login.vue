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

function onKeyDown(e) {
  if (e.key === 'Enter') {
    const el = document.activeElement
    if (el === dnsEl.value) {
      e.preventDefault()
      userEl.value?.focus()
    } else if (el === userEl.value) {
      e.preventDefault()
      passEl.value?.focus()
    }
  }
}

async function submit() {
  if (auth.loading) return
  if (!dns.value) {
    auth.error = 'Informe o Link Curto ou URL do Servidor.'
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
  dnsEl.value?.focus() // CT 3.1: foco inicial automático no campo DNS
})
onBeforeUnmount(() => auth.clearError())
</script>

<template>
  <section
    class="relative w-full h-full flex items-center justify-center overflow-hidden
           bg-[#0a0a0a]"
  >
    <div class="absolute -top-40 -right-40 w-[35rem] h-[35rem] rounded-full bg-[#e50914]/10 pointer-events-none"></div>

    <form
      class="relative w-[50rem] rounded-2xl border border-white/10 bg-[#121215]
             px-14 py-12 shadow-2xl"
      novalidate
      @submit.prevent="submit"
      @keydown="onKeyDown"
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
      </header>

      <div class="space-y-6">
        <label class="block">
          <span class="block mb-2 text-tv-sm text-tv-muted">Link Curto ou URL do Servidor</span>
          <input
            id="login-dns"
            ref="dnsEl"
            v-model="dns"
            type="text"
            inputmode="url"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
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
            placeholder="Sua senha"
            class="tv-input"
          />
        </label>
      </div>

      <p
        v-if="auth.error"
        id="login-error"
        class="mt-8 rounded-2xl border-2 border-red-500/60 bg-red-500/10 px-6 py-4 text-tv-sm text-red-300"
        role="alert"
      >
        {{ auth.error }}
      </p>

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
