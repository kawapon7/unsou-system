import { createServiceClient } from '@/utils/supabase/service'
import type { ErrorEvent, ErrorRecordResult, ErrorSink } from './types'

/** tenant が取れないイベントの集約キー（UNIQUE で NULL は別行になるため固定値に写像） */
export const NULL_TENANT_ID = '00000000-0000-0000-0000-000000000000'

type RpcFn = (fn: string, args: Record<string, unknown>) =>
  PromiseLike<{ data: unknown; error: { message: string } | null }>

/** JST の YYYY-MM-DD（Workers の TZ は UTC のため手計算） */
export function jstDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export class SupabaseSink implements ErrorSink {
  constructor(private readonly rpc: RpcFn) {}

  async record(e: ErrorEvent): Promise<ErrorRecordResult> {
    const { data, error } = await this.rpc('record_error_log', {
      p_fingerprint:   e.fingerprint,
      p_day:           jstDay(),
      p_tenant_id:     e.tenantId ?? NULL_TENANT_ID,
      p_source:        e.source,
      p_action_name:   e.actionName,
      p_severity:      e.severity,
      p_message:       e.message,
      p_stack:         e.stack,
      p_path:          e.path,
      p_user_id:       e.userId,
      p_contractor_id: e.contractorId,
    })
    if (error) throw new Error(error.message)
    const row = (Array.isArray(data) ? data[0] : data) as { id: string; count: number; notified_at: string | null }
    return { id: row.id, count: row.count, notifiedAt: row.notified_at }
  }

  /** notified_at の判定と更新を DB 側で原子的に行う。true を返した呼び出しだけが送信してよい */
  async claimNotification(id: string, windowMs: number): Promise<boolean> {
    const { data, error } = await this.rpc('claim_error_notification', {
      p_id: id,
      p_window_seconds: Math.ceil(windowMs / 1000),
    })
    if (error) throw new Error(error.message)
    return data === true
  }

  async releaseNotification(id: string): Promise<void> {
    const { error } = await this.rpc('release_error_notification', { p_id: id })
    if (error) throw new Error(error.message)
  }
}

export function createSupabaseSink(): SupabaseSink {
  const db = createServiceClient() as any
  return new SupabaseSink((fn, args) => db.rpc(fn, args))
}
