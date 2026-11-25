<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AuthSplit from '@/components/AuthSplit.vue'
import Button from '@/components/primitives/Button.vue'
import CaptchaField from '@/components/primitives/CaptchaField.vue'
import Input from '@/components/primitives/Input.vue'
import { redirectAdminToUpstream } from '@/lib/adminRedirect'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const auth = useAuthStore()
const settings = useSettingsStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const passwordVisible = ref(false)
const error = ref('')
const pending = ref(false)
const captchaToken = ref('')
const captchaReset = ref(0)

const registrationDisabledNotice = computed(
  () => route.query.registration === 'disabled',
)

// Login does not depend on public settings, but the register link does.
const showRegisterLink = computed(
  () => settings.settingsReady && settings.registrationEnabled,
)

onMounted(() => {
  if (!settings.settingsReady && !settings.loading) void settings.loadPublic()
})

async function reloadSettings(): Promise<void> {
  await settings.reload()
}

async function onSubmit(): Promise<void> {
  error.value = ''
  if (!settings.settingsReady || (settings.captchaRequired && !captchaToken.value) || pending.value) return
  pending.value = true
  try {
    await auth.login(email.value, password.value, captchaToken.value || undefined)
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
    captchaToken.value = ''
    captchaReset.value += 1
  }
}
</script>

<template>
  <AuthSplit>
    <form class="auth-form" @submit.prevent="onSubmit">
      <h1 class="auth-form__title">{{ t('auth.loginTitle') }}</h1>
      <p class="auth-form__caption">{{ t('auth.loginCaption') }}</p>

      <p
        v-if="registrationDisabledNotice"
        class="notice"
        role="status"
      >
        {{ t('auth.registrationDisabled') }}
      </p>
      <p
        v-if="settings.settingsFailed"
        class="notice"
        role="alert"
      >
        {{ t('auth.settingsUnavailable') }}
        <button type="button" class="inline-retry" @click="reloadSettings">
          {{ t('auth.retry') }}
        </button>
      </p>
      <label>
        <span>{{ t('auth.email') }}</span>
        <Input v-model="email" class="auth-control" type="email" autocomplete="username" required />
      </label>
      <label>
        <span>{{ t('auth.password') }}</span>
        <div class="password-field">
          <Input v-model="password" class="auth-control" :type="passwordVisible ? 'text' : 'password'" autocomplete="current-password" required />
          <button type="button" class="password-toggle" :aria-label="t(passwordVisible ? 'auth.hidePassword' : 'auth.showPassword')" :aria-pressed="passwordVisible" @click="passwordVisible = !passwordVisible">{{ t(passwordVisible ? 'auth.hidePassword' : 'auth.showPassword') }}</button>
        </div>
      </label>
      <CaptchaField
        v-if="settings.captchaRequired && settings.captchaProvider"
        :provider="settings.captchaProvider" :site-key="settings.settings?.turnstile_site_key || ''"
        :reset-key="captchaReset" @update:token="captchaToken = $event"
      />
      <p v-if="error" class="error" role="alert">
        {{ error }}
      </p>
      <Button class="auth-control" type="submit" block :disabled="pending || !settings.settingsReady || (settings.captchaRequired && !captchaToken)">
        {{ pending ? t('auth.loggingIn') : t('auth.submitLogin') }}
      </Button>
      <RouterLink
        v-if="showRegisterLink"
        class="auth-link"
        :to="{ name: 'register' }"
      >
        {{ t('auth.toRegister') }}
      </RouterLink>
    </form>
  </AuthSplit>
</template>

<style scoped>
.auth-form {
  display: grid;
  gap: var(--cshell-space-4);
}

.auth-form__title {
  margin: 0;
  font-size: var(--cshell-type-compact-title);
  letter-spacing: -0.01em;
}

.auth-form__caption {
  margin: -0.45rem 0 0.1rem;
  font-size: var(--cshell-type-caption);
  color: var(--cshell-text-muted);
}

.password-field { position: relative; }
.password-field :deep(input) { padding-right: 5.5rem; }
.password-toggle { position: absolute; inset-block: 0; right: 0.25rem; min-width: 44px; padding-inline: 0.5rem; border: 0; background: transparent; color: var(--cshell-accent); cursor: pointer; }
.auth-form label {
  display: grid;
  gap: var(--cshell-space-2);
  font-size: var(--cshell-type-body);
}

.notice {
  margin: 0;
  color: var(--cshell-text-muted);
  font-size: var(--cshell-type-body);
}

.inline-retry {
  padding: 0;
  border: 0;
  background: none;
  color: var(--cshell-accent);
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}

.auth-link {
  text-align: center;
  color: var(--cshell-accent);
  text-decoration: none;
  min-height: 2.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
