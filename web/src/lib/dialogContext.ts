export type DialogLayer = {
  id: number
  onEscape: () => void
  setInert: (inert: boolean) => void
}

let nextId = 1
const stack: DialogLayer[] = []
const appInertListeners = new Set<(inert: boolean) => void>()

/**
 * Reference-counted body scroll lock shared by every dialog layer (and the
 * AppShell drawer). Each acquire/release pair toggles `document.body` overflow
 * only when the count crosses zero, so nested dialogs and the drawer can
 * coexist without one layer's close unlocking the page while another is open.
 */
let scrollLockCount = 0

export function acquireBodyScrollLock(): void {
  if (typeof document === 'undefined') return
  scrollLockCount += 1
  if (scrollLockCount === 1) document.body.style.overflow = 'hidden'
}

export function releaseBodyScrollLock(): void {
  if (typeof document === 'undefined') return
  if (scrollLockCount === 0) return
  scrollLockCount -= 1
  if (scrollLockCount === 0) document.body.style.overflow = ''
}

/** Test helper — clears stacked dialogs between cases. */
export function resetDialogStack(): void {
  stack.length = 0
  scrollLockCount = 0
  if (typeof document !== 'undefined') document.body.style.overflow = ''
  publishAppInert()
}

export function onAppInertChange(listener: (inert: boolean) => void): () => void {
  appInertListeners.add(listener)
  return () => appInertListeners.delete(listener)
}

function publishAppInert(): void {
  const inert = stack.length > 0
  for (const listener of appInertListeners) listener(inert)
}

export function pushDialog(layer: Omit<DialogLayer, 'id'>): number {
  const id = nextId++
  const entry: DialogLayer = { id, ...layer }
  for (const existing of stack) {
    existing.setInert(true)
  }
  stack.push(entry)
  entry.setInert(false)
  acquireBodyScrollLock()
  publishAppInert()
  return id
}

export function popDialog(id: number): void {
  const index = stack.findIndex((layer) => layer.id === id)
  if (index < 0) return
  stack.splice(index, 1)
  const top = stack[stack.length - 1]
  for (const existing of stack) {
    existing.setInert(existing !== top)
  }
  releaseBodyScrollLock()
  publishAppInert()
}

export function handleGlobalEscape(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape') return false
  const top = stack[stack.length - 1]
  if (!top) return false
  event.preventDefault()
  event.stopPropagation()
  top.onEscape()
  return true
}

export function dialogDepth(): number {
  return stack.length
}