<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { logoUrl } from '@/lib/assets'
import { useThemeStore } from '@/stores/theme'

withDefaults(
  defineProps<{
    title?: string
  }>(),
  { title: '' },
)

const { t } = useI18n()
const theme = useThemeStore()
</script>

<template>
  <div class="cshell-user-workspace cshell-public auth-shell" :data-theme="theme.mode">
    <aside class="auth-brand">
      <RouterLink class="auth-brand__mark" :to="{ name: 'home' }">
        <img class="auth-brand__logo" :src="logoUrl" width="36" height="36" alt="">
        <span class="auth-brand__name">{{ t('brand.name') }}</span>
      </RouterLink>

      <div class="auth-brand__copy">
        <h1 v-if="title" class="auth-brand__title">{{ title }}</h1>
        <p class="auth-brand__lede">{{ t('auth.brandLede') }}</p>
        <ul class="auth-brand__bullets">
          <li>{{ t('auth.brandBulletUsage') }}</li>
          <li>{{ t('auth.brandBulletKeys') }}</li>
          <li>{{ t('auth.brandBulletBilling') }}</li>
        </ul>
      </div>

      <div class="auth-brand__foot">
        <RouterLink class="auth-brand__link" :to="{ name: 'home' }">
          {{ t('auth.backHome') }}
        </RouterLink>
      </div>
    </aside>

    <section class="auth-panel" :aria-label="title">
      <div class="auth-panel__prefs">
        <ThemeToggle />
        <LocaleSwitcher />
      </div>
      <div class="auth-panel__form">
        <slot />
      </div>
    </section>
  </div>
</template>

<style scoped>
.auth-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 100vh;
  background: var(--cshell-bg);
  color: var(--cshell-text);
}

.auth-brand {
  display: none;
}

.auth-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  justify-content: center;
  padding: 1.5rem;
  min-width: 0;
}

.auth-panel__prefs {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: flex-end;
}

.auth-panel__form {
  width: 100%;
  max-width: 24rem;
  margin: 0 auto;
  padding: 1.5rem;
  border-radius: var(--cshell-radius-window);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-border);
  box-shadow: var(--cshell-shadow);
  min-width: 0;
}

@media (min-width: 900px) {
  .auth-shell {
    grid-template-columns: minmax(18rem, 0.9fr) minmax(0, 1.1fr);
  }

  .auth-brand {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    padding: 2rem 2.5rem;
    background: var(--cshell-sidebar);
    border-right: 1px solid var(--cshell-border);
    border-top-right-radius: var(--cshell-radius-window);
    border-bottom-right-radius: var(--cshell-radius-window);
    min-width: 0;
  }

  .auth-brand__mark {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    text-decoration: none;
    color: inherit;
  }

  .auth-brand__logo {
    border-radius: var(--cshell-radius-badge);
    object-fit: cover;
  }

  .auth-brand__name {
    font-size: 1.15rem;
    font-weight: 700;
  }

  .auth-brand__copy {
    display: grid;
    gap: 0.9rem;
    margin: auto 0;
    max-width: 26rem;
  }

  .auth-brand__title {
    margin: 0;
    font-size: clamp(1.4rem, 2.4vw, 1.9rem);
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  .auth-brand__lede {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.6;
    color: var(--cshell-text-muted);
  }

  .auth-brand__bullets {
    margin: 0;
    padding-left: 1.15rem;
    display: grid;
    gap: 0.45rem;
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--cshell-text-muted);
  }

  .auth-brand__foot {
    margin-top: auto;
  }

  .auth-brand__link {
    font-size: 0.85rem;
    color: var(--cshell-text-muted);
    text-decoration: underline;
  }

  .auth-panel {
    padding: 2.5rem 3rem;
  }

  .auth-panel__prefs {
    padding-right: 0.25rem;
  }

  .auth-panel__form {
    padding: 1.75rem;
  }
}

@media (max-width: 480px) {
  .auth-panel {
    padding: 1rem;
  }

  .auth-panel__form {
    padding: 1.15rem;
  }
}
</style>
