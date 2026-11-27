import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'cshell_theme'

function readInitial(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'light'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return 'light'
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readInitial())
  const isDark = computed(() => mode.value === 'dark')

  function applyDom(): void {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.theme = mode.value
    document.body.dataset.theme = mode.value
  }

  function setMode(next: ThemeMode): void {
    if (next !== 'light' && next !== 'dark') return
    mode.value = next
    applyDom()
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next)
  }

  function toggle(): void {
    setMode(mode.value === 'dark' ? 'light' : 'dark')
  }

  watch(
    mode,
    (value) => {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, value)
      }
      applyDom()
    },
    { immediate: true },
  )

  return { mode, isDark, setMode, toggle, applyDom }
})
