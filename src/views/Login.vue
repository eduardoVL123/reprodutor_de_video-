<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import BrandMark from '@/components/BrandMark.vue'
import { URL_SNIPPETS, applySnippet } from '@/utils/urlSnippets'

const router = useRouter()
const auth = useAuthStore()

const dns = ref('')
const username = ref('')
const password = ref('')

const dnsEl = ref(null)
const userEl = ref(null)
const passEl = ref(null)
const submitEl = ref(null)

/** Lista de demonstração para os revisores das lojas (docs/demo); sem a variável, o botão não aparece. */
const demoPlaylistUrl = import.meta.env.VITE_DEMO_PLAYLIST_URL || ''

function addSnippet(snippet) {
  dns.value = applySnippet(dns.value, snippet)
}

function tryDemo() {
  dns.value = demoPlaylistUrl
  username.value = ''
  password.value = ''
  return submit()
}

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
    class="relative w-full h-full flex justify-center overflow-y-auto bg-tv-deep p-8"
  >
    <div class="absolute -top-40 -right-40 w-[35rem] h-[35rem] rounded-full bg-tv-accent/10 pointer-events-none"></div>

    <form
      class="relative w-[50rem] rounded-2xl border border-white/10 bg-[#121215]
             px-14 py-12 pb-[20rem] shadow-2xl my-auto"
      novalidate
      @submit.prevent="submit"
    >
      <header class="mb-8">
        <div class="flex items-center gap-2 mb-3">
          <BrandMark :size="1.5" class="text-tv-accent" />
          <p class="text-tv-xs uppercase tracking-[0.25em] text-tv-accent font-bold">PULSE PLAYER · CONEXÃO</p>
        </div>
        <h1 class="text-tv-xl font-black text-white tracking-tight">Conectar ao servidor</h1>
        <p class="mt-2 text-tv-sm text-neutral-400">
          Informe o endereço do seu servidor ou a URL de uma playlist M3U.
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
            autocorrect="off"
            spellcheck="false"
            readonly="readonly"
            data-tv-editing="false"
            placeholder="Ex: servidor.com:8080"
            class="tv-input"
          />
        </label>
        <!-- Atalhos: os pedaços mais comuns de um link com um OK, em vez de letra por letra no controle -->
        <div data-focus-row="login-snippets" class="flex flex-wrap gap-2 -mt-3">
          <button
            v-for="(snippet, index) in URL_SNIPPETS"
            :id="`login-snippet-${index}`"
            :key="snippet"
            type="button"
            class="tv-btn !px-4 !py-1.5 font-mono text-tv-xs"
            @click="addSnippet(snippet)"
          >
            {{ snippet }}
          </button>
        </div>
        <p class="text-tv-xs text-neutral-500">
          Dica: no app de controle remoto da sua TV no celular, dá para digitar com o teclado do celular.
        </p>

        <label class="block">
          <span class="block mb-2 text-tv-sm text-tv-muted">Usuário (opcional para link curto)</span>
          <input
            id="login-username"
            ref="userEl"
            v-model="username"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
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
            type="text"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
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

      <button
        v-if="demoPlaylistUrl"
        id="login-demo"
        type="button"
        class="tv-btn w-full mt-4"
        @click="tryDemo"
      >
        Experimentar com vídeos de demonstração
      </button>
    </form>
  </section>
</template>
