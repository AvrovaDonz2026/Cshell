<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref, WritableComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  buildCreateKeyPayload,
  buildUpdateKeyPayload,
  createKey,
  deleteKey,
  fetchAvailableGroups,
  fetchKeys,
  KeyInputError,
  updateKey,
  validateKeyExpiry,
  validateKeyGroupId,
  validateKeyQuota,
  validateIpList,
} from '@/api/keys'
import type { ApiGroup, ApiKey } from '@/api/types'
import { ApiError } from '@/api/types'
import Button from '@/components/primitives/Button.vue'
import ConfirmDialog from '@/components/primitives/ConfirmDialog.vue'
import Dialog from '@/components/primitives/Dialog.vue'
import Input from '@/components/primitives/Input.vue'
import Select from '@/components/primitives/Select.vue'
import TextArea from '@/components/primitives/TextArea.vue'

const { t } = useI18n()

type FieldKey = 'quota' | 'expiry' | 'ip' | 'group'

const keys = ref<ApiKey[]>([])
const groups = ref<ApiGroup[]>([])
const page = ref(1)
const pages = ref(1)
const statusFilter = ref('')
const loading = ref(true)
const error = ref('')

const createOpen = ref(false)
const name = ref('')
const groupId = ref('')
const quota = ref('')
const expiresInDays = ref('')
const ipWhitelist = ref('')
const ipBlacklist = ref('')
const creating = ref(false)
const createdKey = ref<ApiKey | null>(null)
const copied = ref(false)
const copyError = ref('')
let copyResetTimer: ReturnType<typeof setTimeout> | null = null

const editOpen = ref(false)
const editTarget = ref<ApiKey | null>(null)
const editName = ref('')
const editStatus = ref('')
const editOriginalStatus = ref('')
const editQuota = ref('')
const editWhitelist = ref('')
const editBlacklist = ref('')
const saving = ref(false)

const deleteTarget = ref<ApiKey | null>(null)
const deleting = ref(false)

const groupOptions = computed(() =>
  groups.value.map((g) => ({
    value: String(g.id),
    label: g.name,
  })),
)

const statusFilterOptions = computed(() => [
  { value: '', label: t('keys.filterAll') },
  { value: 'active', label: t('keys.statusActive') },
  { value: 'inactive', label: t('keys.statusInactive') },
])

/**
 * Status options keep `active`/`inactive`, then append the key's current
 * status verbatim when it is something else, so unknown values survive edits.
 */
const statusOptions = computed(() => {
  const options = [
    { value: 'active', label: t('keys.statusActive') },
    { value: 'inactive', label: t('keys.statusInactive') },
  ]
  const current = editStatus.value
  if (current && !options.some((opt) => opt.value === current)) {
    options.push({ value: current, label: current })
  }
  return options
})

function ipsToText(list: string[] | undefined): string {
  return (list || []).join('\n')
}

/** Number inputs emit numbers; keep the form models as trimmed strings. */
function numberModel(source: Ref<string>): WritableComputedRef<string> {
  return computed<string>({
    get: () => source.value,
    set: (value) => {
      source.value = value == null ? '' : String(value)
    },
  })
}

const quotaModel = numberModel(quota)
const expiresModel = numberModel(expiresInDays)
const editQuotaModel = numberModel(editQuota)

const createErrors = computed<Record<FieldKey, string>>(() => {
  const errors: Record<FieldKey, string> = {
    quota: '',
    expiry: '',
    ip: '',
    group: '',
  }

  try {
    validateKeyQuota(quota.value)
  } catch (err) {
    if (err instanceof KeyInputError) errors.quota = err.messageKey
  }

  try {
    validateKeyExpiry(expiresInDays.value)
  } catch (err) {
    if (err instanceof KeyInputError) errors.expiry = err.messageKey
  }

  try {
    validateIpList(ipWhitelist.value)
    validateIpList(ipBlacklist.value)
  } catch (err) {
    if (err instanceof KeyInputError) errors.ip = err.messageKey
  }

  try {
    validateKeyGroupId(groupId.value)
  } catch (err) {
    if (err instanceof KeyInputError) errors.group = err.messageKey
  }

  return errors
})

