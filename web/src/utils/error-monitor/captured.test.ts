import { describe, it, expect, vi } from 'vitest'
import { captured, capturedRoute, GENERIC_ERROR_MESSAGE, type Deps } from './captured'
import type { ErrorSink } from './types'

function makeDeps(over: Partial<Deps> = {}): Deps & { sink: ErrorSink & { record: ReturnType<typeof vi.fn>; markNotified: ReturnType<typeof vi.fn> } } {
  const sink = {
    record: vi.fn().mockResolvedValue({ id: 'i', count: 1, notifiedAt: null }),
    markNotified: vi.fn().mockResolvedValue(undefined),
  }
  return { sink, send: vi.fn().mockResolvedValue({ ok: true }), isProduction: true, ...over } as unknown as Deps & { sink: ErrorSink & { record: ReturnType<typeof vi.fn>; markNotified: ReturnType<typeof vi.fn> } }
}

describe('captured', () => {
  it('正常は透過し記録しない', async () => {
    const d = makeDeps()
    const r = await captured('listUsers', async () => ({ data: [1], error: null }), undefined, d)
    expect(r).toEqual({ data: [1], error: null })
    expect(d.sink.record).not.toHaveBeenCalled()
  })
  it('業務 {error} は透過し記録しない', async () => {
    const d = makeDeps()
    const r = await captured('listUsers', async () => ({ data: null, error: '委託先が見つかりません' }), undefined, d)
    expect(r).toEqual({ data: null, error: '委託先が見つかりません' })
    expect(d.sink.record).not.toHaveBeenCalled()
  })
  it('システム {error} は透過し記録する（message はマスク済み）', async () => {
    const d = makeDeps()
    const r = await captured('listUsers', async () => ({ data: null, error: 'duplicate key 1234567 a@b.jp' }), { tenantId: 't1' }, d)
    expect(r).toEqual({ data: null, error: 'duplicate key 1234567 a@b.jp' })
    expect(d.sink.record).toHaveBeenCalledTimes(1)
    const ev = d.sink.record.mock.calls[0][0]
    expect(ev.message).toBe('duplicate key [digits] ***@b.jp')
    expect(ev.tenantId).toBe('t1')
    expect(ev.severity).toBe('normal')
  })
  it('例外は固定文言に変換して記録する', async () => {
    const d = makeDeps()
    const r = await captured('upsertSchedule', async () => { throw new Error('connection refused') }, undefined, d)
    expect(r).toEqual({ data: null, error: GENERIC_ERROR_MESSAGE })
    expect(d.sink.record.mock.calls[0][0].severity).toBe('critical')
  })
  it('critical 例外は即時メールを送り markNotified する', async () => {
    const d = makeDeps()
    await captured('upsertSchedule', async () => { throw new Error('x') }, undefined, d)
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.sink.markNotified).toHaveBeenCalledWith('i')
  })
  it('60分以内に通知済みなら送らない', async () => {
    const d = makeDeps()
    d.sink.record.mockResolvedValue({ id: 'i', count: 2, notifiedAt: new Date().toISOString() })
    await captured('upsertSchedule', async () => { throw new Error('x') }, undefined, d)
    expect(d.send).not.toHaveBeenCalled()
  })
  it('production でなければ記録はするがメールは送らない', async () => {
    const d = makeDeps({ isProduction: false })
    await captured('upsertSchedule', async () => { throw new Error('x') }, undefined, d)
    expect(d.sink.record).toHaveBeenCalledTimes(1)
    expect(d.send).not.toHaveBeenCalled()
  })
  it('Next の redirect/notFound は再スローする（記録しない）', async () => {
    const d = makeDeps()
    const redirectErr = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/admin;307;' })
    await expect(captured('login', async () => { throw redirectErr }, undefined, d)).rejects.toBe(redirectErr)
    expect(d.sink.record).not.toHaveBeenCalled()
  })
  it('sink が例外を投げても戻り値は変わらない', async () => {
    const d = makeDeps()
    d.sink.record.mockRejectedValue(new Error('db down'))
    const r = await captured('upsertSchedule', async () => { throw new Error('x') }, undefined, d)
    expect(r).toEqual({ data: null, error: GENERIC_ERROR_MESSAGE })
    const r2 = await captured('listUsers', async () => ({ data: null, error: 'PGRST301' }), undefined, d)
    expect(r2).toEqual({ data: null, error: 'PGRST301' })
  })
})

describe('capturedRoute', () => {
  it('例外を記録し 500 JSON を返す。cron は critical', async () => {
    const d = makeDeps()
    const h = capturedRoute('cron/defensive-alerts', async () => { throw new Error('boom') }, 'cron', d)
    const res = await h()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE })
    expect(d.sink.record.mock.calls[0][0]).toMatchObject({ source: 'cron', severity: 'critical', actionName: 'cron/defensive-alerts' })
  })
  it('正常は透過', async () => {
    const d = makeDeps()
    const h = capturedRoute('x', async () => new Response('ok'), 'route', d)
    expect(await (await h()).text()).toBe('ok')
    expect(d.sink.record).not.toHaveBeenCalled()
  })
})
