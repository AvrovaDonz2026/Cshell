<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import Button from '@/components/primitives/Button.vue'
import { logoUrl } from '@/lib/assets'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const auth = useAuthStore()
const settings = useSettingsStore()
const theme = useThemeStore()
const router = useRouter()

/** Injected by the local preview server; we only display it, never add it. */
const mockBadgePresent = ref(false)

const registrationLinkEnabled = computed(
  () => settings.settingsReady && settings.registrationEnabled,
)
const registrationHint = computed(() => {
  if (settings.settingsReady && !settings.registrationEnabled) {
    return t('home.actions.registrationDisabled')
  }
  if (settings.settingsFailed) return t('home.actions.settingsUnavailable')
  return t('home.actions.settingsLoading')
})

const workspaceCards = computed(() => [
  { title: t('home.workspace.usageTitle'), body: t('home.workspace.usageBody') },
  { title: t('home.workspace.keysTitle'), body: t('home.workspace.keysBody') },
  { title: t('home.workspace.billingTitle'), body: t('home.workspace.billingBody') },
  { title: t('home.workspace.profileTitle'), body: t('home.workspace.profileBody') },
])

const features = computed(() => [
  { title: t('home.features.usageTitle'), body: t('home.features.usageBody') },
  { title: t('home.features.keysTitle'), body: t('home.features.keysBody') },
  { title: t('home.features.billingTitle'), body: t('home.features.billingBody') },
])

const steps = computed(() => [
  { title: t('home.steps.firstTitle'), body: t('home.steps.firstBody') },
  { title: t('home.steps.secondTitle'), body: t('home.steps.secondBody') },
  { title: t('home.steps.thirdTitle'), body: t('home.steps.thirdBody') },
])

async function onSignIn(): Promise<void> {
  if (auth.isAuthenticated) {
    await router.push({ name: 'dashboard' })
    return
  }
  await router.push({ name: 'login' })
}

function detectMockBadge(): void {
  if (typeof document === 'undefined') return
  mockBadgePresent.value = Boolean(document.getElementById('cshell-web-mock-label'))
}

onMounted(() => {
  if (!settings.settingsReady && !settings.loading) void settings.loadPublic()
  detectMockBadge()
})

onBeforeUnmount(() => {
  mockBadgePresent.value = false
})
</script>

