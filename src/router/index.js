import { createRouter, createWebHashHistory } from 'vue-router'
import { hasAcceptedFtue } from '@/services/storage'
import { useAuthStore } from '@/stores/authStore'

/**
 * Hash history: obrigatório em apps empacotados para Tizen/webOS, pois o app
 * roda via file:// e não há servidor para reescrever rotas.
 */
const routes = [
  { path: '/', redirect: '/login' }, // o guard decide entre /ftue e /login
  {
    path: '/ftue',
    name: 'ftue',
    component: () => import('@/views/FTUE.vue'),
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/Dashboard.vue'),
    meta: { requiresAuth: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/login' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// Cache em memória: lê o IndexedDB uma única vez por sessão.
let ftueAccepted = null

/** Chamado pelo FTUE.vue após persistir o aceite. */
export function markFtueAccepted() {
  ftueAccepted = true
}

// Armazenamento (IndexedDB) que não responde em WebView antigo deixava a abertura em tela vazia para sempre: os Fire TV
// com Fire OS 6 foram reprovados na Amazon por não mostrar nada em 1 minuto. Passado o prazo, abre a tela mesmo assim.
const STORAGE_WAIT_MS = 5000
const orAfterWait = (promise, fallback) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), STORAGE_WAIT_MS))])

router.beforeEach(async (to) => {
  if (ftueAccepted === null) {
    // Sem resposta, mostra o aviso legal (a opção segura); o próximo boot lê de novo.
    ftueAccepted = await orAfterWait(hasAcceptedFtue(), false)
  }

  // CT 1.1 — sem aceite, nenhuma rota além de /ftue é acessível.
  if (!ftueAccepted && to.name !== 'ftue') {
    return { name: 'ftue', replace: true }
  }

  // CT 1.2 — com aceite, o FTUE nunca mais é exibido.
  if (ftueAccepted && to.name === 'ftue') {
    return { name: 'login', replace: true }
  }

  // Fase 2 — sessão persistida: rotas protegidas exigem login válido.
  const auth = useAuthStore()
  await orAfterWait(auth.hydrate()) // sessão que não chega a tempo: segue para o login

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', replace: true }
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'dashboard', replace: true }
  }

  return true
})

const RELOAD_FLAG = 'pulse:route-reload'

/**
 * Tela que não carrega (arquivo da versão anterior após atualizar, rede caiu, erro no guard):
 * recarrega o app uma vez em vez de deixar a tela em branco. Sem sessionStorage não recarrega, para não entrar em laço.
 */
export function recoverFromRouteError(err, reload = () => window.location.reload()) {
  console.error('[router] Falha ao abrir a tela:', err)
  let alreadyReloaded = true
  try {
    alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1'
    if (!alreadyReloaded) sessionStorage.setItem(RELOAD_FLAG, '1')
  } catch (_) {
    alreadyReloaded = true
  }
  if (!alreadyReloaded) reload()
}

router.onError((err) => recoverFromRouteError(err))
router.afterEach(() => {
  try {
    sessionStorage.removeItem(RELOAD_FLAG) // navegou bem: libera uma nova tentativa no futuro
  } catch (_) {
    /* sem sessionStorage: nada a limpar */
  }
})

export default router
