'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'
import { logNotification } from './scheduleActions'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

const TEMP_OWNER_EMAILS = ['admin@hibiki.com']

const ALERT_SUBJECTS: Record<string, string> = {
  missing_input:   '【HIBIKI】稼働実績の入力をお願いします',
  pending_notice:  '【HIBIKI】支払通知書のご確認をお願いします',
  threshold:       '【HIBIKI】稼働実績の確認をお願いします',
  duplicate:       '【HIBIKI】実績データの重複について',
  invoice_warning: '【HIBIKI】インボイス登録番号のご確認',
}

async function requireMasterAccess(): Promise<ActionResult<{ userId: string }>> {
  if (process.env.NODE_ENV === 'development') {
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
 * 5大ディフェンシブ・アラート用の催促・警告メールを Resend 経由で送信する。
 * 送信成功時は notification_logs に不変ログ（type='email', status='sent'）を記録する。
 */
export async function sendDefensiveAlertEmail(
  contractorId: string,
  alertType:    string,
  message:      string,
): Promise<ActionResult<{ messageId: string }>> {
  const auth = await requireMasterAccess()
  if (auth.error) return { data: null, error: auth.error }

  const tenantId = await getCurrentTenantId()
  const db = createServiceClient() as any

  const { data: contractor, error: cErr } = await db
    .from('contractors')
    .select('id, name, email')
    .eq('id', contractorId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (cErr) return { data: null, error: cErr.message }
  if (!contractor) return { data: null, error: '委託先が見つかりません' }

  const contractorEmail = (contractor.email as string | null)?.trim()
  const adminFallback   = process.env.ADMIN_ALERT_EMAIL?.trim()
  const destination     = contractorEmail || adminFallback

  if (!destination) {
    return { data: null, error: '送信先メールアドレスが未設定です（委託先・管理者ともに未登録）' }
  }

  const subject = ALERT_SUBJECTS[alertType] ?? '【HIBIKI】業務確認のお願い'
  const body    = message.trim()
  if (!body) return { data: null, error: 'メッセージ本文が空です' }

  const sendResult = await sendViaResend(destination, subject, body)
  if ('error' in sendResult) {
    return { data: null, error: sendResult.error }
  }

  const logRes = await logNotification({
    contractorId,
    type:        'email',
    destination,
    status:      'sent',
    messageId:   sendResult.messageId,
  })

  if (logRes.error) {
    console.error('[emailActions] notification_logs 記録失敗:', logRes.error)
    return { data: null, error: `メールは送信しましたがログ記録に失敗しました: ${logRes.error}` }
  }

  return { data: { messageId: sendResult.messageId }, error: null }
}
