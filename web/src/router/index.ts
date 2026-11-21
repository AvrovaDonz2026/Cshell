import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router'
import { redirectAdminToUpstream } from '@/lib/adminRedirect'
import { useAuthStore } from '@/stores/auth'

const workspaceChildren: RouteRecordRaw[] = [
  {
    path: 'dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: 'usage',
    name: 'usage',
    component: () => import('@/views/UsageView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: 'keys',
    name: 'keys',
    component: () => import('@/views/KeysView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: 'profile',
    name: 'profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: 'subscriptions',
    name: 'subscriptions',
    component: () => import('@/views/SubscriptionsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: 'purchase',
    name: 'purchase',
    component: () => import('@/views/PurchaseView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: 'orders',
    name: 'orders',
    component: () => import('@/views/OrdersView.vue'),
    meta: { requiresAuth: true },
  },
]

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { guest: true },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { guest: true },
  },
  {
    path: '/',
    component: () => import('@/layouts/AppShell.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      ...workspaceChildren,
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'dashboard' },
  },
]

export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
  })

  router.beforeEach((to) => {
    const auth = useAuthStore()
    if (!auth.hydrated) auth.hydrate()

    if (auth.isAuthenticated && auth.isAdmin) {
      redirectAdminToUpstream()
      return false
    }

    if (to.meta.requiresAuth && !auth.isAuthenticated) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }

    if (to.meta.guest && auth.isAuthenticated) {
      return { name: 'dashboard' }
    }

    return true
  })

  return router
}

export const router = createAppRouter()
