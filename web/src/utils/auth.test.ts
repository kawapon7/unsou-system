import { describe, it, expect } from 'vitest'
import { resolveContractorId, type ContractorLookupClient } from './auth'

/**
 * contractors を email で引くだけの偽クライアント。
 * 呼ばれた email を記録し、返す行を差し替えられるようにしてある。
 */
function fakeClient(
  rows: { id: string }[] | null,
  error: unknown = null,
): { client: ContractorLookupClient; calls: string[] } {
  const calls: string[] = []
  const client = {
    from: () => ({
      select: () => ({
        eq: (_col: 'email', value: string) => {
          calls.push(value)
          return { limit: () => Promise.resolve({ data: rows, error }) }
        },
      }),
    }),
  } as unknown as ContractorLookupClient
  return { client, calls }
}

describe('resolveContractorId', () => {
  it('users.contractor_id が入っていればそれを返し、DBを引かない', async () => {
    const { client, calls } = fakeClient([{ id: 'other' }])
    await expect(resolveContractorId(client, 'c-1', 'driver@example.com')).resolves.toBe('c-1')
    expect(calls).toEqual([])
  })

  it('users.contractor_id が未設定なら email 一致で解決する（本件の修正対象）', async () => {
    const { client, calls } = fakeClient([{ id: 'c-2' }])
    await expect(resolveContractorId(client, null, 'driver@example.com')).resolves.toBe('c-2')
    expect(calls).toEqual(['driver@example.com'])
  })

  it('email が複数の委託先にヒットしたら fail-closed で null（他人のPDFを開かせない）', async () => {
    const { client } = fakeClient([{ id: 'c-2' }, { id: 'c-3' }])
    await expect(resolveContractorId(client, null, 'dup@example.com')).resolves.toBeNull()
  })

  it('email に一致する委託先が無ければ null', async () => {
    const { client } = fakeClient([])
    await expect(resolveContractorId(client, undefined, 'nobody@example.com')).resolves.toBeNull()
  })

  it('email が null のときは DB を引かずに null（空文字で全件マッチさせない）', async () => {
    const { client, calls } = fakeClient([{ id: 'c-2' }])
    await expect(resolveContractorId(client, null, null)).resolves.toBeNull()
    expect(calls).toEqual([])
  })

  it('クエリがエラーなら null（fail-closed）', async () => {
    const { client } = fakeClient(null, { message: 'boom' })
    await expect(resolveContractorId(client, null, 'driver@example.com')).resolves.toBeNull()
  })
})

describe('fetchPaymentNoticePdfData の認可判定（ドライバー経路）', () => {
  // ⚠️ 実アクションは service_role クライアントを掴むため、ここでは
  //    pdf-actions.ts が使っている判定式そのもの（ctx.contractorId !== 引数）を
  //    解決結果に対して確認する。解決が壊れると「委託先が見つかりません」で
  //    自分の通知書すら開けなくなる（2026-08-17に発見された不具合）。
  const canOpen = (ctxContractorId: string | null, target: string) =>
    ctxContractorId !== null && ctxContractorId === target

  it('email 解決できた本人は自分の通知書を開ける', async () => {
    const { client } = fakeClient([{ id: 'c-2' }])
    const resolved = await resolveContractorId(client, null, 'driver@example.com')
    expect(canOpen(resolved, 'c-2')).toBe(true)
  })

  it('他人の contractorId は解決できても弾かれる', async () => {
    const { client } = fakeClient([{ id: 'c-2' }])
    const resolved = await resolveContractorId(client, null, 'driver@example.com')
    expect(canOpen(resolved, 'c-9')).toBe(false)
  })

  it('解決不能（null）なら誰の通知書も開けない', () => {
    expect(canOpen(null, 'c-2')).toBe(false)
  })
})
