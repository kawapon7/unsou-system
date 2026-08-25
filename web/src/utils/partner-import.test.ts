import { describe, it, expect } from 'vitest'
import { validateAndConvert, departmentKey, TEMPLATE_HEADERS, normalizeName, projectKey } from './partner-import'

const noExisting = { clientNames: [], contractorNames: [], contractorEmails: [], departmentKeys: [] }

const validContractor = {
  '名前': '山田運送', 'メール': 'yamada@example.com', '電話': '090-1111-2222',
  '締め日': '月末', '支払月': '翌月', '支払日': '15', '支払方法': '振込',
  '税区分': '外税', 'インボイス区分': '適格', '登録番号': 'T1234567890123',
  '銀行名': 'テスト銀行', '支店名': '本店', '口座種別': '普通',
  '口座番号': '1234567', '口座名義': 'ヤマダウンソウ',
}
const validClient = {
  '会社名': 'テスト商事', '担当者名': '佐藤', 'メール': 'sato@example.com', '電話': '',
  '締め日': '月末', '支払月': '翌々月', '支払日': '月末', '税区分': '外税',
  'インボイス登録': 'あり', '部署を使う': 'あり',
  '銀行名': '', '支店名': '', '口座種別': '', '口座番号': '', '口座名義': '',
}
const validDept = { '請求先名': 'テスト商事', '部署名': '物流部', '担当者名': '', 'メール': '', '電話': '' }

describe('validateAndConvert 正常系', () => {
  it('正しい3シートが変換され errors は空', () => {
    const r = validateAndConvert(
      { contractors: [validContractor], clients: [validClient], departments: [validDept], projects: [] },
      noExisting,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.contractors[0]).toMatchObject({
      name: '山田運送',
      payment_type: 'bank_transfer',
      payment_site: 45,            // 翌月(1)×30 + 15
      tax_category: 'exclusive',
      invoice_registration_type: '適格',
      contractor_type: 'individual',
      has_withholding: false,
      show_detail_switch: true,
      closing_day: '月末',
    })
    expect(r.data!.clients[0]).toMatchObject({
      company_name: 'テスト商事',
      closing_day: 99,             // 月末→99
      payment_site: 90,            // 翌々月(2)×30 + 月末(30)
      tax_type: 'exclusive',
      invoice_registered: true, is_invoice_registered: true, has_invoice: true,
      use_departments: true,
      phone: null,                 // 空欄→null
    })
    expect(r.data!.departments[0]).toMatchObject({ clientName: 'テスト商事' })
  })
  it('先頭セルが「例）」の行はスキップされる', () => {
    const example = { ...validContractor, '名前': '例）山田運送' }
    const r = validateAndConvert(
      { contractors: [example, validContractor], clients: [], departments: [], projects: [] },
      noExisting,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.contractors).toHaveLength(1)
  })

  it('先頭セルが「※」のガイド行（必須/任意注記）はスキップされる', () => {
    const guide = { ...validContractor, '名前': '※必須', 'メール': '必須', '登録番号': '適格のみ必須（T+13桁）・免税は記入不可' }
    const clientGuide = { ...validClient, '会社名': '※必須', '締め日': '必須（月末 または 1〜28）' }
    const deptGuide = { ...validDept, '請求先名': '※必須（請求先シートの会社名と一致）', '部署名': '必須' }
    const r = validateAndConvert(
      { contractors: [guide, validContractor], clients: [clientGuide, validClient], departments: [deptGuide, validDept], projects: [] },
      noExisting,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.contractors).toHaveLength(1)
    expect(r.data!.clients).toHaveLength(1)
    expect(r.data!.departments).toHaveLength(1)
  })
  it('全セルが空文字の行はエラーにならずスキップされる', () => {
    const blankRow = Object.fromEntries(
      Object.keys(validContractor).map(k => [k, '']),
    ) as typeof validContractor
    const r = validateAndConvert(
      { contractors: [blankRow, validContractor], clients: [], departments: [], projects: [] },
      noExisting,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.contractors).toHaveLength(1)
  })
})

