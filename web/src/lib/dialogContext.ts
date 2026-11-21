export type DialogLayer = {
  id: number
  onEscape: () => void
  setInert: (inert: boolean) => void
}

let nextId = 1
const stack: DialogLayer[] = []
const appInertListeners = new Set<(inert: boolean) => void>()

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

/** Test helper — clears stacked dialogs between cases. */
export function resetDialogStack(): void {
  stack.length = 0
  publishAppInert()
}