const createHasErrors = computed(() =>
  Object.values(createErrors.value).some(Boolean),
)

const createCanSubmit = computed(
  () => name.value.trim().length > 0 && !createHasErrors.value && !creating.value,
)

const editErrors = computed<Record<FieldKey, string>>(() => {
  const errors: Record<FieldKey, string> = {
    quota: '',
    expiry: '',
    ip: '',
    group: '',
  }

  try {
    validateKeyQuota(editQuota.value)
  } catch (err) {
    if (err instanceof KeyInputError) errors.quota = err.messageKey
  }

  try {
    validateIpList(editWhitelist.value)
    validateIpList(editBlacklist.value)
  } catch (err) {
    if (err instanceof KeyInputError) errors.ip = err.messageKey
  }

  return errors
})

const editHasErrors = computed(() =>
  Object.values(editErrors.value).some(Boolean),
)

function clearCopyTimer(): void {
  if (copyResetTimer) {
    clearTimeout(copyResetTimer)
    copyResetTimer = null
  }
}

async function load(nextPage = page.value): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [list, available] = await Promise.all([
      fetchKeys(nextPage, 20, {
        status: statusFilter.value || undefined,
      }),
      fetchAvailableGroups(),
    ])
    keys.value = list.items || []
    page.value = list.page || nextPage
    pages.value = Math.max(1, list.pages || 1)
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

watch(statusFilter, () => {
  void load(1)
})

function openCreate(): void {
  name.value = ''
  groupId.value = groups.value[0] ? String(groups.value[0].id) : ''
  quota.value = ''
  expiresInDays.value = ''
  ipWhitelist.value = ''
  ipBlacklist.value = ''
  createdKey.value = null
  copied.value = false
  copyError.value = ''
  clearCopyTimer()
  createOpen.value = true
}

function inputErrorMessage(err: unknown): string {
  if (err instanceof KeyInputError) return t(err.messageKey)
  if (err instanceof ApiError || err instanceof Error) return err.message
  return t('common.error')
}

async function onCreate(): Promise<void> {
  if (!name.value.trim()) return
  if (createHasErrors.value) return
  creating.value = true
  error.value = ''
  copied.value = false
  copyError.value = ''
  try {
    const payload = buildCreateKeyPayload({
      name: name.value,
      group_id: groupId.value,
      quota: quota.value,
      expires_in_days: expiresInDays.value,
      ip_whitelist: ipWhitelist.value,
      ip_blacklist: ipBlacklist.value,
    })
    const key = await createKey(payload)
    createdKey.value = key
    await load(1)
  } catch (err) {
    error.value = inputErrorMessage(err)
  } finally {
    creating.value = false
  }
}

function copyViaFallback(value: string): boolean {
  if (typeof document === 'undefined') return false
  const area = document.createElement('textarea')
  area.value = value
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(area)
  return ok
}

async function copyCreatedKey(): Promise<void> {
  const value = createdKey.value?.key
  if (!value) return
  let ok = false
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      ok = true
    } catch {
      ok = copyViaFallback(value)
    }
  } else {
    ok = copyViaFallback(value)
  }

  copied.value = ok
  copyError.value = ok ? '' : t('keys.copyFailed')
  clearCopyTimer()
  copyResetTimer = setTimeout(() => {
    copied.value = false
    copyError.value = ''
    copyResetTimer = null
  }, 2000)
}

function openEdit(item: ApiKey): void {
  editTarget.value = item
  editName.value = item.name
  // Preserve the stored status verbatim; unknown values are not coerced.
  editStatus.value = item.status ?? ''
  editOriginalStatus.value = item.status ?? ''
  editQuota.value = item.quota != null ? String(item.quota) : ''
  editWhitelist.value = ipsToText(item.ip_whitelist)
  editBlacklist.value = ipsToText(item.ip_blacklist)
  editOpen.value = true
}

