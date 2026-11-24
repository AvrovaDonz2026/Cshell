import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router'
import { redirectAdminToUpstream } from '@/lib/adminRedirect'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'

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
    meta: { requiresAuth: true, requiresSubscription: true },
  },
  {
    path: 'purchase',
    name: 'purchase',
    component: () => import('@/views/PurchaseView.vue'),
    meta: { requiresAuth: true, requiresBilling: true },
  },
  {
    path: 'orders',
    name: 'orders',
    component: () => import('@/views/OrdersView.vue'),
    meta: { requiresAuth: true, requiresBilling: true },
  },
]

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { public: true },
  },
  {
    // `/home` renders the same public page; a redirect keeps a single record
    // for the home view while still accepting the alternate URL.
    path: '/home',
    name: 'home-alias',
    redirect: { name: 'home' },
    meta: { public: true },
  },
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
    path: '/email-verify',
    name: 'email-verify',
    component: () => import('@/views/EmailVerifyView.vue'),
    meta: { guest: true },
  },
  {
    path: '/payment/result',
    name: 'payment-result',
    component: () => import('@/views/PaymentResultView.vue'),
    meta: { public: true },
  },
  {
    // Workspace shell. Its own path is internal only: absolute child paths keep
    // every user-facing workspace URL (`/dashboard`, `/usage`, …) unchanged,
    // while `/` and `/home` stay free for the public home page.
    path: '/workspace',
    component: () => import('@/layouts/AppShell.vue'),
    meta: { requiresAuth: true },
    children: workspaceChildren.map((child) => ({
      ...child,
      path: `/${child.path}`,
    })),
  },  {
    path: '/workspace',
    name: 'workspace',
    redirect: { name: 'dashboard' },
    meta: { requiresAuth: true },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'home' },
  },
]

async function ensureSettingsLoaded(): Promise<ReturnType<typeof useSettingsStore>> {
  const settings = useSettingsStore()
  if (!settings.settingsReady && !settings.loading) {
    await settings.loadPublic()
  } else if (settings.loading) {
    await new Promise<void>((resolve) => {
      const stop = setInterval(() => {
        if (!settings.loading) {
          clearInterval(stop)
          resolve()
        }
      }, 20)
    })
  }
  return settings
}

export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory('/'),
    routes,
  })

  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    if (!auth.hydrated) auth.hydrate()

    // Home is public, but signed-in users belong in the workspace.
    if (to.name === 'home') {
      if (auth.isAuthenticated && auth.isAdmin) {
        redirectAdminToUpstream()
        return false
      }
      if (auth.isAuthenticated) {
        return { name: 'dashboard' }
      }
      return true
    }

    if (to.meta.public) {
      return true
    }

    if (auth.isAuthenticated && auth.isAdmin) {
      redirectAdminToUpstream()
      return false
    }

    if (to.name === 'register') {
      const settings = await ensureSettingsLoaded()
      // Fail closed, but let the view render a retry when settings failed.
      if (settings.settingsReady && !settings.registrationEnabled) {
        return { name: 'login', query: { registration: 'disabled' } }
      }
    }

    if (to.meta.requiresAuth && !auth.isAuthenticated) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }

    if (to.meta.guest && auth.isAuthenticated) {
      return { name: 'dashboard' }
    }

    if (to.meta.requiresBilling || to.meta.requiresSubscription) {
      const settings = await ensureSettingsLoaded()
      if (to.meta.requiresSubscription && !settings.subscriptionEnabled) {
        return { name: 'dashboard' }
      }
      if (
        to.meta.requiresBilling &&
        !settings.paymentEnabled &&
        !settings.subscriptionEnabled
      ) {
        return { name: 'dashboard' }
      }
    }

    return true
  })

  return router
}

export const router = createAppRouter()
