/**
 * 取引先（請求先・委託先・部署）インポートの検証・変換純関数。
 *
 * 副作用なし・DBアクセスなし・process.env参照なし。
 * 変換仕様の正本は web/src/app/admin/partners/page.tsx の既存submit処理
 * （請求先: 640-676行、委託先: 942-989行）。この関数はそこで作られる
 * payload と同じキー・同じ値を作る。
 */

export type RawRow = Record<string, string> // ヘッダ名→セル値（すべてString化済み）

export type ImportFile = {
  contractors: RawRow[]
  clients: RawRow[]
  departments: RawRow[]
  projects: RawRow[]
}

export type RowError = {
  sheet: string
  row: number // Excel行番号（1=ヘッダ固定。2以降はシート上の実行位置に追従。現テンプレは2=ガイド, 3=記入例, データ1行目=4）
  column: string
  reason: string
}

export type ExistingSets = {
  clientNames: string[]
  contractorNames: string[]
  contractorEmails: string[]
  departmentKeys: string[]
  // ここから案件インポート用。省略時は空として扱い、既存の呼び出しを壊さない
  clientUseDepartments?: Record<string, boolean>
  projectKeys?: string[]
}

// 部署の重複検査キー。区切りに通常の文字列が使わないNUL文字を使い、
// 会社名・部署名それぞれに区切り文字が含まれていても衝突しないようにする。
// ⚠️ 区切りのNUL文字はソース上エスケープ表記で書くこと。リテラルのNUL文字を埋め込むとファイルがバイナリ扱いになり git diff もシークレット走査も効かなくなる
export function departmentKey(clientName: string, deptName: string): string {
  return `${clientName}\u0000${deptName}`
}

/** 比較専用の正規化。NFKCで全角英数字を半角化 → 空白を全除去 → 小文字化。
 *  ⚠️ 保存する値には使わない。表示名はExcelに書かれたままにする。 */
