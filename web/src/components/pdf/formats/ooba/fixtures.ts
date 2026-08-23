import type { InvoicePdfData, PaymentNoticePdfData } from '@/app/_actions/pdf-actions'
import type { CompanyInfo } from '@/utils/company'

// ⚠️ 検証専用の架空データ。実名・実在の口座・登録番号を入れない。
const COMPANY: CompanyInfo = {
  name: '株式会社テスト運送', invoiceRegNumber: 'T0000000000000', postalCode: '000-0000',
  address: '広島市テスト区1-2-3', phone: '000-0000-0000', email: 'test@example.com',
  bank: { bankName: 'テスト銀行', bankBranch: 'テスト支店', accountType: '普通', accountNumber: '0000000', accountHolder: 'カ）テストウンソウ' },
}

export const OOBA_INVOICE_FIXTURE: InvoicePdfData = {
  invoiceNumber: 'INV-202606-0001', issueDate: '2026-07-06', dueDate: '2026-07-31',
  clientName: '株式会社テスト荷主', contactName: null, invoiceMonth: '2026年06月分',
  yearMonth: '2026-06', formatKey: 'ooba', subject: 'R8．6月度 業務委託費', noteLines: ['※人員結果は別紙参照'],
  lines: [
    ...Array.from({ length: 14 }, (_, i) => ({ workDate: `2026-06-${String(i + 1).padStart(2, '0')}`, projectName: 'Aデバンニング作業', quantity: 1, netAmount: 16000, pieceCount: 1, isWorkType: true })),
    ...Array.from({ length: 4 },  (_, i) => ({ workDate: `2026-06-${String(i + 15).padStart(2, '0')}`, projectName: 'Aデバンニング作業', quantity: 2, netAmount: 26000, pieceCount: 2, isWorkType: true })),
    ...Array.from({ length: 22 }, (_, i) => ({ workDate: `2026-06-${String(i + 1).padStart(2, '0')}`, projectName: 'B荷役作業', quantity: 1, netAmount: 12000, pieceCount: null, isWorkType: true })),
  ],
  netTotal: 14 * 16000 + 4 * 26000 + 22 * 12000, taxAmount: 0, totalAmount: 0, isTaxable: true, company: COMPANY,
}
OOBA_INVOICE_FIXTURE.taxAmount   = Math.round(OOBA_INVOICE_FIXTURE.netTotal * 0.1)
OOBA_INVOICE_FIXTURE.totalAmount = OOBA_INVOICE_FIXTURE.netTotal + OOBA_INVOICE_FIXTURE.taxAmount

export const OOBA_PAYMENT_NOTICE_FIXTURE: PaymentNoticePdfData = {
  contractorName: 'テスト 太郎', invoiceRegistration: 'unregistered', noticeMonth: '2025年11月分', issueDate: '2026-01-15',
  formatKey: 'ooba',
  laborLines: Array.from({ length: 18 }, (_, i) => ({
    workDate: `2025-11-${String(i + 1).padStart(2, '0')}`, projectName: 'C配送 2t', quantity: 1, netAmount: 12728,
    startTime: '08:00', endTime: '17:00', breakMinutes: 60, sellingAmount: 16000,
  })),
  expenseLines: [],
  laborNet: 229104, laborTax: 22910, expenseNet: 0, expenseTax: 0,
  deductionRate: 0.02, deduction: 5040, insuranceDeduction: 1000, adjustment: -13, manualAdjustment: -13,
  totalAmount: 229104 - 13 + 22910 - 5040 - 1000, company: COMPANY,
}
