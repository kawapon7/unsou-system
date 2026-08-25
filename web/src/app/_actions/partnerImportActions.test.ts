import { describe, it, expect, vi } from 'vitest'

// requireOperator の内部（requireOwner/env）を通さず、常に許可された運営者として扱う
vi.mock('@/utils/operator', () => ({
  requireOperator: vi.fn(async () => ({ ok: true, ctx: { userId: 'operator-1' } })),
}))

vi.mock('@/app/admin/partners/actions', () => ({
  fetchClients: vi.fn(async () => ({
    data: [{ id: 'client-1', company_name: '既存商事', use_departments: false }],
    error: null,
  })),
  fetchContractors: vi.fn(async () => ({ data: [], error: null })),
  fetchClientDepartments: vi.fn(async () => ({ data: [], error: null })),
  createClient_: vi.fn(),
  createClientDepartment: vi.fn(),
  createContractor: vi.fn(async (payload: { name: string }) => ({
    data: { id: 'new-contractor-id', name: payload.name },
    error: null,
  })),
}))

vi.mock('@/app/admin/projects/actions', () => ({
  fetchProjectsForImport: vi.fn(async () => ({ data: [], error: null })),
  createProject: vi.fn(async (payload: Record<string, unknown>) => ({
    data: { id: 'new-project-id', ...payload },
    error: null,
  })),
}))

import { importPartners } from './partnerImportActions'
import { createProject } from '@/app/admin/projects/actions'

const validContractor = {
  '名前': '新規運送', 'メール': 'new@example.com', '電話': '090-1111-2222',
  '締め日': '月末', '支払月': '翌月', '支払日': '15', '支払方法': '振込',
  '税区分': '外税', 'インボイス区分': '適格', '登録番号': 'T1234567890123',
  '銀行名': 'テスト銀行', '支店名': '本店', '口座種別': '普通',
  '口座番号': '1234567', '口座名義': 'シンキウンソウ',
}

const projectReferencingNewContractor = {
  '荷主': '既存商事', '案件名': '新規案件', '区分': '輸送系',
  '売上単価': '10000', '仕入単価': '', '部署': '', '委託先': '新規運送',
}

describe('importPartners: 同一ファイルで新規委託先と、それを参照する案件を同時投入', () => {
  it('新規登録した委託先のIDが案件の contractor_id に解決される（回帰: 登録前のスナップショットだけを見て解決失敗しないこと）', async () => {
    const result = await importPartners({
      clients: [],
      departments: [],
      contractors: [validContractor],
      projects: [projectReferencingNewContractor],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inserted).toEqual({ clients: 0, departments: 0, contractors: 1, projects: 1 })

    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ contractor_id: 'new-contractor-id', client_id: 'client-1' }),
    )
  })
})
