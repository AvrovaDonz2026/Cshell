import { describe, expect, it } from 'vitest'
import { unwrapEnvelope } from '@/api/client'
import { ApiError } from '@/api/types'

describe('unwrapEnvelope', () => {
  it('returns data when code is 0', () => {
    const data = unwrapEnvelope<{ ok: boolean }>({
      code: 0,
      message: 'ok',
      data: { ok: true },
    })
    expect(data).toEqual({ ok: true })
  })

  it('throws ApiError for non-zero code', () => {
    expect(() =>
      unwrapEnvelope({ code: 401, message: 'denied', data: null }),
    ).toThrow(ApiError)
  })

  it('throws on malformed payloads', () => {
    expect(() => unwrapEnvelope(null)).toThrow(ApiError)
    expect(() => unwrapEnvelope({ message: 'missing code' })).toThrow(ApiError)
  })
})
