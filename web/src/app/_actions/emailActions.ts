'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'
import { logNotification } from './scheduleActions'
import {
  buildAlertKey,
  buildMissingInputMessage,
  buildPendingNoticeMessage,
} from './defensiveAlertQueries'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

// ⚠️ HIBIKI_OWNER_EMAILS 未設定時は特権メールなし（fail-closed）。.env.local に設定すること。
const TEMP_OWNER_EMAILS = (process.env.HIBIKI_OWNER_EMAILS ?? '')
  .split(',').map(e => e.trim()).filter(Boolean)

const ALERT_SUBJECTS: Record<string, string> = {
  missing_input:   '【HIBIKI】稼働実績の入力をお願いします',
  pending_notice:  '【HIBIKI】支払通知書のご確認をお願いします',
  threshold:       '【HIBIKI】稼働実績の確認をお願いします',
  duplicate:       '【HIBIKI】実績データの重複について',
  invoice_warning: '【HIBIKI】インボイス登録番号のご確認',
}

async function requireMasterAccess(): Promise<ActionResult<{ userId: string }>> {
  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    return { data: { userId: 'dev-master' }, error: null }
  }

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '認証が必要です' }

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role = TEMP_OWNER_EMAILS.includes(user.email ?? '')
    ? 'master'
    : (userData?.role ?? user.user_metadata?.role)

  if (role !== 'master') {
    return { data: null, error: '管理者権限が必要です' }
  }

  return { data: { userId: user.id }, error: null }
}

async function sendViaResend(
  to: string,
  subject: string,
  text: string,
): Promise<{ messageId: string } | { error: string }> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    console.warn('[emailActions] RESEND_API_KEY が未設定です — 開発フォールバック（コンソール出力）')
    console.log('[emailActions] メール送信（モック）:', { to, subject, text })
    return { messageId: `dev-mock-${Date.now()}` }
  }

  const from = process.env.RESEND_FROM_EMAIL ?? 'HIBIKI <onboarding@resend.dev>'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error('[emailActions] Resend API エラー:', res.status, body)
      return { error: `メール送信に失敗しました (${res.status})` }
    }

    const json = (await res.json()) as { id?: string }
    return { messageId: json.id ?? `resend-${Date.now()}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'メール送信に失敗しました'
    console.error('[emailActions] Resend 通信エラー:', msg)
    return { error: msg }
  }
}

/**
 * 5大ディフェンシブ・アラート用の催促・警告メールを Resend 経由で送信する共通処理。
 * 認可チェックは行わない（呼び出し元＝cronルート／sendDefensiveAlertEmail で担保する）。
 * 送信成否にかかわらず notification_logs に alert_key 付きで記録する
 * （宛先未設定・本文空も「送信失敗」として記録し、他の処理を止めない）。
 */
export async function deliverAlertEmail(params: {
  contractorId: string
  alertKey:     string
  alertType:    string
  message:      string
  tenantId:     string
}): Promise<ActionResult<{ status: 'sent' | 'failed'; messageId: string | null }>> {
  const db = createServiceClient() as any

  const { data: contractor, error: cErr } = await db
    .from('contractors')
    .select('id, name, email')
    .eq('id', params.contractorId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle()

  if (cErr) return { data: null, error: cErr.message }
  if (!contractor) return { data: null, error: '委託先が見つかりません' }

  const contractorEmail = (contractor.email as string | null)?.trim()
  const adminFallback   = process.env.ADMIN_ALERT_EMAIL?.trim()
  const destination     = contractorEmail || adminFallback
  const subject         = ALERT_SUBJECTS[params.alertType] ?? '【HIBIKI】業務確認のお願い'
  const body             = params.message.trim()

  if (!destination || !body) {
    const logRes = await logNotification({
      contractorId: params.contractorId,
      type:         'email',
      destination:  destination ?? '(未設定)',
      status:       'failed',
      alertKey:     params.alertKey,
    })
    if (logRes.error) return { data: null, error: logRes.error }
    return { data: { status: 'failed', messageId: null }, error: null }
  }

  const sendResult = await sendViaResend(destination, subject, body)
  const status: 'sent' | 'failed' = 'error' in sendResult ? 'failed' : 'sent'
  const messageId = 'error' in sendResult ? null : sendResult.messageId

  const logRes = await logNotification({
    contractorId: params.contractorId,
    type:         'email',
    destination,
    status,
    messageId,
    alertKey:     params.alertKey,
  })

  if (logRes.error) {
    return { data: null, error: `メール処理は完了しましたがログ記録に失敗しました: ${logRes.error}` }
  }

  return { data: { status, messageId }, error: null }
}

/**
 * 管理画面「📧 メール再送信」ボタン用。承認済み管理者のみ実行可能。
 * cron の自動送信と同じ buildAlertKey/メッセージ生成関数を使うことで、
 * emailStatus バッジ（sent/failed/not_sent）が手動再送後も正しく更新される。
 * dedup（既存レコードがあればスキップ）はここでは行わない —— 手動操作は常に送信する。
 */
export async function sendDefensiveAlertEmail(
  params:
    | {
        alertType:      'missing_input'
        contractorId:   string
        scheduleId:     string
        contractorName: string
        projectName:    string
        date:           string
      }
    | {
        alertType:      'pending_notice'
        contractorId:   string
        noticeId:       string
        contractorName: string
        targetMonth:    string
      },
): Promise<ActionResult<{ messageId: string }>> {
  const auth = await requireMasterAccess()
  if (auth.error) return { data: null, error: auth.error }

  const tenantId = await getCurrentTenantId()

  const alertKey = params.alertType === 'missing_input'
    ? buildAlertKey('missing_input', params.scheduleId)
    : buildAlertKey('pending_notice', params.noticeId)

  const message = params.alertType === 'missing_input'
    ? buildMissingInputMessage(params.contractorName, params.projectName, params.date)
    : buildPendingNoticeMessage(params.contractorName, params.targetMonth)

  const result = await deliverAlertEmail({
    contractorId: params.contractorId,
    alertKey,
    alertType:    params.alertType,
    message,
    tenantId,
  })

  if (result.error !== null) return { data: null, error: result.error }
  if (result.data.status === 'failed') {
    return { data: null, error: 'メール送信に失敗しました（宛先未設定または送信エラー）' }
  }

  return { data: { messageId: result.data.messageId! }, error: null }
}
