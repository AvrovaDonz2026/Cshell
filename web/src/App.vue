<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'

const auth = useAuthStore()
const settings = useSettingsStore()
const theme = useThemeStore()
const route = useRoute()

function syncPortalClass(): void {
  if (typeof document === 'undefined') return
  const isAdmin = auth.isAuthenticated && auth.isAdmin
  document.body.classList.toggle('cshell-user-portals', !isAdmin)
  document.body.dataset.theme = theme.mode
}

syncPortalClass()

onMounted(() => {
  if (!auth.hydrated) auth.hydrate()
  void settings.loadPublic()
  theme.applyDom()
  syncPortalClass()
})

watch([() => route.name, () => auth.isAuthenticated, () => auth.isAdmin, () => theme.mode], syncPortalClass)

onBeforeUnmount(() => {
  document.body.classList.remove('cshell-user-portals')
  delete document.body.dataset.theme
})
</script>

<template>
  <RouterView />
</template>
