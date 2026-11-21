import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dialogDepth,
  handleGlobalEscape,
  popDialog,
  pushDialog,
  resetDialogStack,
} from '@/lib/dialogContext'

describe('dialog Escape nesting', () => {
  beforeEach(() => {
    resetDialogStack()
  })

  it('invokes only the topmost dialog Escape handler', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    const outerId = pushDialog({ onEscape: outer, setInert: vi.fn() })
    const innerId = pushDialog({ onEscape: inner, setInert: vi.fn() })

    expect(dialogDepth()).toBe(2)

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    const handled = handleGlobalEscape(event)

    expect(handled).toBe(true)
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()

    popDialog(innerId)
    handleGlobalEscape(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(outer).toHaveBeenCalledTimes(1)

    popDialog(outerId)
    expect(dialogDepth()).toBe(0)
  })

  it('marks lower layers inert while a dialog is open', () => {
    const outerInert = vi.fn()
    const innerInert = vi.fn()
    pushDialog({ onEscape: vi.fn(), setInert: outerInert })
    pushDialog({ onEscape: vi.fn(), setInert: innerInert })

    expect(outerInert).toHaveBeenCalledWith(true)
  })
})
