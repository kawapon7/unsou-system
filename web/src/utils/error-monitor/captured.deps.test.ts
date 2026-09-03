import { describe, it, expect, vi } from 'vitest'

// createSupabaseSink() が env 未設定などで throw するケースを模す。
// getDeps() の解決が captured() の try の外（既定引数）にあると、
// この throw が fn 実行前に呼び出し元まで漏れ、業務処理が一度も走らない回帰を検知する。
vi.mock('./sink', () => ({
  createSupabaseSink: () => {
    throw new Error('no env')
  },
}))

import { captured, GENERIC_ERROR_MESSAGE } from './captured'

describe('captured — deps 未指定時の遅延解決', () => {
  it('getDeps() 相当が throw しても、正常系では fn の結果がそのまま返る', async () => {
    const r = await captured('x', async () => ({ data: 1, error: null }))
    expect(r).toEqual({ data: 1, error: null })
  })

  it('getDeps() 相当が throw しても、fn の例外は GENERIC_ERROR_MESSAGE に変換される', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await captured('x', async () => { throw new Error('boom') })
    expect(r).toEqual({ data: null, error: GENERIC_ERROR_MESSAGE })
    spy.mockRestore()
  })
})
