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

// ── 支払通知書の「返事を待つ日数」 ────────────────────────────
//
// 設計書 §2-3-9 の備考「タイムリミット後は確定ロック」を実装するための設定値。
// ⚠️ 何日待つかは会社ごとのローカルルール（2026-08-02 ボス判断）。ここでベタ書きしないこと。
// ⚠️ 起算日は「支払通知書を作った日」（payment_notices.created_at）。

/** 列が無い/行が無いときのフォールバック。DB 側の DEFAULT と必ず揃えること */
const DEFAULT_RESPONSE_DAYS = 7

export async function getPaymentNoticeResponseDays(
  tenantId: string,
): Promise<{ days: number; error: null } | { days: null; error: string }> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('companies')
    .select('payment_notice_response_days')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  // ⚠️ fail-open 厳禁: 取得できなかったときに既定値で通すと、
  //    「待つ設定にしてあるのに待たずに確定できた」が起こりうる。確認できないなら止める。
  if (error) return { days: null, error: `自社設定の取得に失敗しました: ${error.message}` }

  // 自社情報が未登録なら DB の DEFAULT と同じ値で運用する（行が無いだけで設定ミスではない）
  return { days: data?.payment_notice_response_days ?? DEFAULT_RESPONSE_DAYS, error: null }
}

/**
 * 「未応答のまま確定」してよい日時を返す。
 * @param noticeCreatedAt 支払通知書の生成日時（ISO 文字列）。まだ作られていなければ null
 */
export function lockableAtFrom(noticeCreatedAt: string | null, responseDays: number): Date | null {
  if (!noticeCreatedAt) return null
  const base = new Date(noticeCreatedAt)
  if (Number.isNaN(base.getTime())) return null
  return new Date(base.getTime() + responseDays * 24 * 60 * 60 * 1000)
}
