<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { acceptFtue } from '@/services/storage'
import { exitApp } from '@/services/platform'
import { markFtueAccepted } from '@/router'
import { isPairingConfigured } from '@/services/pairingApi'
import { isLicenseEnabled } from '@/services/licenseApi'

// Texto jurídico OBRIGATÓRIO (literal exigido pelas lojas Samsung/LG).
const LEGAL_NOTICE =
  'Este é um reprodutor de mídia genérico. Nenhum conteúdo é fornecido, endossado ou vendido neste aplicativo. O usuário é o único responsável pelos links inseridos.'

// A promessa de privacidade tem que ser verdadeira para o build: só cita o pareamento (RFC-016) se ele existir nele.
const CAST_TEXT =
  'No celular, se você transmitir para uma TV (Chromecast), o endereço do vídeo, com usuário e senha, vai para a TV escolhida na sua rede, que busca o vídeo direto no servidor.'
const PRIVACY_TEXT =
  'Não coletamos nem enviamos seus dados. Endereços, usuário e senha ficam só neste aparelho (a senha é cifrada) e são usados apenas para falar com o servidor que você informou. Capas e logotipos vêm dos endereços da sua lista. ' + CAST_TEXT
const PRIVACY_TEXT_WITH_PAIRING =
  'Não coletamos seus dados. Endereços, usuário e senha ficam só neste aparelho (a senha é cifrada) e são usados apenas para falar com o servidor que você informou. Se você adicionar a lista pelo celular, ela passa cifrada, por alguns minutos, pelo serviço de pareamento do desenvolvedor, que não consegue ler esse conteúdo e o apaga em seguida. Capas e logotipos vêm dos endereços da sua lista. ' + CAST_TEXT

// RFC-018: com o serviço de licença no build, "não coletamos" deixa de ser verdade; o texto diz o que vai e o que não vai.
const LICENSE_TEXT =
  'O app tem um teste grátis de 7 dias. Para controlar o teste e a ativação, ele envia ao serviço de licença do desenvolvedor um código do aparelho (cifrado) e o domínio da lista em uso, com as datas de uso; nunca usuário, senha ou o endereço completo. Usuário e senha ficam só neste aparelho (a senha é cifrada) e são usados apenas para falar com o servidor que você informou. Capas e logotipos vêm dos endereços da sua lista. '

function privacyText() {
  if (isLicenseEnabled()) {
    const pairing = isPairingConfigured()
      ? 'Se você adicionar a lista pelo celular, ela passa cifrada, por alguns minutos, pelo serviço de pareamento do desenvolvedor, que não consegue ler esse conteúdo e o apaga em seguida. '
      : ''
    return LICENSE_TEXT + pairing + CAST_TEXT
  }
  return isPairingConfigured() ? PRIVACY_TEXT_WITH_PAIRING : PRIVACY_TEXT
}

const terms = [
  {
    title: 'Ferramenta neutra',
    text: 'Este aplicativo é apenas um reprodutor. Ele não contém, hospeda, distribui nem recomenda qualquer canal, filme, série ou lista.',
  },
  {
    title: 'Responsabilidade do usuário',
    text: 'Você é o único responsável pelos endereços, credenciais e conteúdos que inserir e reproduzir, incluindo a legalidade e os direitos de uso.',
  },
  {
    title: 'Sem vínculo com provedores',
    text: 'Não temos relação com provedores de conteúdo de terceiros e não oferecemos suporte a nenhum serviço de transmissão.',
  },
  {
    title: 'Privacidade',
    text: privacyText(),
  },
]

const router = useRouter()
const acceptBtn = ref(null)
const declineBtn = ref(null)
const saving = ref(false)
const errorMsg = ref('')
const declined = ref(false)

async function accept() {
  if (saving.value) return
  saving.value = true
  errorMsg.value = ''
  try {
    await acceptFtue()
    markFtueAccepted()
    await router.replace({ name: 'login' })
  } catch (err) {
    console.error('[FTUE] Não foi possível salvar o aceite:', err)
    errorMsg.value = 'Não foi possível salvar sua escolha. Tente novamente.'
    saving.value = false
  }
}

function decline() {
  declined.value = true
  // Sem aceite o app não pode ser usado: encerra pela API da plataforma (em navegador comum só mantém o bloqueio).
  exitApp()
}

// Bloqueia voltar no FTUE (obrigatório)
function onKeyDown(e) {
  switch (e.key) {
    case 'Escape':
    case 'Backspace':
    case 'XF86Back':
      // O modal é obrigatório: "Voltar" não pode contorná-lo.
      e.preventDefault()
      break
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  acceptBtn.value?.focus({ preventScroll: true }) // foco no botão principal sem rolar: a leitura começa pelo título
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <!-- Rola quando não cabe (celular deitado): com items-center + overflow-hidden o topo ficava fora de alcance. -->
  <section
    class="relative w-full h-full flex justify-center overflow-y-auto
           bg-tv-deep"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ftue-title"
      aria-describedby="ftue-notice"
      class="relative w-[96rem] max-w-full my-auto rounded-2xl border border-white/10
             bg-[#121215] px-16 py-12 shadow-2xl"
    >
      <header class="flex items-center gap-8 mb-8">
        <div
          class="flex items-center justify-center w-20 h-20 rounded-2xl
                 bg-white/[0.08] border border-white/10 text-tv-accent"
        >
          <svg viewBox="0 0 24 24" class="w-14 h-14 text-white" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <div>
          <p class="text-tv-sm uppercase tracking-[0.3em] text-tv-accent-soft">Primeiro acesso</p>
          <h1 id="ftue-title" class="text-tv-xl font-bold">Termos de Uso e Aviso Legal</h1>
        </div>
      </header>

      <!-- Aviso legal em destaque (texto literal obrigatório) -->
      <p
        id="ftue-notice"
        class="rounded-2xl border-l-8 border-tv-accent bg-tv-card px-8 py-6 text-tv-lg font-medium leading-snug"
      >
        {{ LEGAL_NOTICE }}
      </p>

      <ul class="mt-8 grid grid-cols-2 gap-6">
        <li
          v-for="item in terms"
          :key="item.title"
          class="rounded-2xl border-2 border-tv-border bg-tv-bg/60 px-6 py-5"
        >
          <h2 class="text-tv-base font-semibold text-tv-accent-soft mb-2">{{ item.title }}</h2>
          <p class="text-tv-sm text-tv-muted">{{ item.text }}</p>
        </li>
      </ul>

      <p v-if="errorMsg" class="mt-6 text-tv-base text-red-400" role="alert">{{ errorMsg }}</p>
      <p v-if="declined" class="mt-6 text-tv-base text-amber-300" role="alert">
        É necessário aceitar os termos para usar o aplicativo. Você pode fechá-lo pelo botão de saída do controle.
      </p>

      <footer class="mt-10 flex items-center justify-end gap-6">
        <button
          id="ftue-decline"
          ref="declineBtn"
          type="button"
          class="tv-btn"
          @click="decline"
        >
          Recusar e sair
        </button>
        <button
          id="ftue-accept"
          ref="acceptBtn"
          type="button"
          class="tv-btn tv-btn-primary"
          :disabled="saving"
          @click="accept"
        >
          Aceitar
        </button>
      </footer>
    </div>
  </section>
</template>
