'use server'

import { reportError } from '@/utils/error-monitor/captured'

/**
 * error.tsx / global-error.tsx から呼ばれる。ログイン前でも起きるため認可チェックはしない。
 * 受け取る文字列は長さを切り、reportError 側でマスクされる。
 * ⚠️ 公開 RPC になるため、入力は文字列3つに限定し、DB へは reportError 経由（service_role）でのみ書く。
 */
export async function reportClientError(input: { message: string; digest?: string; path: string; segment: string }): Promise<void> {
  const message = String(input.message ?? '').slice(0, 2000)
  const digest  = input.digest ? String(input.digest).slice(0, 100) : ''
  const path    = String(input.path ?? '').slice(0, 300)
  const segment = String(input.segment ?? 'root').slice(0, 30)
  await reportError({
    source:     'boundary',
    actionName: `boundary:${segment}`,
    message:    digest ? `${message} [digest ${digest}]` : message,
    ctx:        { path },
  })
}
