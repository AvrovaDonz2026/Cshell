export interface PopupPositionOptions {
  minWidth?: number
  maxHeight?: number
  gap?: number
  viewportPadding?: number
}

export function getPopupPosition(
  trigger: DOMRect,
  popupHeight: number,
  options: PopupPositionOptions = {},
): Record<string, string> {
  const { minWidth = 192, maxHeight = 280, gap = 4, viewportPadding = 8 } = options
  const viewport = window.visualViewport
  const leftEdge = viewport?.offsetLeft ?? 0
  const topEdge = viewport?.offsetTop ?? 0
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight
  const rightEdge = leftEdge + width
  const bottomEdge = topEdge + height
  const left = Math.max(leftEdge + viewportPadding, Math.min(trigger.left, rightEdge - viewportPadding - Math.max(trigger.width, minWidth)))
  const popupWidth = Math.max(Math.min(minWidth, width - viewportPadding * 2), Math.min(trigger.width, width - viewportPadding * 2))
  const belowSpace = bottomEdge - trigger.bottom - gap - viewportPadding
  const aboveSpace = trigger.top - topEdge - gap - viewportPadding
  const flip = belowSpace < Math.min(popupHeight, maxHeight) && aboveSpace > belowSpace
  const available = Math.max(0, flip ? aboveSpace : belowSpace)
  return {
    position: 'fixed',
    top: `${Math.round(flip ? Math.max(topEdge + viewportPadding, trigger.top - gap - Math.min(popupHeight, maxHeight, available)) : trigger.bottom + gap)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(popupWidth)}px`,
    maxHeight: `${Math.round(Math.min(maxHeight, available))}px`,
    overflow: 'auto',
  }
}