<template>
  <div class="cshell-public" :data-theme="theme.mode">
    <header class="site-header">
      <div class="site-header__inner">
        <RouterLink class="wordmark" :to="{ name: 'home' }">
          <img
            class="wordmark__logo"
            :src="logoUrl"
            width="36"
            height="36"
            alt=""
          >
          <span class="wordmark__name">{{ t('brand.name') }}</span>
        </RouterLink>

        <div class="site-header__actions">
          <div class="site-header__prefs">
            <ThemeToggle />
            <LocaleSwitcher />
          </div>
          <div class="site-header__auth">
            <Button variant="primary" @click="onSignIn">
              {{ t('home.actions.signIn') }}
            </Button>
            <RouterLink
              v-if="registrationLinkEnabled"
              class="btn-link btn-link--secondary"
              :to="{ name: 'register' }"
            >
              {{ t('home.actions.createAccount') }}
            </RouterLink>
            <span
              v-else
              class="btn-link btn-link--disabled"
              aria-disabled="true"
              :title="registrationHint"
            >
              {{ t('home.actions.createAccount') }}
            </span>
          </div>
        </div>
      </div>
    </header>

    <main>
      <section class="hero" :aria-labelledby="'home-hero-title'">
        <div class="hero__copy">
          <p class="eyebrow">{{ t('home.hero.eyebrow') }}</p>
          <h1 id="home-hero-title" class="hero__title">
            {{ t('home.hero.title') }}
          </h1>
          <p class="hero__lede">
            {{ t('home.hero.lede') }}
          </p>
          <div class="hero__ctas">
            <Button variant="primary" @click="onSignIn">
              {{ t('home.actions.signIn') }}
            </Button>
            <RouterLink
              v-if="registrationLinkEnabled"
              class="btn-link btn-link--secondary"
              :to="{ name: 'register' }"
            >
              {{ t('home.actions.createAccount') }}
            </RouterLink>
            <span
              v-else
              class="btn-link btn-link--disabled"
              aria-disabled="true"
              :title="registrationHint"
            >
              {{ t('home.actions.createAccount') }}
            </span>
          </div>
          <p v-if="!registrationLinkEnabled" class="hero__note" role="status">
            {{ registrationHint }}
          </p>
        </div>

        <aside class="hero__panel" :aria-labelledby="'home-panel-title'">
          <div class="panel__head">
            <h2 id="home-panel-title" class="panel__title">
              {{ t('home.workspace.title') }}
            </h2>
            <span class="panel__badge">{{ t('home.workspace.badge') }}</span>
          </div>
          <div class="panel__heat" aria-hidden="true">
            <span
              v-for="cell in 24"
              :key="cell"
              class="panel__heat-cell"
              :class="`panel__heat-cell--l${cell % 5}`"
            />
          </div>
          <ul class="panel__list">
            <li v-for="card in workspaceCards" :key="card.title" class="panel__item">
              <h3 class="panel__item-title">{{ card.title }}</h3>
              <p class="panel__item-body">{{ card.body }}</p>
            </li>
          </ul>
        </aside>
      </section>

      <section class="section" :aria-labelledby="'home-what-title'">
        <h2 id="home-what-title" class="section__title">
          {{ t('home.features.title') }}
        </h2>
        <p class="section__lede">{{ t('home.features.lede') }}</p>
        <div class="grid-3">
          <article v-for="feature in features" :key="feature.title" class="card">
            <h3 class="card__title">{{ feature.title }}</h3>
            <p class="card__body">{{ feature.body }}</p>
          </article>
        </div>
      </section>

      <section class="section" :aria-labelledby="'home-how-title'">
        <h2 id="home-how-title" class="section__title">
          {{ t('home.steps.title') }}
        </h2>
        <ol class="steps">
          <li v-for="(step, index) in steps" :key="step.title" class="step">
            <span class="step__index" aria-hidden="true">{{ index + 1 }}</span>
            <h3 class="step__title">{{ step.title }}</h3>
            <p class="step__body">{{ step.body }}</p>
          </li>
        </ol>
      </section>

      <section class="cta-band" :aria-labelledby="'home-cta-title'">
        <div class="cta-band__copy">
          <h2 id="home-cta-title" class="cta-band__title">
            {{ t('home.cta.title') }}
          </h2>
          <p class="cta-band__body">{{ t('home.cta.body') }}</p>
        </div>
        <div class="cta-band__actions">
          <Button variant="primary" @click="onSignIn">
            {{ t('home.actions.signIn') }}
          </Button>
          <RouterLink
            v-if="registrationLinkEnabled"
            class="btn-link btn-link--onAccent"
            :to="{ name: 'register' }"
          >
            {{ t('home.actions.createAccount') }}
          </RouterLink>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="site-footer__inner">
        <div class="site-footer__brand">
          <p class="site-footer__name">{{ t('brand.name') }}</p>
          <p class="site-footer__note">{{ t('home.footer.localeNote') }}</p>
        </div>
        <div class="site-footer__links">
          <RouterLink class="footer-link" :to="{ name: 'login' }">
            {{ t('home.actions.signIn') }}
          </RouterLink>
          <a class="footer-link" href="/admin">
            {{ t('home.footer.adminEntry') }}
          </a>
          <span v-if="mockBadgePresent" class="mock-indicator">
            LOCAL MOCK
          </span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.cshell-public {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--cshell-bg);
  color: var(--cshell-text);
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--cshell-bg-elevated);
  border-bottom: 1px solid var(--cshell-border);
}

.site-header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  max-width: 72rem;
  margin: 0 auto;
  padding: 0.85rem 1.5rem;
}

.wordmark {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  text-decoration: none;
  color: inherit;
}

.wordmark__logo {
  border-radius: var(--cshell-radius-badge);
  object-fit: cover;
}

.wordmark__name {
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.site-header__actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.site-header__prefs {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.site-header__auth {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0.45rem 1rem;
  border-radius: var(--cshell-radius-control);
  border: 1px solid var(--cshell-border);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.94rem;
  white-space: nowrap;
}

.btn-link--secondary {
  background: var(--cshell-surface);
  color: var(--cshell-text);
}

.btn-link--disabled {
  background: var(--cshell-surface-muted);
  color: var(--cshell-text-muted);
  border-style: dashed;
  cursor: not-allowed;
}

.btn-link--onAccent {
  background: rgba(255, 250, 245, 0.14);
  border-color: rgba(255, 250, 245, 0.5);
  color: #fffaf5;
}

.cshell-public main {
  flex: 1;
  width: 100%;
  max-width: 72rem;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 3.5rem;
  display: grid;
  gap: 3.5rem;
}

.hero {
  display: grid;
  gap: 2.5rem;
  align-items: start;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  padding-top: 1rem;
}

.hero__copy {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.eyebrow {
  margin: 0;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--cshell-accent);
}

.hero__title {
  margin: 0;
  font-size: clamp(2rem, 4.2vw, 3.1rem);
  line-height: 1.12;
  letter-spacing: -0.02em;
}

.hero__lede {
  margin: 0;
  max-width: 34rem;
  font-size: 1.02rem;
  line-height: 1.6;
  color: var(--cshell-text-muted);
}

.hero__ctas {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 0.35rem;
}

.hero__note {
  margin: 0;
  font-size: 0.86rem;
  color: var(--cshell-text-muted);
}

.hero__panel {
  display: grid;
  gap: 1rem;
  padding: 1.15rem;
  border-radius: var(--cshell-radius-window);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  box-shadow: var(--cshell-shadow);
  min-width: 0;
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.panel__title {
  margin: 0;
  font-size: 0.98rem;
}

.panel__badge {
  padding: 0.15rem 0.5rem;
  border-radius: var(--cshell-radius-badge);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface-muted);
  color: var(--cshell-text-muted);
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
}

.panel__heat {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 0.28rem;
}

.panel__heat-cell {
  aspect-ratio: 1;
  border-radius: 3px;
  background: var(--cshell-heat-0);
}

.panel__heat-cell--l1 { background: var(--cshell-heat-1); }
.panel__heat-cell--l2 { background: var(--cshell-heat-2); }
.panel__heat-cell--l3 { background: var(--cshell-heat-3); }
.panel__heat-cell--l4 { background: var(--cshell-heat-4); }

.panel__list {
  display: grid;
  gap: 0.65rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.panel__item {
  display: grid;
  gap: 0.15rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--cshell-border);
}

.panel__item:first-child {
  border-top: 0;
  padding-top: 0;
}

.panel__item-title {
  margin: 0;
  font-size: 0.88rem;
}

.panel__item-body {
  margin: 0;
  font-size: 0.82rem;
  color: var(--cshell-text-muted);
  line-height: 1.5;
}

.section {
  display: grid;
  gap: 0.6rem;
}

.section__title {
  margin: 0;
  font-size: clamp(1.3rem, 2.4vw, 1.65rem);
  letter-spacing: -0.01em;
}

.section__lede {
  margin: 0;
  max-width: 40rem;
  color: var(--cshell-text-muted);
  line-height: 1.55;
}

.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 0.6rem;
}

.card {
  padding: 1.2rem;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  min-width: 0;
}

.card__title {
  margin: 0 0 0.4rem;
  font-size: 1rem;
}

.card__body {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--cshell-text-muted);
}

.steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin: 0.6rem 0 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
}

.step {
  display: grid;
  gap: 0.3rem;
  padding: 1.1rem;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-bg-elevated);
  min-width: 0;
}

.step__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: var(--cshell-radius-badge);
  background: var(--cshell-accent-soft);
  color: var(--cshell-accent);
  font-weight: 700;
  font-size: 0.85rem;
}

.step__title {
  margin: 0.2rem 0 0;
  font-size: 0.96rem;
}

.step__body {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.55;
  color: var(--cshell-text-muted);
}

.cta-band {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
  padding: 1.5rem;
  border-radius: var(--cshell-radius-window);
  background: var(--cshell-accent);
  color: #fffaf5;
}

.cta-band__copy {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.cta-band__title {
  margin: 0;
  font-size: clamp(1.2rem, 2.2vw, 1.5rem);
}

.cta-band__body {
  margin: 0;
  max-width: 34rem;
  font-size: 0.92rem;
  color: rgba(255, 250, 245, 0.85);
  line-height: 1.55;
}

.cta-band__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.cta-band__actions :deep(.cshell-btn--primary) {
  background: #fffaf5;
  color: var(--cshell-accent);
}

.site-footer {
  background: var(--cshell-bg-elevated);
  border-top: 1px solid var(--cshell-border);
}

.site-footer__inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.25rem 1.5rem;
}

.site-footer__brand {
  display: grid;
  gap: 0.15rem;
}

.site-footer__name {
  margin: 0;
  font-weight: 700;
}

.site-footer__note {
  margin: 0;
  font-size: 0.82rem;
  color: var(--cshell-text-muted);
}

.site-footer__links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}

.footer-link {
  font-size: 0.86rem;
  color: var(--cshell-text-muted);
  text-decoration: none;
}

.footer-link:hover {
  color: var(--cshell-text);
}

.mock-indicator {
  padding: 0.15rem 0.5rem;
  border-radius: var(--cshell-radius-badge);
  background: var(--cshell-surface-muted);
  border: 1px solid var(--cshell-border);
  color: var(--cshell-text-muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .grid-3,
  .steps {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .site-header__inner {
    flex-wrap: wrap;
  }

  .site-header__actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: space-between;
  }

  .site-header__prefs :deep(.locale-switcher) {
    min-width: 6rem;
  }
}

@media (max-width: 560px) {
  .site-header__auth {
    flex: 1 1 100%;
  }
}

@media (max-width: 480px) {
  .site-header__inner,
  .cshell-public main,
  .site-footer__inner {
    padding-left: 1rem;
    padding-right: 1rem;
  }

  .site-header__auth {
    width: 100%;
  }

  .site-header__auth > * {
    flex: 1 1 0;
    min-width: 0;
  }

  .cshell-public main {
    gap: 2.5rem;
    padding-top: 1.75rem;
  }

  .cta-band {
    padding: 1.2rem;
  }

  .cta-band__actions > * {
    flex: 1 1 100%;
  }
}

@media (max-width: 390px) {
  .wordmark__name {
    font-size: 1.05rem;
  }

  .btn-link,
  .site-header__auth :deep(.cshell-btn) {
    padding-left: 0.65rem;
    padding-right: 0.65rem;
    font-size: 0.86rem;
  }
}
</style>
