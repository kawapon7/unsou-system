import { describe, it, expect } from 'vitest'
import { shouldNotifyImmediately, buildImmediateMail, buildDigestMail, NOTIFY_SUPPRESS_MS } from './notify'
import type { ErrorEvent } from './types'

const base: ErrorEvent = {
  fingerprint: 'f', source: 'action', actionName: 'upsertSchedule', severity: 'critical',
  message: 'duplicate key', stack: null, path: null, tenantId: 't1', userId: 'u', contractorId: null,
}
const now = new Date('2026-09-02T03:00:00Z')

describe('shouldNotifyImmediately', () => {
  // 時間窓の抑制は DB の claim_error_notification（原子的）に移したため、ここは severity のみ見る
  it('normal は送らない', () => {
    expect(shouldNotifyImmediately({ ...base, severity: 'normal' })).toBe(false)
  })
  it('critical は送る', () => {
    expect(shouldNotifyImmediately(base)).toBe(true)
  })
  it('抑制窓の定数は60分', () => {
    expect(NOTIFY_SUPPRESS_MS).toBe(60 * 60 * 1000)
  })
})

describe('buildImmediateMail', () => {
  it('件名に action 名、本文に severity/tenant/count/message', () => {
    const m = buildImmediateMail(base, { id: 'i', count: 3, notifiedAt: null }, now)
    expect(m.subject).toContain('upsertSchedule')
    expect(m.text).toContain('critical')
    expect(m.text).toContain('t1')
    expect(m.text).toContain('3')
    expect(m.text).toContain('duplicate key')
  })
  it('message は 300 字で切る', () => {
    const m = buildImmediateMail({ ...base, message: 'x'.repeat(500) }, { id: 'i', count: 1, notifiedAt: null }, now)
    expect(m.text).not.toContain('x'.repeat(301))
  })
})

describe('buildDigestMail', () => {
  it('0件でも件名に 0件 と出す', () => {
    const m = buildDigestMail('2026-09-01', [])
    expect(m.subject).toContain('0件')
    expect(m.text).toContain('エラーはありませんでした')
  })
  it('行を列挙し message は 120 字で切る', () => {
    const m = buildDigestMail('2026-09-01', [
      { severity: 'critical', tenant_id: 't1', action_name: 'a', source: 'action', count: 7, message: 'y'.repeat(200) },
    ])
    expect(m.subject).toContain('1種')
    expect(m.subject).toContain('7件')
    expect(m.text).toContain('critical')
    expect(m.text).toContain('×7')
    expect(m.text).not.toContain('y'.repeat(121))
  })
})
