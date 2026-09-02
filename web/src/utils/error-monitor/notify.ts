import type { ErrorEvent, ErrorRecordResult } from './types'

/** 同一指紋の即時メールは60分に1通。spec §6 */
export const NOTIFY_SUPPRESS_MS = 60 * 60 * 1000

export type DigestRow = {
  severity:    string
  tenant_id:   string
  action_name: string
  source:      string
  count:       number
  message:     string
}

export function shouldNotifyImmediately(e: ErrorEvent, r: ErrorRecordResult, now: Date = new Date()): boolean {
  if (e.severity !== 'critical') return false
  if (!r.notifiedAt) return true
  return now.getTime() - new Date(r.notifiedAt).getTime() > NOTIFY_SUPPRESS_MS
}

export function buildImmediateMail(e: ErrorEvent, r: ErrorRecordResult, now: Date = new Date()): { subject: string; text: string } {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
  return {
    subject: `【HIBIKI】エラー検知: ${e.actionName}`,
    text: [
      `HIBIKI 本番でエラーを検知しました。`,
      ``,
      `action   : ${e.actionName} (${e.source})`,
      `severity : ${e.severity}`,
      `tenant   : ${e.tenantId ?? '(none)'}`,
      `時刻(JST) : ${jst}`,
      `当日件数 : ${r.count}`,
      `path     : ${e.path ?? '-'}`,
      ``,
      `message:`,
      e.message.slice(0, 300),
      ``,
      `※ 同一エラーの即時通知は60分に1通に抑制されます。詳細は Supabase の error_logs を確認してください。`,
    ].join('\n'),
  }
}

export function buildDigestMail(day: string, rows: DigestRow[]): { subject: string; text: string } {
  const total = rows.reduce((s, r) => s + r.count, 0)
  if (rows.length === 0) {
    return { subject: `【HIBIKI】エラー日次まとめ ${day}: 0件`, text: `${day} のエラーはありませんでした。（監視は稼働中）` }
  }
  const subject = `【HIBIKI】エラー日次まとめ ${day}: ${rows.length}種 / ${total}件`
  const lines = rows.map((r) =>
    `[${r.severity}] ${r.action_name} (${r.source}) tenant=${r.tenant_id} ×${r.count}\n    ${r.message.slice(0, 120)}`,
  )
  return { subject, text: [`${day} に発生したエラー（種類別・件数順）`, ``, ...lines].join('\n') }
}
