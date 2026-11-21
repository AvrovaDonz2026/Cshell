<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  createKey,
  deleteKey,
  fetchAvailableGroups,
  fetchKeys,
} from '@/api/keys'
import type { ApiGroup, ApiKey } from '@/api/types'
import { ApiError } from '@/api/types'
import Button from '@/components/primitives/Button.vue'
import ConfirmDialog from '@/components/primitives/ConfirmDialog.vue'
import Dialog from '@/components/primitives/Dialog.vue'
import Input from '@/components/primitives/Input.vue'
import Select from '@/components/primitives/Select.vue'

const { t } = useI18n()

const keys = ref<ApiKey[]>([])
const groups = ref<ApiGroup[]>([])
const loading = ref(true)
const error = ref('')
const createOpen = ref(false)
const name = ref('')
const groupId = ref('')
const creating = ref(false)
const createdKey = ref<ApiKey | null>(null)
const deleteTarget = ref<ApiKey | null>(null)
const deleting = ref(false)

const groupOptions = computed(() =>
  groups.value.map((g) => ({
    value: String(g.id),
    label: g.name,
  })),
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [list, available] = await Promise.all([
      fetchKeys(),
      fetchAvailableGroups(),
    ])
    keys.value = list.items || []
    groups.value = available || []
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  name.value = ''
  groupId.value = groups.value[0] ? String(groups.value[0].id) : ''
  createdKey.value = null
  createOpen.value = true
}

async function onCreate(): Promise<void> {
  if (!name.value.trim()) return
  creating.value = true
  error.value = ''
  try {
    const payload: { name: string; group_id?: number } = {
      name: name.value.trim(),
    }
    if (groupId.value) payload.group_id = Number(groupId.value)
    const key = await createKey(payload)
    createdKey.value = key
    await load()
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    creating.value = false
  }
}

async function onConfirmDelete(): Promise<void> {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteKey(deleteTarget.value.id)
    deleteTarget.value = null
    await load()
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page">
    <header class="page__head">
      <h1>{{ t('pages.keys') }}</h1>
      <Button @click="openCreate">
        {{ t('keys.create') }}
      </Button>
    </header>

    <p v-if="loading" role="status">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="error && !createOpen" class="error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="!keys.length" role="status">
      {{ t('keys.empty') }}
    </p>

    <ul v-else class="key-list">
      <li v-for="item in keys" :key="item.id" class="key-item">
        <div class="key-item__main">
          <h2 class="key-item__name">
            {{ item.name }}
          </h2>
          <p class="meta">
            {{ t('keys.status') }}: {{ item.status || '—' }}
          </p>
          <p class="meta">
            {{ t('keys.group') }}: {{ item.group?.name || item.group_id || '—' }}
          </p>
          <p class="meta">
            {{ t('keys.quota') }}:
            {{ item.quota_used ?? 0 }} / {{ item.quota ?? '—' }}
          </p>
          <p class="meta">
            {{ t('keys.created') }}: {{ item.created_at || '—' }}
          </p>
          <p class="meta">
            {{ t('keys.lastUsed') }}: {{ item.last_used_at || '—' }}
          </p>
        </div>
        <Button
          variant="danger"
          :disabled="deleting"
          @click="deleteTarget = item"
        >
          {{ t('common.delete') }}
        </Button>
      </li>
    </ul>

    <Dialog
      :open="createOpen"
      :title="t('keys.createTitle')"
      @close="createOpen = false"
    >
      <div class="create-form">
        <label>
          <span>{{ t('keys.name') }}</span>
          <Input v-model="name" required />
        </label>
        <label>
          <span>{{ t('keys.group') }}</span>
          <Select
            v-model="groupId"
            :options="groupOptions"
            :placeholder="t('keys.groupPlaceholder')"
          />
        </label>
        <p v-if="error && createOpen" class="error" role="alert">
          {{ error }}
        </p>
        <div v-if="createdKey?.key" class="created">
          <p>{{ t('keys.createdOnce') }}</p>
          <code class="created__key">{{ createdKey.key }}</code>
        </div>
      </div>
      <template #footer>
        <Button variant="secondary" @click="createOpen = false">
          {{ t('common.close') }}
        </Button>
        <Button
          :disabled="creating || Boolean(createdKey)"
          @click="onCreate"
        >
          {{ t('common.create') }}
        </Button>
      </template>
    </Dialog>

    <ConfirmDialog
      :open="Boolean(deleteTarget)"
      :title="t('keys.deleteTitle')"
      danger
      @confirm="onConfirmDelete"
      @close="deleteTarget = null"
    >
      <p>{{ t('keys.deleteConfirm') }}</p>
      <p v-if="deleteTarget" class="delete-name">
        {{ deleteTarget.name }}
      </p>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
}

.page__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.page h1 {
  margin: 0;
  font-size: 1.55rem;
}

.key-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.key-item {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: var(--cshell-radius-panel);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-border);
  min-width: 0;
}

.key-item__main {
  flex: 1 1 14rem;
  min-width: 0;
}

.key-item__name {
  margin: 0 0 0.4rem;
  font-size: 1rem;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.meta {
  margin: 0.15rem 0;
  color: var(--cshell-text-muted);
  font-size: 0.88rem;
  overflow-wrap: anywhere;
}

.create-form {
  display: grid;
  gap: 0.75rem;
}

.create-form label {
  display: grid;
  gap: 0.3rem;
}

.created {
  padding: 0.75rem;
  border-radius: var(--cshell-radius-control);
  background: var(--cshell-accent-soft);
}

.created__key {
  display: block;
  margin-top: 0.4rem;
  font-family: var(--cshell-font-mono);
  overflow-wrap: anywhere;
  word-break: break-all;
}

.delete-name {
  overflow-wrap: anywhere;
  word-break: break-word;
  font-weight: 600;
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}
</style>
