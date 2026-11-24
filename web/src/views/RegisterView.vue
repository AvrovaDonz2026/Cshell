<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
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

const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const verifyCode = ref('')
const captchaToken = ref('')
const captchaError = ref('')
const invitationCode = ref('')
const error = ref('')
const pending = ref(false)
const sendingCode = ref(false)
const codeSent = ref(false)
const captchaReset = ref(0)
const countdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | undefined
onBeforeUnmount(() => clearInterval(countdownTimer))
watch(email, () => { codeSent.value = false; verifyCode.value = '' })
const registrationCaptchaSatisfied = computed(() =>
  settings.emailVerifyRequired ? !!verifyCode.value : captchaSatisfied.value,
)

onMounted(() => {
  if (!settings.settingsReady && !settings.loading) void settings.loadPublic()
})

const captchaSatisfied = computed(() => !settings.captchaRequired || !!captchaToken.value)

const canSubmit = computed(
  () =>
    settings.settingsReady &&
    settings.registrationEnabled &&
    registrationCaptchaSatisfied.value &&
    (!settings.emailVerifyRequired || !!verifyCode.value) &&
    !!email.value &&
    !!password.value &&
    password.value === confirmPassword.value &&
    !pending.value,
)

async function reloadSettings(): Promise<void> {
  error.value = ''
  await settings.reload()
}

function onCaptchaToken(token: string): void {
  captchaToken.value = token
  if (token) captchaError.value = ''
}

async function sendCode(): Promise<void> {
  error.value = ''
  if (!email.value) {
    error.value = t('auth.emailRequired')
    return
  }
  if (sendingCode.value || countdown.value > 0 || !settings.settingsReady || !settings.registrationEnabled || !captchaSatisfied.value) return
  sendingCode.value = true
  try {
    const result = await auth.sendVerifyCode(email.value, captchaToken.value || undefined)
    countdown.value = Number.isFinite(result.countdown) ? Math.max(0, Math.ceil(result.countdown)) : 60
    clearInterval(countdownTimer)
    countdownTimer = setInterval(() => { countdown.value = Math.max(0, countdown.value - 1); if (!countdown.value) clearInterval(countdownTimer) }, 1000)
    codeSent.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('auth.sendCodeFailed')
  } finally {
    sendingCode.value = false
    captchaToken.value = ''
    captchaReset.value += 1
  }
}

async function onSubmit(): Promise<void> {
  error.value = ''
  if (!settings.settingsReady) {
    error.value = t('auth.settingsUnavailable')
    return
  }
  if (!settings.registrationEnabled) {
    error.value = t('auth.registrationDisabled')
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = t('auth.passwordMismatch')
    return
  }
  if (settings.captchaRequired && !settings.emailVerifyRequired && !captchaToken.value) {
    captchaError.value = t('auth.captchaToken')
    return
  }
  if (settings.emailVerifyRequired && !verifyCode.value) {
    error.value = t('auth.verifyCode')
    return
  }
  pending.value = true
  try {
    await auth.register({
      email: email.value,
      password: password.value,
      verify_code: settings.emailVerifyRequired ? verifyCode.value : undefined,
      turnstile_token: !settings.emailVerifyRequired && settings.captchaRequired ? captchaToken.value : undefined,
      invitation_code: invitationCode.value || undefined,
    })
    if (auth.isAdmin) {
      redirectAdminToUpstream()
      return
    }
    await router.replace({ name: 'dashboard' })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Registration failed'
  } finally {
    pending.value = false
    captchaToken.value = ''
    captchaReset.value += 1
  }
}
</script>

