import type { InvoicePdfData, PaymentNoticePdfData } from '@/app/_actions/pdf-actions'
import type { CompanyInfo } from '@/utils/company'

// ⚠️ 検証専用の架空データ。実名・実在の口座・登録番号を入れない。
const COMPANY: CompanyInfo = {
  name: '株式会社テスト運送', invoiceRegNumber: 'T0000000000000', postalCode: '000-0000',
  address: '広島市テスト区1-2-3', phone: '000-0000-0000', email: 'test@example.com',
  bank: { bankName: 'テスト銀行', bankBranch: 'テスト支店', accountType: '普通', accountNumber: '0000000', accountHolder: 'カ）テストウンソウ' },
}

// ⚠️ netTotal/taxAmount/totalAmount は INVOICE_LINES から計算する（事後の代入で export 済みの
//    定数を書き換えない）。exported const を後から mutate すると import 側で参照タイミング次第の
//    値になりうるため。
const INVOICE_LINES = [
  ...Array.from({ length: 14 }, (_, i) => ({ workDate: `2026-06-${String(i + 1).padStart(2, '0')}`, projectName: 'Aデバンニング作業', quantity: 1, netAmount: 16000, pieceCount: 1, isWorkType: true })),
  ...Array.from({ length: 4 },  (_, i) => ({ workDate: `2026-06-${String(i + 15).padStart(2, '0')}`, projectName: 'Aデバンニング作業', quantity: 2, netAmount: 26000, pieceCount: 2, isWorkType: true })),
  ...Array.from({ length: 22 }, (_, i) => ({ workDate: `2026-06-${String(i + 1).padStart(2, '0')}`, projectName: 'B荷役作業', quantity: 1, netAmount: 12000, pieceCount: null, isWorkType: true })),
]
const INVOICE_NET_TOTAL = INVOICE_LINES.reduce((s, l) => s + l.netAmount, 0)
const INVOICE_TAX_AMOUNT = Math.round(INVOICE_NET_TOTAL * 0.1)

export const OOBA_INVOICE_FIXTURE: InvoicePdfData = {
  invoiceNumber: 'INV-202606-0001', issueDate: '2026-07-06', dueDate: '2026-07-31',
  clientName: '株式会社テスト荷主', contactName: null, invoiceMonth: '2026年06月分',
  yearMonth: '2026-06', formatKey: 'ooba', subject: 'R8．6月度 業務委託費', noteLines: ['※人員結果は別紙参照'],
  lines: INVOICE_LINES,
  netTotal: INVOICE_NET_TOTAL, taxAmount: INVOICE_TAX_AMOUNT, totalAmount: INVOICE_NET_TOTAL + INVOICE_TAX_AMOUNT,
  isTaxable: true, company: COMPANY,
}

// ⚠️ 支払通知書フィクスチャは本票の差引式（laborNet + adjustment + laborTax − deduction −
//    insuranceDeduction + expenseNet + expenseTax）と整合させる。deduction は
//    10%対象小計【①】（= laborNet + adjustment）の deductionRate 分（丸めは Math.round）。
const LABOR_LINES = Array.from({ length: 18 }, (_, i) => ({
  workDate: `2025-11-${String(i + 1).padStart(2, '0')}`, projectName: 'C配送 2t', quantity: 1, netAmount: 12728,
  startTime: '08:00', endTime: '17:00', breakMinutes: 60, sellingAmount: 16000,
}))
const EXPENSE_LINES = [
  { expenseDate: '2025-11-03', expenseType: '高速料金', netAmount: 3000, taxAmount: 300 },
  { expenseDate: '2025-11-10', expenseType: '駐車場代', netAmount: 500,  taxAmount: 50 },
  { expenseDate: '2025-11-18', expenseType: '高速料金', netAmount: 2000, taxAmount: 200 },
]
const LABOR_NET = 229104
const LABOR_TAX = 22910
const ADJUSTMENT = -13
const DEDUCTION_RATE = 0.02
const DEDUCTION = Math.round((LABOR_NET + ADJUSTMENT) * DEDUCTION_RATE) // 2% of 229,091 → 4,582
const INSURANCE_DEDUCTION = 1000
const EXPENSE_NET = EXPENSE_LINES.reduce((s, e) => s + e.netAmount, 0)
const EXPENSE_TAX = EXPENSE_LINES.reduce((s, e) => s + e.taxAmount, 0)

export const OOBA_PAYMENT_NOTICE_FIXTURE: PaymentNoticePdfData = {
  contractorName: 'テスト 太郎', invoiceRegistration: 'unregistered', noticeMonth: '2025年11月分', issueDate: '2026-01-15',
  formatKey: 'ooba',
  laborLines: LABOR_LINES,
  expenseLines: EXPENSE_LINES,
  laborNet: LABOR_NET, laborTax: LABOR_TAX, expenseNet: EXPENSE_NET, expenseTax: EXPENSE_TAX,
  deductionRate: DEDUCTION_RATE, deduction: DEDUCTION, insuranceDeduction: INSURANCE_DEDUCTION,
  adjustment: ADJUSTMENT, manualAdjustment: ADJUSTMENT,
  totalAmount: LABOR_NET + ADJUSTMENT + LABOR_TAX - DEDUCTION - INSURANCE_DEDUCTION + EXPENSE_NET + EXPENSE_TAX,
  company: COMPANY,
}
