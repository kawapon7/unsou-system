'use server'

import { createClient } from '@/utils/supabase/server'
import { logNotification } from '@/app/_actions/scheduleActions'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

export type SendReminderEmailResult = {
  logId:      string
  messageId:  string | null
  mocked:     boolean
}

const TEMP_OWNER_EMAILS = ['admin@hibiki.com']
const OWNER_ROLES = new Set(['master', 'owner'])

async function requireOwner(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return { ok: false, error: '未ログインです' }
  }

  if (TEMP_OWNER_EMAILS.includes(user.email ?? '')) {
    return { ok: true }
  }

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role = userData?.role ?? (user.user_metadata?.role as string | undefined)
  if (!role || !OWNER_ROLES.has(role)) {
    return { ok: false, error: '管理者権限が必要です' }
  }

  return { ok: true }
}

type ResendResponse = { id?: string }

async function sendViaResend(
  email: string,
  subject: string,
  body: string,
): Promise<{ messageId: string | null; error: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return {
      messageId: `mock-${Date.now()}`,
      error:     null,
    }
  }

  const from = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to:      [email],
        subject,
        text:    body,
      }),
    })

    const payload = (await res.json()) as ResendResponse & { message?: string }

    if (!res.ok) {
      return {
        messageId: null,
        error:     payload.message ?? `Resend API error (${res.status})`,
      }
    }

    return { messageId: payload.id ?? null, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'メール送信に失敗しました'
    return { messageId: null, error: message }
  }
}

/**
 * 催促メールを Resend 経由で送信し、結果を notification_logs に不変ログとして記録する。
 * INSERT は service_role 経由の logNotification のみ（子分・UPDATE/DELETE 不可）。
 */
export async function sendReminderEmail(
  contractorId: string,
  email: string,
  subject: string,
  body: string,
): Promise<ActionResult<SendReminderEmailResult>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }

  if (!contractorId || !email.trim()) {
    return { data: null, error: 'contractorId と email は必須です' }
  }

  const mocked = !process.env.RESEND_API_KEY
  const { messageId, error: sendError } = await sendViaResend(email.trim(), subject, body)

  const status = sendError ? 'failed' : 'sent'

  const logRes = await logNotification({
    contractor_id: contractorId,
    type:          'email',
    destination:   email.trim(),
    status,
    message_id:    messageId,
  })

  if (logRes.error) {
    return { data: null, error: logRes.error }
  }

  if (sendError) {
    return { data: null, error: sendError }
  }

  return {
    data: {
      logId:     logRes.data!.id,
      messageId,
      mocked,
    },
    error: null,
  }
}
