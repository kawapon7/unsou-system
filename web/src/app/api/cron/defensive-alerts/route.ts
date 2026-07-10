import { NextRequest, NextResponse } from 'next/server'
import { getAllTenantIds } from '@/utils/tenant'
import {
  fetchMissingInputs,
  fetchLongPendingNotices,
  buildAlertKey,
  buildMissingInputMessage,
  buildPendingNoticeMessage,
} from '@/app/_actions/defensiveAlertQueries'
import { deliverAlertEmail } from '@/app/_actions/emailActions'

type AlertJob = {
  contractorId: string
  alertKey:     string
  alertType:    'missing_input' | 'pending_notice'
  message:      string
  tenantId:     string
}

// ── Route Handler ─────────────────────────────────────────
// GitHub Actions（毎日 JST 9:00）から x-cron-secret ヘッダー付きで呼ばれる。
// fail-closed: シークレット不一致・未設定の場合は DB・メール処理を一切行わない。

export async function GET(req: NextRequest) {
  const secret   = req.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let tenantIds: string[]
  try {
    tenantIds = await getAllTenantIds()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const jobs: AlertJob[] = []

  try {
    for (const tenantId of tenantIds) {
      const [missing, pending] = await Promise.all([
        fetchMissingInputs(tenantId),
        fetchLongPendingNotices(tenantId),
      ])

      for (const m of missing) {
        if (m.emailStatus !== 'not_sent') continue
        jobs.push({
          contractorId: m.contractorId,
          alertKey:     buildAlertKey('missing_input', m.scheduleId),
          alertType:    'missing_input',
          message:      buildMissingInputMessage(m.contractorName, m.projectName, m.date),
          tenantId,
        })
      }

      for (const p of pending) {
        if (p.emailStatus !== 'not_sent') continue
        jobs.push({
          contractorId: p.contractorId,
          alertKey:     buildAlertKey('pending_notice', p.noticeId),
          alertType:    'pending_notice',
          message:      buildPendingNoticeMessage(p.contractorName, p.targetMonth),
          tenantId,
        })
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  let sent   = 0
  let failed = 0
  const errors: string[] = []

  for (const job of jobs) {
    const result = await deliverAlertEmail(job)
    if (result.error !== null) {
      failed++
      errors.push(`${job.alertKey}: ${result.error}`)
      continue
    }
    if (result.data.status === 'sent') sent++
    else failed++
  }

  return NextResponse.json({
    tenantsProcessed: tenantIds.length,
    candidates:       jobs.length,
    sent,
    failed,
    errors,
  })
}