async function onSaveEdit(): Promise<void> {
  if (!editTarget.value || !editName.value.trim()) return
  if (editHasErrors.value) return
  saving.value = true
  error.value = ''
  try {
    // Only send a status the user actually changed.
    const statusChanged = editStatus.value !== editOriginalStatus.value
    const payload = buildUpdateKeyPayload({
      name: editName.value,
      status: statusChanged ? editStatus.value : undefined,
      quota: editQuota.value,
      ip_whitelist: editWhitelist.value,
      ip_blacklist: editBlacklist.value,
    })
    await updateKey(editTarget.value.id, payload)
    editOpen.value = false
    editTarget.value = null
    await load(page.value)
  } catch (err) {
    error.value = inputErrorMessage(err)
  } finally {
    saving.value = false
  }
}

async function onConfirmDelete(): Promise<void> {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteKey(deleteTarget.value.id)
    deleteTarget.value = null
    await load(page.value)
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    deleting.value = false
  }
}

function ipListLength(list: string[] | undefined): number {
  return list?.length ?? 0
}

function quotaText(item: ApiKey): string {
  const used = item.quota_used ?? 0
  if (item.quota == null) return `${used} / —`
  return `${used} / ${item.quota}`
}

onMounted(() => {
  void load(1)
})

onBeforeUnmount(() => {
  clearCopyTimer()
})
</script>

