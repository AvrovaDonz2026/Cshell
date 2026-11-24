<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { popDialog, pushDialog } from '@/lib/dialogContext'

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
  const maxHeight = Math.min(280, window.innerHeight - rect.bottom - 8)
  listStyle.value = {
    top: `${Math.round(rect.bottom + 4)}px`,
    left: `${Math.round(rect.left)}px`,
    width: `${Math.round(rect.width)}px`,
    maxHeight: `${Math.max(120, maxHeight)}px`,
    overflow: 'auto',
  }
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

function onListKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    // dialogContext capture on the parent dialog handles Escape via the stack.
    event.stopPropagation()
    event.preventDefault()
    close()
    nextTick(() => triggerRef.value?.focus())
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentPointer)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPointer)
  if (layerId.value != null) {
    popDialog(layerId.value)
    layerId.value = null
  }
})

watch(open, async (isOpen) => {
  if (isOpen) {
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
  <div ref="rootRef" class="cshell-select" :data-open="open ? 'true' : 'false'">
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
  min-height: 2.5rem;
  padding: 0.5rem 0.75rem;
  text-align: left;
  border-radius: var(--cshell-radius-control, 10px);
  border: 1px solid var(--cshell-border, #d9cbb8);
  background: var(--cshell-surface, #fff9f0);
  color: var(--cshell-text, #2c241c);
  cursor: pointer;
}

@media (max-width: 1023px) {
  .cshell-select__trigger {
    min-height: 44px;
  }
}
</style>

<style>
body.cshell-user-portals .cshell-select__list,
.cshell-user-workspace ~ .cshell-select__list,
.cshell-select__list {
  position: fixed;
  /* Above dialog root (1400) so nested menus remain clickable */
  z-index: 1500;
  min-width: 12rem;
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
  padding: 0.45rem 0.65rem;
  border-radius: var(--cshell-radius-badge, 6px);
  cursor: pointer;
}

.cshell-select__option:hover,
.cshell-select__option[aria-selected='true'] {
  background: var(--cshell-accent-soft, rgba(169, 94, 69, 0.14));
}
</style>
