<script setup lang="ts">
withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset'
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    disabled?: boolean
    block?: boolean
  }>(),
  {
    type: 'button',
    variant: 'primary',
    disabled: false,
    block: false,
  },
)
</script>

<template>
  <button
    class="cshell-btn"
    :class="[`cshell-btn--${variant}`, { 'cshell-btn--block': block }]"
    :type="type"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.cshell-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 2.5rem;
  padding: 0.45rem 1rem;
  border-radius: var(--cshell-radius-control, 10px);
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

/* Touch targets stay at least 44px on small screens. */
@media (max-width: 1023px) {
  .cshell-btn {
    min-height: 44px;
  }
}

.cshell-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.cshell-btn--block {
  width: 100%;
}

.cshell-btn--primary {
  background: var(--cshell-accent, #a95e45);
  color: #fffaf5;
}

.cshell-btn--primary:hover:not(:disabled) {
  background: var(--cshell-accent-hover, #8f4d38);
}

.cshell-btn--secondary {
  background: var(--cshell-surface, #fff9f0);
  border-color: var(--cshell-border, #d9cbb8);
  color: var(--cshell-text, #2c241c);
}

.cshell-btn--ghost {
  background: transparent;
  color: var(--cshell-text, #2c241c);
}

.cshell-btn--danger {
  background: var(--cshell-danger, #9b3b2f);
  color: #fff;
}
</style>