<template>
  <div class="page">
    <header class="page__head">
      <div class="page__head-text">
        <h1>{{ t('pages.keys') }}</h1>
        <p class="page__subtitle">{{ t('keys.subtitle') }}</p>
      </div>
      <Button @click="openCreate">
        {{ t('keys.create') }}
      </Button>
    </header>

    <div class="toolbar">
      <label class="field">
        <span class="field__label">{{ t('keys.filter') }}</span>
        <Select
          v-model="statusFilter"
          :options="statusFilterOptions"
        />
      </label>
      <p class="toolbar__meta">
        {{ t('keys.page', { page, pages }) }}
      </p>
    </div>

    <p v-if="loading" role="status" class="state">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="error && !createOpen && !editOpen" class="error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="!keys.length" role="status" class="state">
      {{ t('keys.empty') }}
    </p>

    <section v-else class="list-panel" :aria-label="t('pages.keys')">
      <ul class="key-list">
        <li v-for="item in keys" :key="item.id" class="key-row">
          <div class="key-row__identity">
            <h2 class="key-row__name">
              {{ item.name }}
            </h2>
            <p class="meta">
              {{ t('keys.status') }}: {{ item.status || '—' }}
            </p>
          </div>

          <dl class="key-row__meta">
            <div class="meta-cell">
              <dt class="meta-cell__label">{{ t('keys.group') }}</dt>
              <dd class="meta-cell__value">
                {{ item.group?.name || item.group_id || '—' }}
              </dd>
            </div>
            <div class="meta-cell">
              <dt class="meta-cell__label">{{ t('keys.quotaUsed') }}</dt>
              <dd class="meta-cell__value">{{ quotaText(item) }}</dd>
            </div>
            <div class="meta-cell">
              <dt class="meta-cell__label">{{ t('keys.ipCountLabel') }}</dt>
              <dd class="meta-cell__value">
                {{ ipListLength(item.ip_whitelist) }} / {{ ipListLength(item.ip_blacklist) }}
              </dd>
            </div>
            <div class="meta-cell">
              <dt class="meta-cell__label">{{ t('keys.expires') }}</dt>
              <dd class="meta-cell__value">{{ item.expires_at || '—' }}</dd>
            </div>
            <div class="meta-cell">
              <dt class="meta-cell__label">{{ t('keys.created') }}</dt>
              <dd class="meta-cell__value">{{ item.created_at || '—' }}</dd>
            </div>
            <div class="meta-cell">
              <dt class="meta-cell__label">{{ t('keys.lastUsed') }}</dt>
              <dd class="meta-cell__value">{{ item.last_used_at || '—' }}</dd>
            </div>
          </dl>

          <p class="key-row__a11y">
            {{
              t('keys.ipCount', {
                allow: ipListLength(item.ip_whitelist),
                deny: ipListLength(item.ip_blacklist),
              })
            }}. {{ t('keys.quotaUsed') }}: {{ quotaText(item) }}
          </p>

          <div class="key-row__actions">
            <Button variant="secondary" @click="openEdit(item)">
              {{ t('keys.edit') }}
            </Button>
            <Button
              variant="danger"
              :disabled="deleting"
              @click="deleteTarget = item"
            >
              {{ t('common.delete') }}
            </Button>
          </div>
        </li>
      </ul>

      <div class="pager">
        <Button
          variant="secondary"
          :disabled="page <= 1 || loading"
          @click="load(page - 1)"
        >
          {{ t('common.prev') }}
        </Button>
        <span class="pager__status">
          {{ t('keys.page', { page, pages }) }}
        </span>
        <Button
          variant="secondary"
          :disabled="page >= pages || loading"
          @click="load(page + 1)"
        >
          {{ t('common.next') }}
        </Button>
      </div>
    </section>

    <Dialog
      :open="createOpen"
      :title="t('keys.createTitle')"
      @close="createOpen = false"
    >
      <div class="form">
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
          <span v-if="createErrors.group" class="field-error" role="alert">
            {{ t(createErrors.group) }}
          </span>
        </label>
        <label>
          <span>{{ t('keys.quota') }}</span>
          <Input v-model="quotaModel" type="number" min="0" step="any" />
          <span v-if="createErrors.quota" class="field-error" role="alert">
            {{ t(createErrors.quota) }}
          </span>
        </label>
        <label>
          <span>{{ t('keys.expiresInDays') }}</span>
          <Input v-model="expiresModel" type="number" min="1" step="1" />
          <span v-if="createErrors.expiry" class="field-error" role="alert">
            {{ t(createErrors.expiry) }}
          </span>
        </label>
        <label>
          <span>{{ t('keys.whitelist') }}</span>
          <TextArea
            v-model="ipWhitelist"
            :rows="3"
            :placeholder="t('keys.ipHint')"
          />
          <span v-if="createErrors.ip" class="field-error" role="alert">
            {{ t(createErrors.ip) }}
          </span>
        </label>
        <label>
          <span>{{ t('keys.blacklist') }}</span>
          <TextArea
            v-model="ipBlacklist"
            :rows="3"
            :placeholder="t('keys.ipHint')"
          />
          <span v-if="createErrors.ip" class="field-error" role="alert">
            {{ t(createErrors.ip) }}
          </span>
        </label>
        <p v-if="error && createOpen" class="error" role="alert">
          {{ error }}
        </p>
        <div v-if="createdKey?.key" class="created">
          <p>{{ t('keys.createdOnce') }}</p>
          <code class="created__key">{{ createdKey.key }}</code>
          <Button variant="secondary" @click="copyCreatedKey">
            {{ copied ? t('keys.copied') : t('keys.copy') }}
          </Button>
          <p v-if="copyError" class="error" role="alert">
            {{ copyError }}
          </p>
        </div>
      </div>
      <template #footer>
        <Button variant="secondary" @click="createOpen = false">
          {{ t('common.close') }}
        </Button>
        <Button
          :disabled="creating || Boolean(createdKey) || !createCanSubmit"
          @click="onCreate"
        >
          {{ t('common.create') }}
        </Button>
      </template>
    </Dialog>

    <Dialog
      :open="editOpen"
      :title="t('keys.editTitle')"
      @close="editOpen = false"
    >
      <div class="form">
        <label>
          <span>{{ t('keys.name') }}</span>
          <Input v-model="editName" required />
        </label>
        <label>
          <span>{{ t('keys.status') }}</span>
          <Select v-model="editStatus" :options="statusOptions" />
        </label>
        <label>
          <span>{{ t('keys.quota') }}</span>
          <Input v-model="editQuotaModel" type="number" min="0" step="any" />
          <span v-if="editErrors.quota" class="field-error" role="alert">
            {{ t(editErrors.quota) }}
          </span>
        </label>
        <label>
          <span>{{ t('keys.whitelist') }}</span>
          <TextArea
            v-model="editWhitelist"
            :rows="3"
            :placeholder="t('keys.ipHint')"
          />
          <span v-if="editErrors.ip" class="field-error" role="alert">
            {{ t(editErrors.ip) }}
          </span>
        </label>
        <label>
          <span>{{ t('keys.blacklist') }}</span>
          <TextArea
            v-model="editBlacklist"
            :rows="3"
            :placeholder="t('keys.ipHint')"
          />
          <span v-if="editErrors.ip" class="field-error" role="alert">
            {{ t(editErrors.ip) }}
          </span>
        </label>
        <p v-if="error && editOpen" class="error" role="alert">
          {{ error }}
        </p>
      </div>
      <template #footer>
        <Button variant="secondary" @click="editOpen = false">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="saving || editHasErrors" @click="onSaveEdit">
          {{ t('common.save') }}
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
  gap: 1.4rem;
  min-width: 0;
    max-width: 100%;
  overflow-x: hidden;
}

