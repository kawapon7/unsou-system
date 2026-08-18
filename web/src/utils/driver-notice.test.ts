import { describe, it, expect } from 'vitest'
import { parseAlertKey, buildDriverNotice, isDriverFacing } from './driver-notice'

describe('parseAlertKey', () => {
  it('種別と対象IDに分ける', () => {
    expect(parseAlertKey('missing_input:eb2b2ff7-93a0-44e9-bbbe-552641592b19'))
      .toEqual({ kind: 'missing_input', targetId: 'eb2b2ff7-93a0-44e9-bbbe-552641592b19' })
  })

  it('null や壊れた値でも例外にしない', () => {
    expect(parseAlertKey(null)).toEqual({ kind: '', targetId: '' })
    expect(parseAlertKey('こわれた')).toEqual({ kind: 'こわれた', targetId: '' })
  })
})

describe('isDriverFacing', () => {
  it('未入力の催促はドライバー向け', () => {
    expect(isDriverFacing('missing_input')).toBe(true)
  })

  it('未承認の通知書はドライバー向け', () => {
    expect(isDriverFacing('pending_notice')).toBe(true)
  })

  it('荷主の入金遅延はドライバーに見せない（親分の話）', () => {
    expect(isDriverFacing('overdue_invoice')).toBe(false)
  })

  it('知らない種別は見せない（fail-closed）', () => {
    expect(isDriverFacing('unknown_kind')).toBe(false)
    expect(isDriverFacing('')).toBe(false)
  })
})

describe('buildDriverNotice', () => {
  it('未入力: 日付と案件名を文面に入れる', () => {
    expect(buildDriverNotice('missing_input', { date: '2026-07-25', projectName: '城北エリア食品配送' }))
      .toEqual({
        title: '稼働実績が未入力です',
        body:  '7/25（城北エリア食品配送）の実績がまだ入力されていません。予定・実績から入力してください。',
        href:  '/driver/schedule',
      })
  })

  it('未入力: 案件名が取れないときは日付だけで出す（空欄にしない）', () => {
    expect(buildDriverNotice('missing_input', { date: '2026-07-25' }).body)
      .toBe('7/25 の実績がまだ入力されていません。予定・実績から入力してください。')
  })

  it('未承認: 対象月を文面に入れる', () => {
    expect(buildDriverNotice('pending_notice', { noticeMonth: '2026-07-01' }))
      .toEqual({
        title: '支払通知書の確認をお願いします',
        body:  '2026年7月分の支払通知書が未承認です。金額をご確認ください。',
        href:  '/driver/billing',
      })
  })

  it('詳細が何も取れなくても文面を返す（空のお知らせを出さない）', () => {
    expect(buildDriverNotice('missing_input', {}).body)
      .toBe('稼働実績が未入力の日があります。予定・実績からご確認ください。')
  })
})
