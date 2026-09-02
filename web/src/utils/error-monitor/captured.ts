import { mask, MESSAGE_MAX, STACK_MAX } from './mask'
import { isSystemError, severityFor } from './classify'
import { fingerprint } from './fingerprint'
import { createSupabaseSink } from './sink'
import { shouldNotifyImmediately, buildImmediateMail } from './notify'
import { sendAdminAlertEmail } from '@/app/_actions/emailCore'
import type { CaptureContext, ErrorEvent, ErrorSink, Source } from './types'

export const GENERIC_ERROR_MESSAGE = '処理に失敗しました'

export type Deps = {
  sink:         ErrorSink
  send:         (subject: string, text: string) => Promise<unknown>
  isProduction: boolean
  now?:         () => Date
}

let defaultDeps: Deps | null = null
function getDeps(): Deps {
  if (!defaultDeps) {
    defaultDeps = {
      sink:         createSupabaseSink(),
      send:         sendAdminAlertEmail,
      isProduction: process.env.NODE_ENV === 'production',
    }
  }
  return defaultDeps
}

/** Next.js 内部の制御フロー例外（redirect / notFound）。捕まえてはいけない */
function isNextControlFlow(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND') || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK'))
}

function hasErrorString(v: unknown): v is { error: string } {
  return typeof v === 'object' && v !== null && typeof (v as { error?: unknown }).error === 'string' && (v as { error: string }).error !== ''
}

/**
 * Cloudflare Workers では応答後の処理を waitUntil に載せる。取れない環境（vitest / next dev）は await。
 * ⚠️ @opennextjs/cloudflare の getCloudflareContext は Workers 外で throw するため try で囲む（未検証: Workers 実機で waitUntil が取れるかは Task 13 の導通で確認）。
 */
async function runAfterResponse(task: () => Promise<void>): Promise<void> {
  try {
    const mod = await import(/* @vite-ignore */ '@opennextjs/cloudflare')
    const ctx = (mod as { getCloudflareContext?: () => { ctx?: { waitUntil?: (p: Promise<unknown>) => void } } }).getCloudflareContext?.()
    if (ctx?.ctx?.waitUntil) { ctx.ctx.waitUntil(task()); return }
  } catch { /* Workers 外 */ }
  await task()
}

/**
 * エラー1件を 整形→記録→（critical なら）即時通知 する。失敗は握りつぶす。
 * 業務処理の結果を変えないため、ここから例外を外に出してはならない。
 */
export async function reportError(
  input: { source: Source; actionName: string; message: string; stack?: string | null; ctx?: CaptureContext },
  deps: Deps = getDeps(),
): Promise<void> {
  try {
    const message = mask(input.message || '(no message)', MESSAGE_MAX)
    const stack   = input.stack ? mask(input.stack, STACK_MAX) : null
    const event: ErrorEvent = {
      fingerprint:  fingerprint(input.source, input.actionName, message),
      source:       input.source,
      actionName:   input.actionName,
      severity:     severityFor(input.source, input.actionName),
      message,
      stack,
      path:         input.ctx?.path ?? null,
      tenantId:     input.ctx?.tenantId ?? null,
      userId:       input.ctx?.userId ?? null,
      contractorId: input.ctx?.contractorId ?? null,
    }
    const rec = await deps.sink.record(event)
    const now = deps.now?.() ?? new Date()
    if (deps.isProduction && shouldNotifyImmediately(event, rec, now)) {
      const mail = buildImmediateMail(event, rec, now)
      await deps.send(mail.subject, mail.text)
      await deps.sink.markNotified(rec.id)
    }
  } catch (e) {
    console.error('[error-monitor] 記録/通知に失敗:', e instanceof Error ? e.message : e)
  }
}

/**
 * Server Action の本体を包む。spec §3。
 *   export async function foo(...) { return captured('foo', async () => { ...本体... }, ctx) }
 * - 例外 → 記録して { data: null, error: '処理に失敗しました' }
 * - 戻り値 {error} がシステム由来 → 記録して戻り値はそのまま
 * - 業務 {error} / 正常 → 何もしない
 * - redirect()/notFound() は再スロー
 */
export async function captured<T>(
  actionName: string,
  fn: () => Promise<T>,
  ctx?: CaptureContext,
  deps: Deps = getDeps(),
): Promise<T | { data: null; error: string }> {
  let result: T
  try {
    result = await fn()
  } catch (e) {
    if (isNextControlFlow(e)) throw e
    const err = e instanceof Error ? e : new Error(String(e))
    await runAfterResponse(() => reportError({ source: 'action', actionName, message: err.message, stack: err.stack ?? null, ctx }, deps))
    return { data: null, error: GENERIC_ERROR_MESSAGE }
  }
  if (hasErrorString(result) && isSystemError(result.error)) {
    await runAfterResponse(() => reportError({ source: 'action', actionName, message: result.error, ctx }, deps))
  }
  return result
}

/** API route handler を包む。例外を記録し 500 を返す */
export function capturedRoute<A extends unknown[]>(
  routeName: string,
  handler: (...args: A) => Promise<Response>,
  source: 'route' | 'cron' = 'route',
  deps: Deps = getDeps(),
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args)
    } catch (e) {
      if (isNextControlFlow(e)) throw e
      const err = e instanceof Error ? e : new Error(String(e))
      const req = args[0] as { nextUrl?: { pathname?: string } } | undefined
      await runAfterResponse(() => reportError({ source, actionName: routeName, message: err.message, stack: err.stack ?? null, ctx: { path: req?.nextUrl?.pathname ?? null } }, deps))
      return Response.json({ error: GENERIC_ERROR_MESSAGE }, { status: 500 })
    }
  }
}
