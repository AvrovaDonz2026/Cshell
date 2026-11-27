<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { logoUrl } from '@/lib/assets'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const theme = useThemeStore()
</script>

<template>
  <div class="cshell-user-workspace cshell-public auth-shell" :data-theme="theme.mode">
    <header class="auth-header">
      <RouterLink class="auth-header__brand" :to="{ name: 'home' }" :aria-label="t('brand.name')">
        <img :src="logoUrl" width="30" height="30" alt="">
        <span>{{ t('brand.name') }}</span>
      </RouterLink>
      <div class="auth-header__prefs" aria-label="Preferences">
        <ThemeToggle variant="header" />
        <LocaleSwitcher variant="header" />
      </div>
    </header>

    <main class="auth-main">
      <section class="auth-content">
        <slot />
      </section>
    </main>
  </div>
</template>

<style scoped>
.auth-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--cshell-bg);
  color: var(--cshell-text);
}

.auth-header {
  width: min(100%, 80rem);
  min-height: 4.25rem;
  margin-inline: auto;
  padding: 0 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.auth-header__brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  color: inherit;
  font-size: 1rem;
  font-weight: 650;
  text-decoration: none;
}

.auth-header__brand img { border-radius: var(--cshell-radius-badge); object-fit: cover; }
.auth-header__prefs { display: inline-flex; align-items: center; gap: 0.4rem; }

.auth-main {
  flex: 1;
  width: 100%;
  display: grid;
  align-content: start;
  justify-items: center;
  padding: clamp(3rem, 12vh, 7rem) 1.25rem 4rem;
}

.auth-content {
  width: min(100%, 23.75rem);
  min-width: 0;
}

@media (max-width: 600px) {
  .auth-header { min-height: 3.75rem; padding-inline: 1.25rem; }
  .auth-main { padding: 2rem 1.25rem 3rem; }
}

@media (max-height: 650px) and (orientation: landscape) {
  .auth-main { padding-block: 1rem 2rem; }
}
</style>
