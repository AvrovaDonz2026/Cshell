<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import {
  handleGlobalEscape,
  onAppInertChange,
  popDialog,
  pushDialog,
} from '@/lib/dialogContext'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    labelledBy?: string
    closeOnOverlay?: boolean
  }>(),
  {
    closeOnOverlay: true,
  },
)

const emit = defineEmits<{
  close: []
}>()

const panelRef = ref<HTMLElement | null>(null)
const previouslyFocused = ref<HTMLElement | null>(null)
const layerId = ref<number | null>(null)

function getFocusable(root: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  )
}

function setPanelInert(inert: boolean): void {
  if (!panelRef.value) return
  if (inert) panelRef.value.setAttribute('inert', '')
  else panelRef.value.removeAttribute('inert')
}

function setAppInert(inert: boolean): void {
  const app = document.getElementById('app')
  if (!app) return
  if (inert) app.setAttribute('inert', '')
  else app.removeAttribute('inert')
}

const stopAppInert = onAppInertChange(setAppInert)

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    handleGlobalEscape(event)
    return
  }
  if (event.key !== 'Tab' || !panelRef.value) return
  const focusable = getFocusable(panelRef.value)
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function openLayer(): void {
  previouslyFocused.value = document.activeElement as HTMLElement | null
  layerId.value = pushDialog({
    onEscape: () => emit('close'),
    setInert: setPanelInert,
  })
  document.addEventListener('keydown', onKeydown, true)
  nextTick(() => {
    const focusable = panelRef.value ? getFocusable(panelRef.value) : []
    ;(focusable[0] ?? panelRef.value)?.focus()
  })
}

function closeLayer(): void {
  document.removeEventListener('keydown', onKeydown, true)
  if (layerId.value != null) {
    popDialog(layerId.value)
    layerId.value = null
  }
  previouslyFocused.value?.focus?.()
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) openLayer()
    else if (layerId.value != null) closeLayer()
  },
)

onMounted(() => {
  if (props.open) openLayer()
})

onBeforeUnmount(() => {
  if (layerId.value != null) closeLayer()
  stopAppInert()
})

function onOverlayClick(): void {
  if (props.closeOnOverlay) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="cshell-dialog-root"
      role="presentation"
    >
      <div class="cshell-dialog-overlay" @click="onOverlayClick" />
      <div
        ref="panelRef"
        class="cshell-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        :aria-labelledby="labelledBy"
        tabindex="-1"
      >
        <header v-if="title || $slots.header" class="cshell-dialog__header">
          <slot name="header">
            <h2 class="cshell-dialog__title">
              {{ title }}
            </h2>
          </slot>
        </header>
        <div class="cshell-dialog__body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="cshell-dialog__footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style>
body.cshell-user-portals .cshell-dialog-root,
.cshell-dialog-root {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: grid;
  place-items: center;
  padding: 1rem;
}

.cshell-dialog-overlay {
  position: absolute;
  inset: 0;
  background: var(--cshell-overlay, rgba(44, 36, 28, 0.42));
}

.cshell-dialog {
  position: relative;
  z-index: 1;
  width: min(100%, 28rem);
  max-height: min(90vh, 40rem);
  max-height: min(90dvh, 40rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--cshell-radius-window, 20px);
  background: var(--cshell-surface, #fff9f0);
  color: var(--cshell-text, #2c241c);
  border: 1px solid var(--cshell-border, #d9cbb8);
  box-shadow: var(--cshell-shadow, 0 12px 32px rgba(44, 36, 28, 0.08));
  padding: 0;
}

.cshell-dialog__header,
.cshell-dialog__footer {
  flex: 0 0 auto;
  padding: 1rem 1.2rem;
}

.cshell-dialog__header {
  border-bottom: 1px solid var(--cshell-border, #d9cbb8);
}

.cshell-dialog__body {
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.2rem;
}

.cshell-dialog__title {
  margin: 0;
  font-size: 1.15rem;
}

.cshell-dialog__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  border-top: 1px solid var(--cshell-border, #d9cbb8);
}
</style>
