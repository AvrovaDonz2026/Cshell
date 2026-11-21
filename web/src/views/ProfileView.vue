<script setup lang="ts">
import { onMounted, ref } from 'vue'
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

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page">
    <h1>{{ t('pages.profile') }}</h1>

    <p v-if="loading" role="status">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="error" class="error" role="alert">
      {{ error }}
    </p>
    <p v-if="message" class="ok" role="status">
      {{ message }}
    </p>

    <template v-if="profile">
      <section class="panel">
        <dl class="facts">
          <div>
            <dt>{{ t('profile.email') }}</dt>
            <dd>{{ profile.email }}</dd>
          </div>
          <div>
            <dt>{{ t('profile.role') }}</dt>
            <dd>{{ profile.role }}</dd>
          </div>
          <div>
            <dt>{{ t('profile.status') }}</dt>
            <dd>{{ profile.status || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('profile.balance') }}</dt>
            <dd>{{ profile.balance ?? '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('profile.concurrency') }}</dt>
            <dd>{{ profile.concurrency ?? '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('profile.createdAt') }}</dt>
            <dd>{{ profile.created_at || '—' }}</dd>
          </div>
        </dl>
      </section>

      <form class="panel form" @submit.prevent="onSaveUsername">
        <h2>{{ t('profile.updateUsername') }}</h2>
        <label>
          <span>{{ t('profile.username') }}</span>
          <Input v-model="username" autocomplete="username" required />
        </label>
        <Button type="submit" :disabled="saving">
          {{ t('common.save') }}
        </Button>
      </form>

      <form class="panel form" @submit.prevent="onChangePassword">
        <h2>{{ t('profile.changePassword') }}</h2>
        <label>
          <span>{{ t('profile.oldPassword') }}</span>
          <Input
            v-model="oldPassword"
            type="password"
            autocomplete="current-password"
            required
          />
        </label>
        <label>
          <span>{{ t('profile.newPassword') }}</span>
          <Input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            required
          />
        </label>
        <Button type="submit" :disabled="changingPassword">
          {{ t('common.save') }}
        </Button>
      </form>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
  min-width: 0;
  max-width: 36rem;
}

.page h1 {
  margin: 0;
  font-size: 1.55rem;
}

.panel {
  padding: 1rem;
  border-radius: var(--cshell-radius-panel);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-border);
}

.panel h2 {
  margin: 0 0 0.65rem;
  font-size: 1.05rem;
}

.facts {
  display: grid;
  gap: 0.65rem;
  margin: 0;
}

.facts div {
  display: grid;
  gap: 0.15rem;
}

.facts dt {
  color: var(--cshell-text-muted);
  font-size: 0.85rem;
}

.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.form {
  display: grid;
  gap: 0.75rem;
}

.form label {
  display: grid;
  gap: 0.3rem;
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}

.ok {
  margin: 0;
  color: var(--cshell-accent);
}
</style>
