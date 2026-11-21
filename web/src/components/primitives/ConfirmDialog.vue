<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Button from './Button.vue'
import Dialog from './Dialog.vue'

withDefaults(
  defineProps<{
    open: boolean
    title?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
  }>(),
  {
    danger: false,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
  close: []
}>()

const { t } = useI18n()

function onCancel(): void {
  emit('cancel')
  emit('close')
}

function onConfirm(): void {
  emit('confirm')
  emit('close')
}
</script>

<template>
  <Dialog
    :open="open"
    :title="title"
    @close="onCancel"
  >
    <slot />
    <template #footer>
      <Button variant="secondary" @click="onCancel">
        {{ cancelLabel || t('common.cancel') }}
      </Button>
      <Button
        :variant="danger ? 'danger' : 'primary'"
        @click="onConfirm"
      >
        {{ confirmLabel || t('common.confirm') }}
      </Button>
    </template>
  </Dialog>
</template>
