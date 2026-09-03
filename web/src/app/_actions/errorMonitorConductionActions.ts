'use server'

// ⚠️ 導通確認専用の一時ファイル。本番で1回確認したら削除する（plan Task 13 Step 5）。
import { requireOwner } from '@/utils/auth'
import { captured } from '@/utils/error-monitor/captured'

/** 導通確認専用。owner のみ。意図的に例外を投げて error_logs と即時メールを確認する */
export async function throwForConductionTest(): Promise<{ data: null; error: string }> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  return captured('upsertSchedule', async () => {
    throw new Error('conduction test 1234567 test@example.com')
  }) as Promise<{ data: null; error: string }>
}