export function normalizeName(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/** 案件の重複検査キー。荷主・部署は完全一致で照合済みの値をそのまま使い、
 *  案件名だけ表記ゆれを吸収して比較する。部署なしは空文字。 */
export function projectKey(clientName: string, deptName: string | null, projectName: string): string {
  return `${clientName}\u0000${deptName ?? ''}\u0000${normalizeName(projectName)}`
}

export type ConvertedImport = {
  clients: Array<Record<string, unknown>>
  departments: Array<{ clientName: string; payload: Record<string, unknown> }>
  contractors: Array<Record<string, unknown>>
  projects: Array<{
    clientName: string
    departmentName: string | null
    contractorName: string | null
    payload: Record<string, unknown>
  }>
}

export const SHEET_NAMES = {
  contractors: '委託先',
  clients: '請求先',
  departments: '部署',
  projects: '案件',
} as const

export const TEMPLATE_HEADERS = {
  contractors: [
    '名前', 'メール', '電話',
    '締め日', '支払月', '支払日', '支払方法',
    '税区分', 'インボイス区分', '登録番号',
    '銀行名', '支店名', '口座種別', '口座番号', '口座名義',
  ],
  clients: [
    '会社名', '担当者名', 'メール', '電話',
    '締め日', '支払月', '支払日', '税区分',
    'インボイス登録', '部署を使う',
    '銀行名', '支店名', '口座種別', '口座番号', '口座名義',
  ],
  departments: ['請求先名', '部署名', '担当者名', 'メール', '電話'],
  projects: [
    '荷主', '部署', '案件名', '区分', '委託先', '売上単価', '仕入単価',
  ],
} as const

// ── 内部定数（page.tsx の定義と一致させること） ─────────────

const MONTH_OFFSETS: Record<string, number> = { '当月': 0, '翌月': 1, '翌々月': 2, '3ヶ月後': 3 }
const TAX_MAP: Record<string, string> = { '外税': 'exclusive', '内税': 'inclusive', '非課税': 'exempt' }
const ACCOUNT_TYPES = ['普通', '当座']
const PAYMENT_METHODS = ['振込', '現金']
const INVOICE_REG_TYPES = ['適格', '免税']
const YES_NO: Record<string, boolean> = { 'あり': true, 'なし': false }

const EMAIL_RE = /.+@.+\..+/
const INVOICE_NUMBER_RE = /^T[0-9]{13}$/

// 「例）」= 記入例行、「※」= 必須/任意ガイド行。どちらもテンプレに同梱される非データ行で、
// 利用者が消し忘れてもデータとして取り込まない。
function isExampleRow(row: RawRow): boolean {
  const firstValue = Object.values(row)[0]
  return typeof firstValue === 'string' && (firstValue.startsWith('例）') || firstValue.startsWith('※'))
}

/** 全セルが空文字（未入力）の行かどうか。sheet_to_json({ blankrows: true }) が生成する空行を弾く用途。 */
function isBlankRow(row: RawRow): boolean {
  return Object.values(row).every(v => v === '' || v === undefined)
}

function pushError(errors: RowError[], sheet: string, index: number, column: string, reason: string) {
  errors.push({ sheet, row: index + 2, column, reason })
}

/** '月末' | '1'..'28' の検証。OKならtrue。 */
function isValidDay(v: string): boolean {
  if (v === '月末') return true
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 28
}

function dayToNumber(v: string): number {
  return v === '月末' ? 30 : Number(v)
}

function emptyToNull(v: string | undefined): string | null {
  return v === undefined || v === '' ? null : v
}

const CATEGORY_MAP: Record<string, string> = { '輸送系': 'transport', '作業系': 'work' }

/** '15,000' '１５０００' を 15000 にする。0以上の整数として解釈できなければ null。 */
function parseAmount(v: string): number | null {
  const s = v.normalize('NFKC').replace(/,/g, '').trim()
  if (!/^\d+$/.test(s)) return null
  return Number(s)
}

// ── 請求先（clients） ────────────────────────────────────

function validateAndConvertClients(
  rows: RawRow[],
  errors: RowError[],
  existing: ExistingSets,
): Array<Record<string, unknown>> {
  const sheet = SHEET_NAMES.clients
  const results: Array<Record<string, unknown>> = []
  const seenNames = new Set<string>()

  rows.forEach((row, index) => {
    if (isExampleRow(row)) return
    if (isBlankRow(row)) return

    const companyName = row['会社名'] ?? ''
    if (!companyName) {
      pushError(errors, sheet, index, '会社名', '必須項目です')
    }

    const closingDay = row['締め日'] ?? ''
    if (!closingDay) {
      pushError(errors, sheet, index, '締め日', '必須項目です')
    } else if (!isValidDay(closingDay)) {
      pushError(errors, sheet, index, '締め日', '「月末」または1〜28で入力してください')
    }

    const paymentMonth = row['支払月'] ?? ''
    if (!paymentMonth) {
      pushError(errors, sheet, index, '支払月', '必須項目です')
    } else if (!(paymentMonth in MONTH_OFFSETS)) {
      pushError(errors, sheet, index, '支払月', `「${Object.keys(MONTH_OFFSETS).join('」「')}」のいずれかで入力してください`)
    }

    const paymentDay = row['支払日'] ?? ''
    if (!paymentDay) {
      pushError(errors, sheet, index, '支払日', '必須項目です')
    } else if (!isValidDay(paymentDay)) {
      pushError(errors, sheet, index, '支払日', '「月末」または1〜28で入力してください')
    }

    const taxType = row['税区分'] ?? ''
    if (!taxType) {
      pushError(errors, sheet, index, '税区分', '必須項目です')
    } else if (!(taxType in TAX_MAP)) {
      pushError(errors, sheet, index, '税区分', `「${Object.keys(TAX_MAP).join('」「')}」のいずれかで入力してください`)
    }

    const invoiceRegistered = row['インボイス登録'] ?? ''
    if (!invoiceRegistered) {
      pushError(errors, sheet, index, 'インボイス登録', '必須項目です')
    } else if (!(invoiceRegistered in YES_NO)) {
      pushError(errors, sheet, index, 'インボイス登録', '「あり」または「なし」で入力してください')
    }

    const useDepartments = row['部署を使う'] ?? ''
    if (!useDepartments) {
      pushError(errors, sheet, index, '部署を使う', '必須項目です')
    } else if (!(useDepartments in YES_NO)) {
      pushError(errors, sheet, index, '部署を使う', '「あり」または「なし」で入力してください')
    }

    const email = row['メール'] ?? ''
    if (email && !EMAIL_RE.test(email)) {
      pushError(errors, sheet, index, 'メール', 'メールアドレスの形式が不正です')
    }

    const accountType = row['口座種別'] ?? ''
    if (accountType && !ACCOUNT_TYPES.includes(accountType)) {
      pushError(errors, sheet, index, '口座種別', `「${ACCOUNT_TYPES.join('」「')}」のいずれかで入力してください`)
    }

    if (companyName) {
      if (seenNames.has(companyName)) {
        pushError(errors, sheet, index, '会社名', 'ファイル内で会社名が重複しています')
      }
      seenNames.add(companyName)
      if (existing.clientNames.includes(companyName)) {
        pushError(errors, sheet, index, '会社名', '既に登録されている会社名です')
      }
    }

    results.push({
      company_name: companyName,
      contact_name: emptyToNull(row['担当者名']),
      phone: emptyToNull(row['電話']),
      email: emptyToNull(email),
      closing_day: closingDay === '月末' ? 99 : Number(closingDay),
      payment_site: (MONTH_OFFSETS[paymentMonth] ?? 0) * 30 + dayToNumber(paymentDay || '月末'),
      tax_type: TAX_MAP[taxType] ?? taxType,
      invoice_registered: YES_NO[invoiceRegistered] ?? false,
      is_invoice_registered: YES_NO[invoiceRegistered] ?? false,
      has_invoice: YES_NO[invoiceRegistered] ?? false,
      bank_name: emptyToNull(row['銀行名']),
      bank_branch: emptyToNull(row['支店名']),
      account_type: emptyToNull(accountType),
      account_number: emptyToNull(row['口座番号']),
      account_holder: emptyToNull(row['口座名義']),
      use_departments: YES_NO[useDepartments] ?? false,
    })
  })

  return results
}

// ── 委託先（contractors） ────────────────────────────────

function validateAndConvertContractors(
  rows: RawRow[],
  errors: RowError[],
  existing: ExistingSets,
): Array<Record<string, unknown>> {
  const sheet = SHEET_NAMES.contractors
  const results: Array<Record<string, unknown>> = []
  const seenNames = new Set<string>()
  const seenEmails = new Set<string>()

  rows.forEach((row, index) => {
    if (isExampleRow(row)) return
    if (isBlankRow(row)) return

    const name = row['名前'] ?? ''
    if (!name) {
      pushError(errors, sheet, index, '名前', '必須項目です')
    }

    const email = row['メール'] ?? ''
    if (!email) {
      pushError(errors, sheet, index, 'メール', '必須項目です')
    } else if (!EMAIL_RE.test(email)) {
      pushError(errors, sheet, index, 'メール', 'メールアドレスの形式が不正です')
    }

    const closingDay = row['締め日'] ?? ''
    if (!closingDay) {
      pushError(errors, sheet, index, '締め日', '必須項目です')
    } else if (!isValidDay(closingDay)) {
      pushError(errors, sheet, index, '締め日', '「月末」または1〜28で入力してください')
    }

    const paymentMonth = row['支払月'] ?? ''
    if (!paymentMonth) {
      pushError(errors, sheet, index, '支払月', '必須項目です')
    } else if (!(paymentMonth in MONTH_OFFSETS)) {
      pushError(errors, sheet, index, '支払月', `「${Object.keys(MONTH_OFFSETS).join('」「')}」のいずれかで入力してください`)
    }

    const paymentDay = row['支払日'] ?? ''
    if (!paymentDay) {
      pushError(errors, sheet, index, '支払日', '必須項目です')
    } else if (!isValidDay(paymentDay)) {
      pushError(errors, sheet, index, '支払日', '「月末」または1〜28で入力してください')
    }

    const paymentMethod = row['支払方法'] ?? ''
    if (!paymentMethod) {
      pushError(errors, sheet, index, '支払方法', '必須項目です')
    } else if (!PAYMENT_METHODS.includes(paymentMethod)) {
      pushError(errors, sheet, index, '支払方法', `「${PAYMENT_METHODS.join('」「')}」のいずれかで入力してください`)
    }

    const taxType = row['税区分'] ?? ''
    if (!taxType) {
      pushError(errors, sheet, index, '税区分', '必須項目です')
    } else if (!(taxType in TAX_MAP)) {
      pushError(errors, sheet, index, '税区分', `「${Object.keys(TAX_MAP).join('」「')}」のいずれかで入力してください`)
    }

    const invoiceRegType = row['インボイス区分'] ?? ''
    if (!invoiceRegType) {
      pushError(errors, sheet, index, 'インボイス区分', '必須項目です')
    } else if (!INVOICE_REG_TYPES.includes(invoiceRegType)) {
      pushError(errors, sheet, index, 'インボイス区分', `「${INVOICE_REG_TYPES.join('」「')}」のいずれかで入力してください`)
    }

    const invoiceNumber = row['登録番号'] ?? ''
    if (invoiceRegType === '適格') {
      if (!invoiceNumber) {
        pushError(errors, sheet, index, '登録番号', '適格事業者は登録番号が必須です')
      } else if (!INVOICE_NUMBER_RE.test(invoiceNumber)) {
        pushError(errors, sheet, index, '登録番号', 'T+13桁の数字で入力してください（例: T1234567890123）')
      }
    } else if (invoiceRegType === '免税' && invoiceNumber) {
      pushError(errors, sheet, index, '登録番号', '免税事業者は登録番号を入力できません')
    }

    const accountType = row['口座種別'] ?? ''
    if (accountType && !ACCOUNT_TYPES.includes(accountType)) {
      pushError(errors, sheet, index, '口座種別', `「${ACCOUNT_TYPES.join('」「')}」のいずれかで入力してください`)
    }

    if (name) {
      if (seenNames.has(name)) {
        pushError(errors, sheet, index, '名前', 'ファイル内で名前が重複しています')
      }
      seenNames.add(name)
      if (existing.contractorNames.includes(name)) {
        pushError(errors, sheet, index, '名前', '既に登録されている名前です')
      }
    }
    if (email) {
      if (seenEmails.has(email)) {
        pushError(errors, sheet, index, 'メール', 'ファイル内でメールアドレスが重複しています')
      }
      seenEmails.add(email)
      if (existing.contractorEmails.includes(email)) {
        pushError(errors, sheet, index, 'メール', '既に登録されているメールアドレスです')
      }
    }

    results.push({
      name,
      phone: emptyToNull(row['電話']),
      email,
      payment_type: paymentMethod === '振込' ? 'bank_transfer' : paymentMethod,
      payment_site: (MONTH_OFFSETS[paymentMonth] ?? 0) * 30 + dayToNumber(paymentDay || '月末'),
      tax_category: TAX_MAP[taxType] ?? taxType,
      invoice_registration_type: invoiceRegType,
      invoice_number: emptyToNull(invoiceNumber),
      closing_day: closingDay,
      bank_name: emptyToNull(row['銀行名']),
      bank_branch: emptyToNull(row['支店名']),
      account_type: emptyToNull(accountType),
      account_number: emptyToNull(row['口座番号']),
      account_holder: emptyToNull(row['口座名義']),
      contractor_type: 'individual',
      has_withholding: false,
      show_detail_switch: true,
    })
  })

  return results
}

// ── 部署（departments） ──────────────────────────────────

function validateAndConvertDepartments(
  rows: RawRow[],
  errors: RowError[],
  fileClientNames: Set<string>,
  existing: ExistingSets,
): Array<{ clientName: string; payload: Record<string, unknown> }> {
  const sheet = SHEET_NAMES.departments
  const results: Array<{ clientName: string; payload: Record<string, unknown> }> = []
  const sortOrderByClient = new Map<string, number>()
  const seenKeys = new Set<string>()

  rows.forEach((row, index) => {
    if (isExampleRow(row)) return
    if (isBlankRow(row)) return

    const clientName = row['請求先名'] ?? ''
    if (!clientName) {
      pushError(errors, sheet, index, '請求先名', '必須項目です')
    } else if (!fileClientNames.has(clientName) && !existing.clientNames.includes(clientName)) {
      pushError(errors, sheet, index, '請求先名', '請求先シートにも既存データにも見つかりません')
    }

    const deptName = row['部署名'] ?? ''
    if (!deptName) {
      pushError(errors, sheet, index, '部署名', '必須項目です')
    }

    const email = row['メール'] ?? ''
    if (email && !EMAIL_RE.test(email)) {
      pushError(errors, sheet, index, 'メール', 'メールアドレスの形式が不正です')
    }

    if (clientName && deptName) {
      const key = departmentKey(clientName, deptName)
      if (seenKeys.has(key)) {
        pushError(errors, sheet, index, '部署名', 'ファイル内で請求先名+部署名が重複しています')
      }
      seenKeys.add(key)
      if (existing.departmentKeys.includes(key)) {
        pushError(errors, sheet, index, '部署名', '既に登録されている部署名です')
      }
    }

    const sortOrder = sortOrderByClient.get(clientName) ?? 0
    sortOrderByClient.set(clientName, sortOrder + 1)

    results.push({
      clientName,
      payload: {
        name: deptName,
        contact_name: emptyToNull(row['担当者名']),
        email: emptyToNull(email),
        phone: emptyToNull(row['電話']),
        sort_order: sortOrder,
      },
    })
  })

  return results
}

// ── 案件（projects） ─────────────────────────────────────
// この関数では必須・区分・数値のみ扱う。参照解決（荷主・部署・委託先の実在確認）と
// 重複検査は別タスクで追加する。

function validateAndConvertProjects(
  rows: RawRow[],
  errors: RowError[],
): ConvertedImport['projects'] {
  const sheet = SHEET_NAMES.projects
  const results: ConvertedImport['projects'] = []

  rows.forEach((row, index) => {
    if (isExampleRow(row)) return
    if (isBlankRow(row)) return

    const clientName = row['荷主'] ?? ''
    if (!clientName) pushError(errors, sheet, index, '荷主', '必須項目です')

    const projectName = row['案件名'] ?? ''
    if (!projectName) pushError(errors, sheet, index, '案件名', '必須項目です')

    const categoryLabel = row['区分'] ?? ''
    if (!categoryLabel) {
      pushError(errors, sheet, index, '区分', '必須項目です')
    } else if (!(categoryLabel in CATEGORY_MAP)) {
      pushError(errors, sheet, index, '区分', `「${Object.keys(CATEGORY_MAP).join('」「')}」のいずれかで入力してください`)
    }

    const saleRaw = row['売上単価'] ?? ''
    const sale = saleRaw === '' ? null : parseAmount(saleRaw)
    if (saleRaw === '') {
      pushError(errors, sheet, index, '売上単価', '必須項目です')
    } else if (sale === null) {
      pushError(errors, sheet, index, '売上単価', '0以上の整数で入力してください')
    }

    const buyRaw = row['仕入単価'] ?? ''
    const buy = buyRaw === '' ? null : parseAmount(buyRaw)
    if (buyRaw !== '' && buy === null) {
      pushError(errors, sheet, index, '仕入単価', '0以上の整数で入力してください')
    }

    const deptName = row['部署'] ?? ''
    const contractorName = row['委託先'] ?? ''

    results.push({
      clientName,
      departmentName: deptName === '' ? null : deptName,
      contractorName: contractorName === '' ? null : contractorName,
      payload: {
        project_name: projectName,
        category: CATEGORY_MAP[categoryLabel] ?? categoryLabel,
        sale_amount: sale ?? 0,
        buy_amount: buy,
        unit_type: 'quantity',
        status: 'accepted',
        driver_visible: true,
      },
    })
  })

  return results
}

// ── エントリポイント ─────────────────────────────────────

export function validateAndConvert(
  file: ImportFile,
  existing: ExistingSets,
): { data: ConvertedImport | null; errors: RowError[] } {
  const errors: RowError[] = []

  const clients = validateAndConvertClients(file.clients, errors, existing)
  const contractors = validateAndConvertContractors(file.contractors, errors, existing)

  const fileClientNames = new Set(
    file.clients.filter(r => !isExampleRow(r)).map(r => r['会社名']).filter(Boolean),
  )
  const departments = validateAndConvertDepartments(file.departments, errors, fileClientNames, existing)
  const projects = validateAndConvertProjects(file.projects, errors)

  if (errors.length > 0) {
    return { data: null, errors }
  }

  return { data: { clients, contractors, departments, projects }, errors: [] }
}
