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
}

export type RowError = {
  sheet: string
  row: number // Excel行番号（データ1行目=3。1=ヘッダ, 2=記入例）
  column: string
  reason: string
}

export type ExistingSets = {
  clientNames: string[]
  contractorNames: string[]
  contractorEmails: string[]
}

export type ConvertedImport = {
  clients: Array<Record<string, unknown>>
  departments: Array<{ clientName: string; payload: Record<string, unknown> }>
  contractors: Array<Record<string, unknown>>
}

export const SHEET_NAMES = {
  contractors: '委託先',
  clients: '請求先',
  departments: '部署',
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

function isExampleRow(row: RawRow): boolean {
  const firstValue = Object.values(row)[0]
  return typeof firstValue === 'string' && firstValue.startsWith('例）')
}

function pushError(errors: RowError[], sheet: string, index: number, column: string, reason: string) {
  errors.push({ sheet, row: index + 3, column, reason })
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

  rows.forEach((row, index) => {
    if (isExampleRow(row)) return

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

  if (errors.length > 0) {
    return { data: null, errors }
  }

  return { data: { clients, contractors, departments }, errors: [] }
}
