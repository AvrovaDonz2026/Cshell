<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'

const auth = useAuthStore()
const settings = useSettingsStore()
const theme = useThemeStore()
const route = useRoute()

function syncPortalClass(): void {
  const isGuest = route.name === 'login' || route.name === 'register'
  document.body.classList.toggle('cshell-user-portals', !isGuest && auth.isAuthenticated)
  document.body.dataset.theme = theme.mode
}

onMounted(() => {
  if (!auth.hydrated) auth.hydrate()
  void settings.loadPublic()
  theme.applyDom()
  syncPortalClass()
})

watch([() => route.name, () => auth.isAuthenticated, () => theme.mode], syncPortalClass)
</script>

<template>
  <RouterView />
</template>
