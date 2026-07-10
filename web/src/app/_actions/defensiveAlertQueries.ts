import { createServiceClient } from '@/utils/supabase/service'

// ── 型定義 ──────────────────────────────────────────────────

export type EmailAlertStatus = 'sent' | 'failed' | 'not_sent'
export type AlertKeyType     = 'missing_input' | 'pending_notice'

export type MissingInputRow = {
  scheduleId:      string
  contractorId:    string
  contractorName:  string
  contractorPhone: string | null
  contractorEmail: string | null
  projectId:       string
  projectName:     string
  date:            string   // 'YYYY-MM-DD'
  emailStatus:     EmailAlertStatus
}

export type PendingNoticeRow = {
  noticeId:       string
  contractorId:   string
  contractorName: string
  phone:          string | null
  email:          string | null
  targetMonth:    string
  createdAt:      string
  hoursElapsed:   number
  projectNames:   string[]
  emailStatus:    EmailAlertStatus
}

// ── 純粋関数（alert_key・メール本文） ─────────────────────────
// cronルート・手動再送信ボタンの両方が同じ関数を使うことで、
// キー／本文の食い違い（＝emailStatusバッジの不整合）を防ぐ。

export function buildAlertKey(type: AlertKeyType, entityId: string): string {
  return `${type}:${entityId}`
}

export function buildMissingInputMessage(
  contractorName: string,
  projectName:    string,
  date:           string,
): string {
  return `${contractorName} 様\n\n${date}（${projectName}）の稼働実績がまだ入力されていません。お手数ですが、HIBIKIにログインし、実績の入力をお願いいたします。\n\n※本メールは自動送信です。`
}

export function buildPendingNoticeMessage(
  contractorName: string,
  targetMonth:    string,
): string {
  const ym = targetMonth.slice(0, 7)
  const [y, m] = ym.split('-')
  return `${contractorName} 様\n\n${y}年${m}月分の支払通知書がまだご確認（承認）いただけておりません。内容をご確認のうえ、承認手続きをお願いいたします。\n\n※本メールは自動送信です。`
}

// ── notification_logs 突き合わせ（emailStatus 判定） ─────────
// alert_key ごとに最新の status（created_at 降順の先頭）を採用する。
// 「既存レコードが1件でもあれば自動送信スキップ」の判定はこの
// emailStatus !== 'not_sent' で行う（呼び出し側＝cronルートが判定する）。

async function fetchEmailStatuses(
  db: any,
  alertKeys: string[],
): Promise<Map<string, EmailAlertStatus>> {
  if (!alertKeys.length) return new Map()

  const { data, error } = await db
    .from('notification_logs')
    .select('alert_key, status, created_at')
    .in('alert_key', alertKeys)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const map = new Map<string, EmailAlertStatus>()
  for (const row of (data ?? []) as any[]) {
    if (!map.has(row.alert_key)) {
      // 'delivered'（notification_logsのCHECK制約上は正当な値）も未送信バッジの
      // 誤判定を防ぐため 'sent' 扱いにする。現状この値を書き込む処理はまだないが、
      // 将来の書き込み元が増えても 'failed' に誤分類されないようにする防御的措置。
      map.set(row.alert_key, row.status === 'sent' || row.status === 'delivered' ? 'sent' : 'failed')
    }
  }
  return map
}

