/**
 * 自社（請求書発行元）情報の単一の情報源。
 *
 * PDF生成側はこのモジュール経由でのみ自社情報を取得する。
 * 以前は各PDFテンプレートに COMPANY 定数がハードコードされ、
 * 環境変数 NEXT_PUBLIC_COMPANY_* でのみ上書きできる作りだった。
 * それだと1デプロイ＝1社分しか持てずマルチテナントで破綻するため、DBに移した。
 *
 * ⚠️ このファイルはサーバー専用。service client と復号キーを使うため
 *    クライアントコンポーネントから import しないこと。
 */

import { createServiceClient } from '@/utils/supabase/service'
import { decryptBankFieldValue } from '@/utils/crypto'

/** PDFに印字する自社情報（復号済み・そのまま表示してよい形） */
export type CompanyInfo = {
  name:             string
  invoiceRegNumber: string
  postalCode:       string
  address:          string
  phone:            string
  email:            string
  /** 振込先。請求書にのみ印字する（支払通知書には出さない） */
  bank: {
    bankName:      string
    bankBranch:    string
    accountType:   string
    accountNumber: string
    accountHolder: string
  }
}

export type CompanyInfoResult =
  | { data: CompanyInfo; error: null }
  | { data: null; error: string }

const NOT_REGISTERED =
  '自社情報が登録されていません。「マスタ管理 → 自社情報」から会社名と登録番号を登録してください。'

/**
 * 自社情報を取得する。
 *
 * ⚠️ fail-closed: 未登録、または請求書の必須項目（会社名・登録番号）が空の場合は
 *    仮の値で代替せずエラーを返す。誤った登録番号を載せた請求書を社外に出すと、
 *    受け取った荷主が仕入税額控除を受けられなくなるため。
 */
export async function getCompanyInfo(tenantId: string): Promise<CompanyInfoResult> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('companies')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  if (!data)  return { data: null, error: NOT_REGISTERED }

  const name       = (data.name ?? '').trim()
  const invoiceReg = (data.invoice_reg_number ?? '').trim()
  if (!name || !invoiceReg) return { data: null, error: NOT_REGISTERED }

  return {
    data: {
      name,
      invoiceRegNumber: invoiceReg,
      postalCode:       data.postal_code ?? '',
      address:          data.address     ?? '',
      phone:            data.phone       ?? '',
      email:            data.email       ?? '',
      bank: {
        // bank_name / bank_branch / account_number / account_holder は
        // utils/crypto.ts の BANK_FIELD_KEYS に含まれるため暗号化されている。
        // account_type だけは対象外で平文保存（既存の clients/contractors と同じ扱い）。
        bankName:      decryptBankFieldValue(data.bank_name),
        bankBranch:    decryptBankFieldValue(data.bank_branch),
        accountType:   data.account_type ?? '',
        accountNumber: decryptBankFieldValue(data.account_number),
        accountHolder: decryptBankFieldValue(data.account_holder),
      },
    },
    error: null,
  }
}

/** 振込先が請求書に印字できる状態か（全項目埋まっているか） */
export function hasBankInfo(company: CompanyInfo): boolean {
  const b = company.bank
  return Boolean(b.bankName && b.bankBranch && b.accountNumber && b.accountHolder)
}
