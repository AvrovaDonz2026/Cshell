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
    document.body.style.overflow = ''
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

  it('locks body scroll while a dialog is open and restores it after close', () => {
    expect(document.body.style.overflow).toBe('')

    const outerId = pushDialog({ onEscape: vi.fn(), setInert: vi.fn() })
    expect(document.body.style.overflow).toBe('hidden')

    popDialog(outerId)
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps the lock under nested open/close order', () => {
    const outerId = pushDialog({ onEscape: vi.fn(), setInert: vi.fn() })
    expect(document.body.style.overflow).toBe('hidden')

    const innerId = pushDialog({ onEscape: vi.fn(), setInert: vi.fn() })
    expect(document.body.style.overflow).toBe('hidden')

    // Closing the inner dialog must not unlock while the outer stays open.
    popDialog(innerId)
    expect(document.body.style.overflow).toBe('hidden')

    // Closing the outer dialog finally restores scrolling.
    popDialog(outerId)
    expect(document.body.style.overflow).toBe('')
  })

  it('restores the lock when dialogs close out of order', () => {
    const outerId = pushDialog({ onEscape: vi.fn(), setInert: vi.fn() })
    const innerId = pushDialog({ onEscape: vi.fn(), setInert: vi.fn() })
    expect(document.body.style.overflow).toBe('hidden')

    // The outer closes first (e.g. unmounted mid-session); the inner is open.
    popDialog(outerId)
    expect(document.body.style.overflow).toBe('hidden')

    popDialog(innerId)
    expect(document.body.style.overflow).toBe('')
  })
})
