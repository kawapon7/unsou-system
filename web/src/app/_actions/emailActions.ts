'use server'

import { createClient } from '@/utils/supabase/server'
import { getCurrentTenantId } from '@/utils/tenant'
import {
  buildAlertKey,
  buildMissingInputMessage,
  buildPendingNoticeMessage,
} from './defensiveAlertQueries'
import { deliverAlertEmail } from './emailCore'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

// ⚠️ HIBIKI_OWNER_EMAILS 未設定時は特権メールなし（fail-closed）。.env.local に設定すること。
const TEMP_OWNER_EMAILS = (process.env.HIBIKI_OWNER_EMAILS ?? '')
  .split(',').map(e => e.trim()).filter(Boolean)

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