// ================================================================
// fetchMissingInputs
// ① 入力遅延: status='scheduled' かつ date<=本日 だが、同一 contractor_id×date の
// work_records が存在しない予定を返す。scheduleActions.getMissingInputs() から
// tenantId解決後に呼ばれる（管理画面用）ほか、cronルートからtenantIdを
// 横断的に渡して直接呼ばれる。
// ================================================================
export async function fetchMissingInputs(tenantId: string): Promise<MissingInputRow[]> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const firstOfMonth = `${today.slice(0, 7)}-01`

  const db = createServiceClient() as any

  const { data: schedules, error: sErr } = await db
    .from('schedules')
    .select(`
      id,
      contractor_id,
      project_id,
      date,
      contractors ( id, name, phone, email ),
      projects    ( id, project_name, name )
    `)
    .eq('status', 'scheduled')
    .gte('date', firstOfMonth)
    .lte('date', today)
    .eq('tenant_id', tenantId)
    .order('date', { ascending: false })

  if (sErr) throw new Error(sErr.message)
  if (!schedules?.length) return []

  const contractorIds: string[] = [...new Set((schedules as any[]).map((s: any) => s.contractor_id))]

  const { data: workRecords, error: wErr } = await db
    .from('work_records')
    .select('contractor_id, date, work_date')
    .in('contractor_id', contractorIds)
    .eq('tenant_id', tenantId)
    .lte('work_date', today)

  if (wErr) throw new Error(wErr.message)

  const workedSet = new Set(
    (workRecords ?? []).map((w: any) => {
      const recordDate = w.date ?? w.work_date
      return `${w.contractor_id}:${recordDate}`
    }),
  )

  const missing = (schedules as any[])
    .filter((s: any) => !workedSet.has(`${s.contractor_id}:${s.date}`))
    .map((s: any) => ({
      scheduleId:      s.id as string,
      contractorId:    s.contractor_id as string,
      contractorName:  s.contractors?.name ?? s.contractor_id,
      contractorPhone: s.contractors?.phone ?? null,
      contractorEmail: s.contractors?.email ?? null,
      projectId:       s.project_id as string,
      projectName:     s.projects?.project_name ?? s.projects?.name ?? s.project_id,
      date:            s.date as string,
    }))

  const keys      = missing.map(m => buildAlertKey('missing_input', m.scheduleId))
  const statusMap = await fetchEmailStatuses(db, keys)

  return missing.map(m => ({
    ...m,
    emailStatus: statusMap.get(buildAlertKey('missing_input', m.scheduleId)) ?? 'not_sent',
  }))
}

// ================================================================
// fetchLongPendingNotices
// ⑤ 長期未承認: 送信後48時間以上 approval_status='unapproved' の支払通知書。
// 🐛バグ修正: 従来 tenant_id フィルタが一切かかっていなかった
// （payment_notices自体にtenant_id列がないため、contractors!inner経由で絞り込む
// —— 既存の approvalActions.ts と同じパターン）。
// ================================================================
export async function fetchLongPendingNotices(tenantId: string): Promise<PendingNoticeRow[]> {
  const db = createServiceClient() as any

  const threshold = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from('payment_notices')
    .select(`
      id, contractor_id, notice_month, approval_status, created_at,
      contractors!inner ( id, name, phone, email, tenant_id )
    `)
    .eq('approval_status', 'unapproved')
    .eq('contractors.tenant_id', tenantId)
    .lt('created_at', threshold)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  if (!data?.length) return []

  const now = Date.now()
  const rows = await Promise.all(
    (data as any[]).map(async (r: any) => {
      const hoursElapsed = Math.floor(
        (now - new Date(r.created_at).getTime()) / (1000 * 60 * 60),
      )

      const noticeMonth: string = r.notice_month ?? ''
      const ym          = noticeMonth.slice(0, 7)
      const [y, m]       = ym.split('-').map(Number)
      const monthStart   = `${ym}-01`
      // 月末日をハードコード('-31')すると4/6/9/11月や2月で無効な日付になり、
      // Supabaseクエリが（errorチェックなしのため）静かに空配列を返してしまう。
      // Date.UTC(y, m, 0) は「翌月0日目」＝当月の末日を指すため常に正しい。
      const monthEnd     = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

      const { data: schedules } = await db
        .from('schedules')
        .select('projects ( project_name, name )')
        .eq('contractor_id', r.contractor_id)
        .gte('date', monthStart)
        .lte('date', monthEnd)

      const projectNames: string[] = [
        ...new Set(
          ((schedules ?? []) as any[])
            .map((s: any) => s.projects?.project_name ?? s.projects?.name)
            .filter(Boolean),
        ),
      ]

      return {
        noticeId:       r.id as string,
        contractorId:   r.contractor_id as string,
        contractorName: r.contractors?.name  ?? r.contractor_id,
        phone:          r.contractors?.phone ?? null,
        email:          r.contractors?.email ?? null,
        targetMonth:    noticeMonth,
        createdAt:      r.created_at as string,
        hoursElapsed,
        projectNames,
      }
    }),
  )

  const keys      = rows.map(r => buildAlertKey('pending_notice', r.noticeId))
  const statusMap = await fetchEmailStatuses(db, keys)

  return rows.map(r => ({
    ...r,
    emailStatus: statusMap.get(buildAlertKey('pending_notice', r.noticeId)) ?? 'not_sent',
  }))
}
