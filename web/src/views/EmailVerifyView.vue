<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AuthSplit from '@/components/AuthSplit.vue'
const { t } = useI18n()
</script>
<template>
  <AuthSplit>
    <div class="auth-card">
      <h1 class="auth-form__title">{{ t('auth.emailVerifyTitle') }}</h1>
      <p class="auth-form__caption" role="status">{{ t('auth.verifyRegistrationStep') }}</p>
      <RouterLink class="auth-link" :to="{ name: 'register' }">{{ t('auth.toRegister') }}</RouterLink>
    </div>
  </AuthSplit>
</template>
<style scoped>
.auth-card { display: grid; gap: var(--cshell-space-4); }
.auth-form__title { margin: 0; font-size: var(--cshell-type-compact-title); }
.auth-form__caption { margin: 0; color: var(--cshell-text-muted); font-size: var(--cshell-type-body); }
.auth-link { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; color: var(--cshell-accent); text-decoration: none; }
</style>
