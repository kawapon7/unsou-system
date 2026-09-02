import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/service'
import { capturedRoute } from '@/utils/error-monitor/captured'
import { buildDigestMail, type DigestRow } from '@/utils/error-monitor/notify'
import { sendAdminAlertEmail } from '@/app/_actions/emailCore'

/** error_logs の保持日数。spec §5 */
const RETENTION_DAYS = 90

/** JST 基準の「前日」を YYYY-MM-DD で返す */
function yesterdayJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000)
  jst.setUTCDate(jst.getUTCDate() - 1)
  return jst.toISOString().slice(0, 10)
}

// GitHub Actions（毎日 JST 9:00、defensive-alerts と同じ workflow）から x-cron-secret 付きで呼ばれる。
// fail-closed: シークレット不一致・未設定なら何もしない。
// 0件でも「0件」を送る（監視が生きていることの確認）。
async function handleGet(req: NextRequest) {
  const secret   = req.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db  = createServiceClient() as any
  const day = yesterdayJst()

  const { data, error } = await db
    .from('error_logs')
    .select('severity, tenant_id, action_name, source, count, message')
    .eq('day', day)
    .order('count', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as DigestRow[]
  const mail = buildDigestMail(day, rows)
  const sent = await sendAdminAlertEmail(mail.subject, mail.text)

  // 保持期限超の削除。失敗しても日次メールの結果は返す
  let purged: number | null = null
  try {
    const { data: n, error: pErr } = await db.rpc('purge_error_logs', { p_days: RETENTION_DAYS })
    purged = pErr ? null : (n as number)
  } catch { purged = null }

  return NextResponse.json({ day, groups: rows.length, sent: sent.ok, sendError: sent.ok ? null : sent.error, purged })
}

export const GET = capturedRoute('cron/error-digest', handleGet, 'cron')
