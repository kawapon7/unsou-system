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
})

describe('SupabaseSink.claimNotification', () => {
  it('claim_error_notification を秒に換算した窓で呼び、結果を返す', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const ok = await new SupabaseSink(rpc).claimNotification('id1', 60 * 60 * 1000)
    expect(rpc).toHaveBeenCalledWith('claim_error_notification', { p_id: 'id1', p_window_seconds: 3600 })
    expect(ok).toBe(true)
  })
  it('false が返れば false', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    expect(await new SupabaseSink(rpc).claimNotification('id1', 1000)).toBe(false)
  })
  it('ミリ秒は切り上げる', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await new SupabaseSink(rpc).claimNotification('id1', 1500)
    expect(rpc).toHaveBeenCalledWith('claim_error_notification', { p_id: 'id1', p_window_seconds: 2 })
  })
  it('RPC エラーは throw', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(new SupabaseSink(rpc).claimNotification('id1', 1000)).rejects.toThrow('boom')
  })
})

describe('SupabaseSink.releaseNotification', () => {
  it('release_error_notification を呼ぶ', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    await new SupabaseSink(rpc).releaseNotification('id1')
    expect(rpc).toHaveBeenCalledWith('release_error_notification', { p_id: 'id1' })
  })
  it('RPC エラーは throw', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(new SupabaseSink(rpc).releaseNotification('id1')).rejects.toThrow('boom')
  })
})
