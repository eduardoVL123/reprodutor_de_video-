<script setup>
import { computed } from 'vue'
import { PROFILE_COLORS, avatarTextColor } from '@/stores/profileStore'
import { useLicenseStore } from '@/stores/licenseStore'
import { isLicenseEnabled, isStoreBuild, plansPageUrl, privacyPageUrl, sendListPageUrl } from '@/services/licenseApi'
import { canExitApp, exitApp, openExternal } from '@/services/platform'

/**
 * Aba Conta do celular/tablet: tudo do usuário num lugar só (perfil, assinatura, lista, Favoritos, sair).
 * Substitui a folha "Mais". Na versão das lojas não há link de renovar (o app não pode levar a pagamento).
 */
const props = defineProps({
  profile: { type: Object, default: () => ({ name: 'Perfil', color: PROFILE_COLORS[0] }) },
  listLabel: { type: String, default: '' },
})

const emit = defineEmits(['navigate', 'manage-lists', 'switch-profile', 'diagnostics'])

const license = useLicenseStore()
const licensed = isLicenseEnabled()
const showExit = canExitApp()
const profileColor = computed(() => props.profile.color || PROFILE_COLORS[0])
const siteUrl = computed(() => sendListPageUrl(license.code))
const privacyUrl = privacyPageUrl()
const renewUrl = computed(() => (licensed && !isStoreBuild() && license.code ? plansPageUrl(license.code) : ''))

const fmtDate = (ms) => new Date(ms).toLocaleDateString('pt-BR')
const status = computed(() => {
  switch (license.access) {
    case 'trial':
      return { text: 'Teste grátis', detail: license.trialEndsAt ? `até ${fmtDate(license.trialEndsAt)}` : '', ok: true }
    case 'activated':
      return { text: 'Ativado', detail: license.activationEndsAt ? `até ${fmtDate(license.activationEndsAt)}` : 'sem data de fim', ok: true }
    case 'partner':
      return { text: 'Liberado', detail: '', ok: true }
    case 'blocked':
    case 'suspended':
      return { text: 'Bloqueado', detail: 'ative o aparelho para voltar a assistir', ok: false }
    default:
      return { text: 'Ainda não verificado', detail: 'abra uma lista com internet', ok: false }
  }
})
</script>

<template>
  <div class="h-full overflow-y-auto" data-focus-group="account">
    <div class="max-w-xl mx-auto px-4 pt-6 pb-10">
      <h1 class="text-[1.6rem] font-extrabold tracking-tight mb-5">Conta</h1>

      <!-- Perfil -->
      <section class="acc-card flex items-center px-4 py-4">
        <span
          class="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black shrink-0 mr-3.5"
          :style="{ backgroundColor: profileColor, color: avatarTextColor(profileColor) }"
        >{{ (profile.name || 'P').charAt(0).toUpperCase() }}</span>
        <div class="min-w-0 flex-1">
          <div class="text-[0.78rem] text-neutral-400">Perfil</div>
          <div class="font-extrabold text-[1.1rem] truncate">{{ profile.name }}</div>
        </div>
        <button id="acc-profile" type="button" class="tv-focusable tv-btn !px-4 !py-2 text-[0.9rem]" @click="emit('switch-profile')">
          Trocar
        </button>
      </section>

      <!-- Assinatura -->
      <template v-if="licensed">
        <h2 class="acc-title">Assinatura</h2>
        <section class="acc-card px-4 py-4">
          <div class="flex items-center">
            <span class="w-2.5 h-2.5 rounded-full mr-2.5 shrink-0" :class="status.ok ? 'bg-tv-accent' : 'bg-[#ff5a4e]'" />
            <span class="font-bold text-[1.05rem]">{{ status.text }}</span>
            <span v-if="status.detail" class="ml-2 text-[0.9rem] text-neutral-400">{{ status.detail }}</span>
          </div>
          <div v-if="license.code" class="mt-3 flex items-center justify-between">
            <span class="text-[0.85rem] text-neutral-400">Código do aparelho</span>
            <span id="acc-code" class="font-mono font-bold tracking-[0.2em] text-[1.05rem]">{{ license.code }}</span>
          </div>
          <button
            v-if="renewUrl"
            id="acc-renew"
            type="button"
            class="tv-focusable tv-btn tv-btn-primary w-full mt-4 !py-2.5 text-[0.95rem]"
            @click="openExternal(renewUrl)"
          >
            Renovar ou ver planos
          </button>
        </section>
      </template>

      <!-- Lista -->
      <h2 class="acc-title">Conteúdo</h2>
      <section class="acc-card">
        <button id="acc-favorites" type="button" class="acc-row tv-focusable" @click="emit('navigate', 'favorites')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z" /></svg>
          <span>Favoritos</span>
        </button>
        <div class="acc-divider" />
        <button id="acc-lists" type="button" class="acc-row tv-focusable" @click="emit('manage-lists')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
          <span>Minhas listas</span>
          <span v-if="listLabel" class="acc-hint truncate max-w-[45%]">{{ listLabel }}</span>
        </button>
        <template v-if="siteUrl">
          <div class="acc-divider" />
          <button id="acc-site" type="button" class="acc-row tv-focusable" @click="openExternal(siteUrl)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></svg>
            <span>Enviar lista pelo site</span>
          </button>
        </template>
      </section>

      <section class="acc-card mt-6">
        <button id="acc-diagnostics" type="button" class="acc-row tv-focusable" @click="emit('diagnostics')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.01" /></svg>
          <span>Diagnóstico</span>
        </button>
      </section>

      <section v-if="privacyUrl" class="acc-card mt-6">
        <button id="acc-privacy" type="button" class="acc-row tv-focusable" @click="openExternal(privacyUrl)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /></svg>
          <span>Política de privacidade</span>
        </button>
      </section>

      <section v-if="showExit" class="acc-card mt-6">
        <button id="acc-exit" type="button" class="acc-row tv-focusable text-[#ff5a4e]" @click="exitApp">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="!stroke-[#ff5a4e]"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" /></svg>
          <span>Sair do app</span>
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.acc-card {
  border-radius: 1rem;
  background: #141a15;
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.acc-title {
  margin: 1.5rem 0 0.6rem 0.25rem;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9ba49c;
}
.acc-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 3.6rem;
  padding: 0 1rem;
  font-size: 1rem;
  font-weight: 600;
  text-align: left;
}
.acc-row svg {
  width: 1.4rem;
  height: 1.4rem;
  margin-right: 0.9rem;
  flex-shrink: 0;
  fill: none;
  stroke: #9ba49c;
  stroke-width: 1.9;
}
.acc-hint {
  margin-left: auto;
  padding-left: 0.75rem;
  font-size: 0.82rem;
  font-weight: 500;
  color: #9ba49c;
}
.acc-divider {
  height: 1px;
  margin: 0 1rem;
  background: rgba(255, 255, 255, 0.07);
}
</style>
