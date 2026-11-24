<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { popDialog, pushDialog } from '@/lib/dialogContext'
import { getPopupPosition } from '@/lib/popupPosition'

export interface SelectOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    id?: string
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
  }>(),
  {
    placeholder: 'Select…',
    disabled: false,
  },
)

const model = defineModel<string>({ default: '' })

const open = ref(false)
const ownerId = `cshell-select-${Math.random().toString(36).slice(2)}`
const rootRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const layerId = ref<number | null>(null)
const listStyle = ref<Record<string, string>>({})

const selectedLabel = computed(() => {
  const match = props.options.find((opt) => opt.value === model.value)
  return match?.label ?? props.placeholder
})

function positionList(): void {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  listStyle.value = getPopupPosition(rect, listRef.value?.scrollHeight ?? 280)
}

function close(): void {
  open.value = false
}

function toggle(): void {
  if (props.disabled) return
  open.value = !open.value
}

function choose(value: string): void {
  model.value = value
  close()
  nextTick(() => triggerRef.value?.focus())
}

function onDocumentPointer(event: MouseEvent): void {
  if (!open.value || !rootRef.value) return
  const target = event.target as Node
  if (rootRef.value.contains(target)) return
  if (listRef.value?.contains(target)) return
  close()
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (!open.value || event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  close()
  nextTick(() => triggerRef.value?.focus())
}

function onListKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    // dialogContext capture on the parent dialog handles Escape via the stack.
    event.stopPropagation()
    event.preventDefault()
    close()
    nextTick(() => triggerRef.value?.focus())
  }
}

const reposition = () => { if (open.value) positionList() }

onMounted(() => {
  window.addEventListener('scroll', reposition, true)
  window.addEventListener('resize', reposition)
  window.visualViewport?.addEventListener('resize', reposition)
  window.visualViewport?.addEventListener('scroll', reposition)
  document.addEventListener('mousedown', onDocumentPointer)
  document.addEventListener('keydown', onDocumentKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', reposition, true)
  window.removeEventListener('resize', reposition)
  window.visualViewport?.removeEventListener('resize', reposition)
  window.visualViewport?.removeEventListener('scroll', reposition)
  document.removeEventListener('mousedown', onDocumentPointer)
  document.removeEventListener('keydown', onDocumentKeydown, true)
  if (layerId.value != null) {
    popDialog(layerId.value)
    layerId.value = null
  }
})

watch(open, async (isOpen) => {
  if (isOpen) {
    await nextTick()
    positionList()
    layerId.value = pushDialog({
      onEscape: () => {
        close()
        nextTick(() => triggerRef.value?.focus())
      },
      setInert: () => undefined,
    })
    await nextTick()
    listRef.value?.focus()
  } else if (layerId.value != null) {
    popDialog(layerId.value)
    layerId.value = null
  }
})
</script>

<template>
  <div ref="rootRef" class="cshell-select" :data-select-owner="ownerId" :data-open="open ? 'true' : 'false'">
    <button
      :id="id"
      ref="triggerRef"
      type="button"
      class="cshell-select__trigger"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      {{ selectedLabel }}
    </button>
    <Teleport to="body">
      <ul
        v-if="open"
        ref="listRef"
        class="cshell-select__list"
        :data-select-owner="ownerId"
        role="listbox"
        tabindex="-1"
        :style="listStyle"
        @keydown="onListKeydown"
      >
        <li
          v-for="opt in options"
          :key="opt.value"
          role="option"
          :aria-selected="opt.value === model"
          class="cshell-select__option"
          @click="choose(opt.value)"
        >
          {{ opt.label }}
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.cshell-select {
  position: relative;
  width: 100%;
}

.cshell-select__trigger {
  width: 100%;
  height: var(--cshell-control-height, 44px);
  padding: 0 var(--cshell-space-3, 0.75rem);
  text-align: left;
  border-radius: var(--cshell-radius-control, 10px);
  border: 1px solid var(--cshell-border, #d9cbb8);
  background: var(--cshell-surface, #fff9f0);
  color: var(--cshell-text, #2c241c);
  cursor: pointer;
  font-size: var(--cshell-type-body, 0.9375rem);
  line-height: 1.25;
}

</style>

<style>
body.cshell-user-portals .cshell-select__list,
.cshell-user-workspace ~ .cshell-select__list,
.cshell-select__list {
  position: fixed;
  /* Above dialog root (1400) so nested menus remain clickable */
  z-index: 1500;
  min-width: 0;
  margin: 0;
  padding: 0.35rem;
  list-style: none;
  border-radius: var(--cshell-radius-panel, 16px);
  border: 1px solid var(--cshell-border, #d9cbb8);
  background: var(--cshell-surface, #fff9f0);
  color: var(--cshell-text, #2c241c);
  box-shadow: var(--cshell-shadow, 0 12px 32px rgba(44, 36, 28, 0.08));
}

.cshell-select__option {
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 0 var(--cshell-space-3, 0.75rem);
  border-radius: var(--cshell-radius-badge, 6px);
  cursor: pointer;
}

.cshell-select__option:hover,
.cshell-select__option[aria-selected='true'] {
  background: var(--cshell-accent-soft, rgba(169, 94, 69, 0.14));
}
</style>
