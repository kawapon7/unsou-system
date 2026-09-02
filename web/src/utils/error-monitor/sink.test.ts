import { describe, it, expect, vi } from 'vitest'
import { SupabaseSink, NULL_TENANT_ID, jstDay } from './sink'
import type { ErrorEvent } from './types'

const ev: ErrorEvent = {
  fingerprint: 'f', source: 'action', actionName: 'a', severity: 'normal',
  message: 'm', stack: null, path: null, tenantId: null, userId: null, contractorId: null,
}

describe('jstDay', () => {
  it('UTC 15:00 は JST 翌日', () => {
    expect(jstDay(new Date('2026-09-02T15:00:00Z'))).toBe('2026-09-03')
    expect(jstDay(new Date('2026-09-02T14:59:59Z'))).toBe('2026-09-02')
  })
})

describe('SupabaseSink.record', () => {
  it('record_error_log を呼び、tenant NULL は固定値に写像する', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'id1', count: 3, notified_at: null }], error: null })
    const sink = new SupabaseSink(rpc)
    const r = await sink.record(ev)
    expect(rpc).toHaveBeenCalledWith('record_error_log', expect.objectContaining({
      p_fingerprint: 'f', p_tenant_id: NULL_TENANT_ID, p_source: 'action', p_action_name: 'a',
    }))
    expect(r).toEqual({ id: 'id1', count: 3, notifiedAt: null })
  })
  it('RPC エラーは throw', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(new SupabaseSink(rpc).record(ev)).rejects.toThrow('boom')
  })
  it('markNotified は mark_error_notified を呼ぶ', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    await new SupabaseSink(rpc).markNotified('id1')
    expect(rpc).toHaveBeenCalledWith('mark_error_notified', { p_id: 'id1' })
  })
})
