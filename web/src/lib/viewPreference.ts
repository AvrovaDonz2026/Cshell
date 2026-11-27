export type TrendViewMode = 'heatmap' | 'line'

const VALID: TrendViewMode[] = ['heatmap', 'line']

/**
 * Read a persisted heatmap/line view preference. Defaults to 'heatmap'
 * and ignores anything unrecognized or unavailable (SSR, storage blocked).
 */
export function loadTrendViewMode(key: string): TrendViewMode {
  try {
    const stored = globalThis.localStorage?.getItem(key)
    return VALID.includes(stored as TrendViewMode)
      ? (stored as TrendViewMode)
      : 'heatmap'
  } catch {
    return 'heatmap'
  }
}

/** Persist the view choice; failures (private mode, quota) are non-fatal. */
export function saveTrendViewMode(key: string, mode: TrendViewMode): void {
  try {
    globalThis.localStorage?.setItem(key, mode)
  } catch {
    // Storage unavailable — the in-session ref still works.
  }
}