<template>
  <AuthSplit :title="t('auth.registerTitle')">
    <div class="auth-card">
      <h1 class="auth-card__title">{{ t('auth.registerTitle') }}</h1>
      <p class="auth-card__caption">{{ t('auth.registerCaption') }}</p>

      <template v-if="settings.settingsFailed">
        <p class="disabled-msg" role="alert">
          {{ t('auth.settingsUnavailable') }}
        </p>
        <Button
          type="button"
          variant="secondary"
          block
          :disabled="settings.loading"
          @click="reloadSettings"
        >
          {{ t('auth.retry') }}
        </Button>
      </template>

      <p
        v-else-if="!settings.settingsReady"
        class="disabled-msg"
        role="status"
      >
        {{ t('auth.settingsLoading') }}
      </p>

      <p
        v-else-if="!settings.registrationEnabled"
        class="disabled-msg"
        role="status"
      >
        {{ t('auth.registrationDisabled') }}
      </p>

      <form
        v-else
        class="auth-form"
        @submit.prevent="onSubmit"
      >
        <label>
          <span>{{ t('auth.email') }}</span>
          <Input v-model="email" class="auth-control" type="email" autocomplete="username" required />
        </label>
        <label>
          <span>{{ t('auth.password') }}</span>
          <Input
            v-model="password"
            class="auth-control"
            type="password"
            autocomplete="new-password"
            required
          />
        </label>
        <label>
          <span>{{ t('auth.confirmPassword') }}</span>
          <Input
            v-model="confirmPassword"
            class="auth-control"
            type="password"
            autocomplete="new-password"
            required
          />
        </label>

        <template v-if="settings.emailVerifyRequired">
          <label>
            <span>{{ t('auth.verifyCode') }}</span>
            <div class="row">
              <Input
                v-model="verifyCode"
                class="auth-control"
                autocomplete="one-time-code"
                required
              />
              <Button
                type="button"
                variant="secondary"
                :disabled="sendingCode || countdown > 0 || !email || !captchaSatisfied"
                @click="sendCode"
              >
                {{
                  countdown > 0
                    ? `${countdown}s`
                    : sendingCode
                      ? t('auth.sendingCode')
                      : codeSent
                        ? t('auth.resendCode')
                        : t('auth.sendCode')
                }}
              </Button>
            </div>
          </label>
        </template>

        <div
          v-if="settings.captchaRequired && settings.captchaProvider"
          class="captcha-block"
        >
          <span v-if="settings.captchaProvider !== 'unavailable'">
            {{ t('auth.captchaToken') }}
          </span>
          <CaptchaField
            :reset-key="captchaReset"
            :provider="settings.captchaProvider"
            :site-key="settings.settings?.turnstile_site_key || ''"
            :error="captchaError"
            @update:token="onCaptchaToken"
          />
        </div>

        <label>
          <span>{{ t('auth.invitationCode') }}</span>
          <Input v-model="invitationCode" class="auth-control" autocomplete="off" />
        </label>

        <p v-if="error" class="error" role="alert">
          {{ error }}
        </p>
        <Button class="auth-control" type="submit" block :disabled="!canSubmit">
          {{ pending ? t('auth.registering') : t('auth.submitRegister') }}
        </Button>
      </form>

      <RouterLink class="auth-link" :to="{ name: 'login' }">
        {{ t('auth.toLogin') }}
      </RouterLink>
      <RouterLink class="auth-link" :to="{ name: 'email-verify' }">
        {{ t('auth.toEmailVerify') }}
      </RouterLink>
    </div>
  </AuthSplit>
</template>

<style scoped>
.auth-card {
  display: grid;
  gap: var(--cshell-space-4);
}

.auth-card__title {
  margin: 0;
  font-size: var(--cshell-type-compact-title);
  letter-spacing: -0.01em;
}

.auth-card__caption {
  margin: -0.45rem 0 0.1rem;
  font-size: var(--cshell-type-caption);
  color: var(--cshell-text-muted);
}

.auth-form {
  display: grid;
  gap: var(--cshell-space-4);
}

.auth-card label {
  display: grid;
  gap: var(--cshell-space-2);
  font-size: var(--cshell-type-body);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cshell-space-2);
  align-items: stretch;
}

.captcha-block {
  display: grid;
  gap: var(--cshell-space-2);
  font-size: var(--cshell-type-body);
}

.row :deep(.cshell-input) {
  flex: 1 1 10rem;
  min-width: 0;
}

.row :deep(.cshell-btn) {
  min-height: 44px;
  flex: 0 1 auto;
}

.disabled-msg {
  margin: 0;
  color: var(--cshell-text-muted);
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
