import { createServiceClient } from '@/utils/supabase/service'
import { logNotification } from './scheduleActions'

// ⚠️ このファイルには意図的に 'use server' を付けない。
// 'use server' ファイルの export は全て公開Server Action RPCとして
// ネットワーク到達可能になるため、認可チェックを持たない deliverAlertEmail を
// 誤ってRPC化しないよう、プレーンモジュールとして分離する
// （defensiveAlertQueries.ts と同じパターン）。
// 呼び出し元は cron ルート（route.ts）と emailActions.ts の
// sendDefensiveAlertEmail（こちらは requireMasterAccess() で認可済み）のみ。

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

const ALERT_SUBJECTS: Record<string, string> = {
  missing_input:   '【HIBIKI】稼働実績の入力をお願いします',
  pending_notice:  '【HIBIKI】支払通知書のご確認をお願いします',
  threshold:       '【HIBIKI】稼働実績の確認をお願いします',
  duplicate:       '【HIBIKI】実績データの重複について',
  invoice_warning: '【HIBIKI】インボイス登録番号のご確認',
  overdue_invoice: '【HIBIKI】延滞請求書のお知らせ',
}

async function sendViaResend(
  to: string,
  subject: string,
  text: string,
): Promise<{ messageId: string } | { error: string }> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    console.warn('[emailCore] RESEND_API_KEY が未設定です — 開発フォールバック（コンソール出力）')
    console.log('[emailCore] メール送信（モック）:', { to, subject, text })
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
      console.error('[emailCore] Resend API エラー:', res.status, body)
      return { error: `メール送信に失敗しました (${res.status})` }
    }

    const json = (await res.json()) as { id?: string }
    return { messageId: json.id ?? `resend-${Date.now()}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'メール送信に失敗しました'
    console.error('[emailCore] Resend 通信エラー:', msg)
    return { error: msg }
  }
}

/**
 * 5大ディフェンシブ・アラート用の催促・警告メールを Resend 経由で送信する共通処理。
 * 認可チェックは行わない（呼び出し元＝cronルート／sendDefensiveAlertEmail で担保する）。
 * contractorId（委託先起点）または clientId（荷主起点、⑥延滞請求書のみ）の
 * どちらか一方を渡す。clientId の場合は荷主本人には送らず ADMIN_ALERT_EMAIL 宛に送る
 * （社内向けアラートのため）。
 * 送信成否にかかわらず notification_logs に alert_key 付きで記録する
 * （宛先未設定・本文空も「送信失敗」として記録し、他の処理を止めない）。
 */
export async function deliverAlertEmail(params: {
  contractorId?: string
  clientId?:     string
  alertKey:      string
  alertType:     string
  message:       string
  tenantId:      string
}): Promise<ActionResult<{ status: 'sent' | 'failed'; messageId: string | null }>> {
  const db = createServiceClient() as any

  let destination: string | undefined

  if (params.clientId) {
    destination = process.env.ADMIN_ALERT_EMAIL?.trim()
  } else if (params.contractorId) {
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
    destination = contractorEmail || adminFallback
  } else {
    return { data: null, error: 'contractorId または clientId のいずれかが必要です' }
  }

  const subject = ALERT_SUBJECTS[params.alertType] ?? '【HIBIKI】業務確認のお願い'
  const body    = params.message.trim()

  if (!destination || !body) {
    const logRes = await logNotification({
      contractorId: params.contractorId,
      clientId:     params.clientId,
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
    clientId:     params.clientId,
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
