<script setup lang="ts">
withDefaults(
  defineProps<{
    id?: string
    type?: string
    placeholder?: string
    autocomplete?: string
    disabled?: boolean
    required?: boolean
  }>(),
  {
    type: 'text',
    disabled: false,
    required: false,
  },
)

const model = defineModel<string>({ default: '' })
</script>

<template>
  <input
    :id="id"
    v-model="model"
    class="cshell-input"
    :type="type"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :disabled="disabled"
    :required="required"
  >
</template>

<style scoped>
.cshell-input {
  width: 100%;
  height: var(--cshell-control-height, 44px);
  padding: 0 var(--cshell-space-3, 0.75rem);
  border-radius: var(--cshell-radius-control, 10px);
  border: 1px solid var(--cshell-border, #d9cbb8);
  background: var(--cshell-surface, #fff9f0);
  color: var(--cshell-text, #2c241c);
  font-size: var(--cshell-type-body, 0.9375rem);
  line-height: 1.25;
}

</style>
