'use server'

import { reportError } from '@/utils/error-monitor/captured'

/**
 * error.tsx / global-error.tsx から呼ばれる。ログイン前でも起きるため認可チェックはしない。
 * 受け取る文字列は長さを切り、reportError 側でマスクされる。
 * ⚠️ 公開 RPC になるため、入力は文字列3つに限定し、DB へは reportError 経由（service_role）でのみ書く。
 */
/** boundary の種別。任意文字列を actionName に流さないためホワイトリストで受ける */
const SEGMENTS = ['admin', 'driver', 'root'] as const
type Segment = (typeof SEGMENTS)[number]

export async function reportClientError(input: { message: string; digest?: string; path: string; segment: string }): Promise<void> {
  const message = String(input.message ?? '').slice(0, 2000)
  const digest  = input.digest ? String(input.digest).slice(0, 100) : ''
  const path    = String(input.path ?? '').slice(0, 300)
  const raw     = String(input.segment ?? '')
  const segment: Segment = (SEGMENTS as readonly string[]).includes(raw) ? (raw as Segment) : 'root'
  await reportError({
    source:     'boundary',
    actionName: `boundary:${segment}`,
    message:    digest ? `${message} [digest ${digest}]` : message,
    ctx:        { path },
  })
}
