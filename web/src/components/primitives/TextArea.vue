<script setup lang="ts">
withDefaults(
  defineProps<{
    id?: string
    rows?: number
    placeholder?: string
    disabled?: boolean
    required?: boolean
  }>(),
  {
    rows: 4,
    disabled: false,
    required: false,
  },
)

const model = defineModel<string>({ default: '' })
</script>

<template>
  <textarea
    :id="id"
    v-model="model"
    class="cshell-textarea"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :required="required"
  />
</template>

<style scoped>
.cshell-textarea {
  width: 100%;
  min-height: 5.5rem;
  padding: var(--cshell-space-3, 0.75rem);
  border-radius: var(--cshell-radius-control, 10px);
  border: 1px solid var(--cshell-border, #d9cbb8);
  background: var(--cshell-surface, #fff9f0);
  color: var(--cshell-text, #2c241c);
  resize: vertical;
  font-size: var(--cshell-type-body, 0.9375rem);
  line-height: 1.5;
}
</style>
