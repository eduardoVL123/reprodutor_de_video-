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
  {
    path: '/live',
    name: 'live',
    component: () => import('@/views/LiveTV.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/vod',
    name: 'vod',
    component: () => import('@/views/VOD.vue'),
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

router.beforeEach(async (to) => {
  if (ftueAccepted === null) {
    ftueAccepted = await hasAcceptedFtue()
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
  await auth.hydrate()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', replace: true }
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'dashboard', replace: true }
  }

  return true
})

export default router
