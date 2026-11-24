<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchProfile, updatePassword, updateProfile } from '@/api/user'
import type { User } from '@/api/types'
import { ApiError } from '@/api/types'
import Button from '@/components/primitives/Button.vue'
import Input from '@/components/primitives/Input.vue'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const auth = useAuthStore()

const profile = ref<User | null>(null)
const username = ref('')
const oldPassword = ref('')
const newPassword = ref('')
const loading = ref(true)
const saving = ref(false)
const changingPassword = ref(false)
const error = ref('')
const message = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    profile.value = await fetchProfile()
    username.value = profile.value.username || ''
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    loading.value = false
  }
}

async function onSaveUsername(): Promise<void> {
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    profile.value = await updateProfile({ username: username.value.trim() })
    if (auth.user && profile.value.username != null) {
      auth.user.username = profile.value.username
    }
    message.value = t('profile.saved')
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    saving.value = false
  }
}

async function onChangePassword(): Promise<void> {
  changingPassword.value = true
  error.value = ''
  message.value = ''
  try {
    await updatePassword({
      old_password: oldPassword.value,
      new_password: newPassword.value,
    })
    oldPassword.value = ''
    newPassword.value = ''
    message.value = t('profile.passwordChanged')
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    changingPassword.value = false
  }
}

const facts = computed(() => {
  const current = profile.value
  if (!current) return []
  return [
    { label: t('profile.email'), value: current.email },
    { label: t('profile.role'), value: current.role },
    { label: t('profile.status'), value: current.status || '—' },
    { label: t('profile.balance'), value: current.balance ?? '—' },
    { label: t('profile.concurrency'), value: current.concurrency ?? '—' },
    { label: t('profile.createdAt'), value: current.created_at || '—' },
  ]
})

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page">
    <header class="page__head">
      <div class="page__head-text">
        <h1>{{ t('pages.profile') }}</h1>
        <p class="page__subtitle">{{ t('profile.subtitle') }}</p>
      </div>
    </header>

    <p v-if="loading" role="status" class="state">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="error" class="error" role="alert">
      {{ error }}
    </p>
    <p v-if="message" class="ok" role="status">
      {{ message }}
    </p>

    <div v-if="profile" class="layout">
      <div class="forms">
        <form class="panel" @submit.prevent="onSaveUsername">
          <div class="panel__head">
            <h2 class="panel__title">{{ t('profile.updateUsername') }}</h2>
            <p class="panel__caption">{{ t('profile.updateUsernameCaption') }}</p>
          </div>
          <label class="field">
            <span class="field__label">{{ t('profile.username') }}</span>
            <Input v-model="username" autocomplete="username" required />
          </label>
          <div class="panel__actions">
            <Button type="submit" :disabled="saving">
              {{ t('common.save') }}
            </Button>
          </div>
        </form>

        <form class="panel" @submit.prevent="onChangePassword">
          <div class="panel__head">
            <h2 class="panel__title">{{ t('profile.changePassword') }}</h2>
            <p class="panel__caption">{{ t('profile.changePasswordCaption') }}</p>
          </div>
          <label class="field">
            <span class="field__label">{{ t('profile.oldPassword') }}</span>
            <Input
              v-model="oldPassword"
              type="password"
              autocomplete="current-password"
              required
            />
          </label>
          <label class="field">
            <span class="field__label">{{ t('profile.newPassword') }}</span>
            <Input
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              required
            />
          </label>
          <div class="panel__actions">
            <Button type="submit" :disabled="changingPassword">
              {{ t('common.save') }}
            </Button>
          </div>
        </form>
      </div>

      <aside class="rail" :aria-labelledby="'profile-facts-title'">
        <h2 id="profile-facts-title" class="panel__title">
          {{ t('profile.detailsTitle') }}
        </h2>
        <dl class="facts">
          <div v-for="fact in facts" :key="fact.label" class="fact">
            <dt class="fact__label">{{ fact.label }}</dt>
            <dd class="fact__value">{{ fact.value }}</dd>
          </div>
        </dl>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1.4rem;
  min-width: 0;
}

.page__head-text {
  display: grid;
  gap: 0.3rem;
}

.page h1 {
  margin: 0;
  font-size: 1.7rem;
  letter-spacing: -0.01em;
}

.page__subtitle {
  margin: 0;
  font-size: 0.94rem;
  color: var(--cshell-text-muted);
}

.layout {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.forms {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.panel {
  display: grid;
  gap: 0.85rem;
  padding: 1.25rem;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  min-width: 0;
}

.panel__head {
  display: grid;
  gap: 0.15rem;
}

.panel__title {
  margin: 0;
  font-size: 1.02rem;
}

.panel__caption {
  margin: 0;
  font-size: 0.82rem;
  color: var(--cshell-text-muted);
}

.panel__actions {
  display: flex;
  justify-content: flex-end;
}

.field {
  display: grid;
  gap: 0.3rem;
}

.field__label {
  font-size: 0.8rem;
  color: var(--cshell-text-muted);
}

.rail {
  display: grid;
  gap: 0.85rem;
  padding: 1.25rem;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-bg-elevated);
  align-content: start;
  min-width: 0;
}

.facts {
  display: grid;
  gap: 0.7rem;
  margin: 0;
}

.fact {
  display: grid;
  gap: 0.1rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--cshell-border);
}

.fact:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.fact__label {
  font-size: 0.75rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--cshell-text-muted);
}

.fact__value {
  margin: 0;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.state {
  margin: 0;
  color: var(--cshell-text-muted);
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}

.ok {
  margin: 0;
  color: var(--cshell-accent);
}

@media (min-width: 1024px) {
  .layout {
    grid-template-columns: minmax(0, 1fr) 20rem;
    align-items: start;
  }

  .rail {
    position: sticky;
    top: 5rem;
  }
}
</style>