.page__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.page__head-text {
  display: grid;
  gap: 0.3rem;
}

.page h1 {
  margin: 0;
  font-size: 1.7rem;
  letter-spacing: -0.01em;
}

.page__subtitle {
  margin: 0;
  font-size: 0.94rem;
  color: var(--cshell-text-muted);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-bg-elevated);
}

.field {
  display: grid;
  gap: 0.3rem;
  min-width: min(100%, 12rem);
}

.field__label {
  font-size: 0.8rem;
  color: var(--cshell-text-muted);
}

.toolbar__meta {
  margin: 0 0 0.5rem;
  font-size: 0.84rem;
  color: var(--cshell-text-muted);
}

.list-panel {
  display: grid;
  gap: 0.9rem;
  min-width: 0;
}

.key-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  overflow: hidden;
}

.key-row {
  display: grid;
  grid-template-columns: minmax(11rem, 1fr) minmax(0, 2.6fr) auto;
  align-items: start;
  gap: 1rem;
  padding: 1rem 1.15rem;
  border-bottom: 1px solid var(--cshell-border);
  min-width: 0;
}

.key-row:last-child {
  border-bottom: 0;
}

.key-row__identity {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.key-row__name {
  margin: 0;
  font-size: 0.98rem;
  overflow-wrap: anywhere;
}

.key-row__meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem 1rem;
  margin: 0;
  min-width: 0;
}

.meta-cell {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.meta-cell__label {
  font-size: 0.72rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--cshell-text-muted);
}

.meta-cell__value {
  margin: 0;
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.key-row__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem;
}

.key-row__a11y {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.meta {
  margin: 0;
  color: var(--cshell-text-muted);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
}

.pager__status {
  font-size: 0.86rem;
  color: var(--cshell-text-muted);
}

.state {
  margin: 0;
  color: var(--cshell-text-muted);
}

.form {
  display: grid;
  gap: 0.75rem;
}

.form label {
  display: grid;
  gap: 0.3rem;
}

.created {
  display: grid;
  gap: 0.55rem;
  padding: 0.75rem;
  border-radius: var(--cshell-radius-control);
  background: var(--cshell-accent-soft);
}

.created__key {
  display: block;
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

.field-error {
  margin: 0;
  color: var(--cshell-danger);
  font-size: 0.8rem;
}

@media (max-width: 900px) {
  .key-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .key-row__meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .key-row__actions {
    justify-content: flex-start;
  }
}

@media (min-width: 640px) {
  .key-row__actions :deep(.cshell-btn) {
    min-width: 5rem;
  }
}
</style>
