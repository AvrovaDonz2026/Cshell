<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AuthSplit from '@/components/AuthSplit.vue'
const { t } = useI18n()
</script>
<template>
  <AuthSplit :title="t('auth.emailVerifyTitle')">
    <p role="status">{{ t('auth.verifyRegistrationStep') }}</p>
    <RouterLink :to="{ name: 'register' }">{{ t('auth.toRegister') }}</RouterLink>
  </AuthSplit>
</template>
