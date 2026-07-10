import { describe, it, expect } from 'vitest'
import {
  buildAlertKey,
  buildMissingInputMessage,
  buildPendingNoticeMessage,
} from './defensiveAlertQueries'

describe('buildAlertKey', () => {
  it('builds a missing_input key from a schedule id', () => {
    expect(buildAlertKey('missing_input', 'sched-123')).toBe('missing_input:sched-123')
  })

  it('builds a pending_notice key from a notice id', () => {
    expect(buildAlertKey('pending_notice', 'notice-456')).toBe('pending_notice:notice-456')
  })
})

describe('buildMissingInputMessage', () => {
  it('includes contractor name, project name, and date', () => {
    const msg = buildMissingInputMessage('山田太郎', '△△案件', '2026-07-10')
    expect(msg).toContain('山田太郎')
    expect(msg).toContain('△△案件')
    expect(msg).toContain('2026-07-10')
  })
})

describe('buildPendingNoticeMessage', () => {
  it('formats the target month as YYYY年MM月分', () => {
    const msg = buildPendingNoticeMessage('山田太郎', '2026-06-01')
    expect(msg).toContain('山田太郎')
    expect(msg).toContain('2026年06月分')
  })
})