describe('validateAndConvert 行番号（sheet_to_json配列インデックス→Excel行）', () => {
  it('例）行の直後のデータ行はExcel行3になる（配列index1 → row=3）', () => {
    const example = { ...validContractor, '名前': '例）山田運送' }
    const bad = { ...validContractor, '名前': '' }
    const r = validateAndConvert(
      { contractors: [example, bad], clients: [], departments: [], projects: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
    expect(r.errors[0]).toMatchObject({ row: 3, column: '名前' })
  })
  it('例）行の次の正常データ行を挟んだ2件目のエラーはExcel行4になる（配列index2 → row=4）', () => {
    const example = { ...validContractor, '名前': '例）山田運送' }
    const ok = { ...validContractor, 'メール': 'ok@example.com' }
    const bad = { ...validContractor, '名前': '', 'メール': 'bad@example.com' }
    const r = validateAndConvert(
      { contractors: [example, ok, bad], clients: [], departments: [], projects: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
    expect(r.errors[0]).toMatchObject({ row: 4, column: '名前' })
  })
})

describe('validateAndConvert エラー系（すべて全件中止 data:null）', () => {
  it('必須欄の空はエラー（行番号・列名つき）', () => {
    const r = validateAndConvert(
      { contractors: [{ ...validContractor, '名前': '' }], clients: [], departments: [], projects: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
    expect(r.errors[0]).toMatchObject({ sheet: '委託先', column: '名前' })
  })
  it('列挙値のゆれはエラー', () => {
    const r = validateAndConvert(
      { contractors: [{ ...validContractor, '支払月': 'よく月' }], clients: [], departments: [], projects: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
    expect(r.errors[0].column).toBe('支払月')
  })
  it('登録番号の形式違反はエラー', () => {
    const r = validateAndConvert(
      { contractors: [{ ...validContractor, '登録番号': 'T123' }], clients: [], departments: [], projects: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
  })
  it('免税なのに登録番号があればエラー', () => {
    const r = validateAndConvert(
      { contractors: [{ ...validContractor, 'インボイス区分': '免税' }], clients: [], departments: [], projects: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
  })
  it('ファイル内の同名重複はエラー', () => {
    const r = validateAndConvert(
      { contractors: [validContractor, { ...validContractor, 'メール': 'other@example.com' }], clients: [], departments: [], projects: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
  })
  it('既存DBとの同名重複はエラー', () => {
    const r = validateAndConvert(
      { contractors: [validContractor], clients: [], departments: [], projects: [] },
      { ...noExisting, contractorNames: ['山田運送'] },
    )
    expect(r.data).toBeNull()
  })
  it('部署の請求先名が未解決ならエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [{ ...validDept, '請求先名': '存在しない社' }], projects: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
    expect(r.errors[0]).toMatchObject({ sheet: '部署', column: '請求先名' })
  })
  it('部署の請求先名が既存DB側にあれば通る', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [validDept], projects: [] },
      { ...noExisting, clientNames: ['テスト商事'] },
    )
    expect(r.errors).toEqual([])
  })
  it('部署のファイル内重複（同一請求先名+部署名）はエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [validDept, { ...validDept }], projects: [] },
      { ...noExisting, clientNames: ['テスト商事'] },
    )
    expect(r.data).toBeNull()
    expect(r.errors.some(e => e.sheet === '部署' && e.column === '部署名' && e.reason.includes('ファイル内'))).toBe(true)
  })
  it('部署が既存DBの departmentKeys と重複していればエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [validDept], projects: [] },
      {
        ...noExisting,
        clientNames: ['テスト商事'],
        departmentKeys: [departmentKey('テスト商事', '物流部')],
      },
    )
    expect(r.data).toBeNull()
    expect(r.errors.some(e => e.sheet === '部署' && e.column === '部署名' && e.reason.includes('既に登録'))).toBe(true)
  })
  it('エラーは全件収集される（1件で打ち切らない）', () => {
    const r = validateAndConvert(
      { contractors: [{ ...validContractor, '名前': '', 'メール': 'bad' }], clients: [], departments: [], projects: [] },
      noExisting,
    )
    expect(r.errors.length).toBeGreaterThanOrEqual(2)
  })
})

describe('departmentKey', () => {
  it('NUL文字区切りのキーを返す', () => {
    expect(departmentKey('テスト商事', '物流部')).toBe('テスト商事 物流部')
  })

  it('会社名に区切りらしき文字が含まれても衝突しない', () => {
    expect(departmentKey('A 社', 'B')).not.toBe(departmentKey('A', ' 社B'))
  })
})

describe('TEMPLATE_HEADERS', () => {
  it('3シート分のヘッダが定義されている', () => {
    expect(TEMPLATE_HEADERS.contractors).toContain('名前')
    expect(TEMPLATE_HEADERS.clients).toContain('会社名')
    expect(TEMPLATE_HEADERS.departments).toContain('請求先名')
  })
})


describe('normalizeName / projectKey', () => {
  it('全角英数字・空白・大文字小文字の違いを吸収する', () => {
    expect(normalizeName('ＡＢＣ 便')).toBe(normalizeName('abc便'))
    expect(normalizeName('広島　便')).toBe(normalizeName('広島便'))
    expect(normalizeName(' 定期便 ')).toBe('定期便')
  })

  it('projectKey は荷主・部署・正規化した案件名で構成される', () => {
    expect(projectKey('テスト商事', '物流部', '広島　便'))
      .toBe('テスト商事\u0000物流部\u0000広島便')
  })

  it('部署なしは空文字として扱い、部署ありと区別される', () => {
    expect(projectKey('テスト商事', null, '定期便'))
      .not.toBe(projectKey('テスト商事', '物流部', '定期便'))
  })
})

const validProject = {
  '荷主': 'テスト商事', '部署': '物流部', '案件名': '広島定期便', '区分': '輸送系',
  '委託先': '山田運送', '売上単価': '15000', '仕入単価': '12000',
}
const existingWithClient = {
  ...noExisting,
  clientNames: ['テスト商事'],
  clientUseDepartments: { 'テスト商事': true },
  departmentKeys: [departmentKey('テスト商事', '物流部')],
  contractorNames: ['山田運送'],
}

describe('案件シート 正常系', () => {
  it('案件行が変換される', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [validProject] },
      existingWithClient,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects).toHaveLength(1)
    expect(r.data!.projects[0]).toMatchObject({
      clientName: 'テスト商事',
      departmentName: '物流部',
      contractorName: '山田運送',
    })
    expect(r.data!.projects[0].payload).toMatchObject({
      project_name: '広島定期便',
      category: 'transport',
      sale_amount: 15000,
      buy_amount: 12000,
      unit_type: 'quantity',
      status: 'accepted',
      driver_visible: true,
    })
  })

  it('区分「作業系」は category=work になる', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '区分': '作業系' }] },
      existingWithClient,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects[0].payload).toMatchObject({ category: 'work' })
  })

  it('委託先と仕入単価は空欄でよい', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '委託先': '', '仕入単価': '' }] },
      existingWithClient,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects[0].contractorName).toBeNull()
    expect(r.data!.projects[0].payload).toMatchObject({ buy_amount: null })
  })

  it('全角数字とカンマ区切りを受け入れる', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '売上単価': '１５，０００', '仕入単価': '12,000' }] },
      existingWithClient,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects[0].payload).toMatchObject({ sale_amount: 15000, buy_amount: 12000 })
  })
})

describe('案件シート エラー系', () => {
  it('荷主・案件名・区分・売上単価の空欄はエラー', () => {
    const r = validateAndConvert(
      {
        contractors: [], clients: [], departments: [],
        projects: [{ ...validProject, '荷主': '', '案件名': '', '区分': '', '売上単価': '' }],
      },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    const cols = r.errors.map(e => e.column)
    expect(cols).toEqual(expect.arrayContaining(['荷主', '案件名', '区分', '売上単価']))
  })

  it('区分が列挙値以外ならエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '区分': '配送' }] },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    expect(r.errors[0]).toMatchObject({ sheet: '案件', column: '区分' })
  })

  it('単価が負数や文字混じりならエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '売上単価': '-100', '仕入単価': '1万円' }] },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    expect(r.errors.map(e => e.column)).toEqual(expect.arrayContaining(['売上単価', '仕入単価']))
  })

  it('ガイド行と記入例行はスキップされる', () => {
    const r = validateAndConvert(
      {
        contractors: [], clients: [], departments: [],
        projects: [
          { ...validProject, '荷主': '※必須' },
          { ...validProject, '荷主': '例）株式会社サンプル商事' },
          validProject,
        ],
      },
      existingWithClient,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects).toHaveLength(1)
  })
})

