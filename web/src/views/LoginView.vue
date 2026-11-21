<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Button from '@/components/primitives/Button.vue'
import Input from '@/components/primitives/Input.vue'
import { redirectAdminToUpstream } from '@/lib/adminRedirect'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const auth = useAuthStore()
const theme = useThemeStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const error = ref('')
const pending = ref(false)

async function onSubmit(): Promise<void> {
  error.value = ''
  pending.value = true
  try {
    await auth.login(email.value, password.value)
    if (auth.isAdmin) {
      redirectAdminToUpstream()
      return
    }
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    await router.replace(redirect)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Login failed'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="cshell-user-workspace auth-page" :data-theme="theme.mode">
    <form class="auth-card" @submit.prevent="onSubmit">
      <h1>{{ t('auth.loginTitle') }}</h1>
      <label>
        <span>{{ t('auth.email') }}</span>
        <Input v-model="email" type="email" autocomplete="username" required />
      </label>
      <label>
        <span>{{ t('auth.password') }}</span>
        <Input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="error" class="error" role="alert">
        {{ error }}
      </p>
      <Button type="submit" block :disabled="pending">
        {{ pending ? t('auth.loggingIn') : t('auth.submitLogin') }}
      </Button>
      <RouterLink class="auth-link" :to="{ name: 'register' }">
        {{ t('auth.toRegister') }}
      </RouterLink>
    </form>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: var(--cshell-bg);
  color: var(--cshell-text);
}

.auth-card {
  width: min(100%, 24rem);
  display: grid;
  gap: 0.85rem;
  padding: 1.5rem;
  border-radius: var(--cshell-radius-window);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-border);
  box-shadow: var(--cshell-shadow);
}

.auth-card h1 {
  margin: 0 0 0.25rem;
  font-size: 1.4rem;
}

.auth-card label {
  display: grid;
  gap: 0.35rem;
  font-size: 0.92rem;
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}

.auth-link {
  text-align: center;
  color: var(--cshell-accent);
  text-decoration: none;
}
</style>
