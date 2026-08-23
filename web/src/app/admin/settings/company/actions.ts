'use server'

import { createServiceClient } from '@/utils/supabase/service'
import { requireOwner } from '@/utils/auth'
import { getCurrentTenantId } from '@/utils/tenant'
import { encryptBankFields, decryptBankFieldValue } from '@/utils/crypto'
import { DEFAULT_INVOICE_NUMBER_FORMAT, validateDocumentNumberFormat } from '@/utils/document-number'
import { listDocumentFormatOptions } from '@/utils/document-formats'

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

/** 編集フォームが扱う形（復号済み・平文） */
export type CompanyFormValues = {
  name:               string
  invoice_reg_number: string
  postal_code:        string
  address:            string
  phone:              string
  email:              string
  bank_name:          string
  bank_branch:        string
  account_type:       string
  account_number:     string
  account_holder:     string
  /** 決算月（'1'〜'12'）。未設定は空文字。事業年度 = 決算月の翌月1日〜決算月末日 */
  fiscal_year_end_month: string
  /** 支払通知書を作ってから子分の返事を待つ日数（'0'〜'90'）。0 は待たない運用 */
  payment_notice_response_days: string
  transport_insurance_amount: string
  /** 請求書番号の採番書式（例 INV-{YYYY}{MM}-{SEQ:4}）。utils/document-number.ts 参照 */
  invoice_number_format: string
  /** 標準の帳票様式キー（utils/document-formats.ts のレジストリ） */
  document_format_key: string
  /** 印影（社判）PNG の data URL。空文字は未登録（保存時に NULL） */
  seal_image: string
}

/** 印影の上限（data URL の文字数 ≒ 元PNGの 4/3 倍）。300KB の PNG ≒ 40万文字 */
const SEAL_IMAGE_MAX_CHARS = 420_000

const EMPTY: CompanyFormValues = {
  name: '', invoice_reg_number: '', postal_code: '', address: '', phone: '', email: '',
  bank_name: '', bank_branch: '', account_type: '', account_number: '', account_holder: '',
  fiscal_year_end_month: '',
  payment_notice_response_days: '7',
  transport_insurance_amount: '1000',
  invoice_number_format: DEFAULT_INVOICE_NUMBER_FORMAT,
  document_format_key: 'standard',
  seal_image: '',
}

/**
 * 自社情報を編集フォーム用に取得する。
 * 未登録なら空のフォーム値を返す（エラーにしない）。
 * ⚠️ PDF生成側は utils/company.ts の getCompanyInfo を使うこと。あちらは未登録をエラーにする。
 */
export async function fetchCompanyForEdit(): Promise<ActionResult<CompanyFormValues>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }

  const tenantId = await getCurrentTenantId()
  const service  = createServiceClient()

  const { data, error } = await service
    .from('companies').select('*').eq('tenant_id', tenantId).maybeSingle()

  if (error) return { data: null, error: error.message }
  if (!data)  return { data: EMPTY, error: null }

  return {
    data: {
      name:               data.name               ?? '',
      invoice_reg_number: data.invoice_reg_number ?? '',
      postal_code:        data.postal_code        ?? '',
      address:            data.address            ?? '',
      phone:              data.phone              ?? '',
      email:              data.email              ?? '',
      // account_type は BANK_FIELD_KEYS 対象外のため平文のまま
      bank_name:          decryptBankFieldValue(data.bank_name),
      bank_branch:        decryptBankFieldValue(data.bank_branch),
      account_type:       data.account_type       ?? '',
      account_number:     decryptBankFieldValue(data.account_number),
      account_holder:     decryptBankFieldValue(data.account_holder),
      fiscal_year_end_month:
        (data as { fiscal_year_end_month?: number | null }).fiscal_year_end_month?.toString() ?? '',
      payment_notice_response_days:
        (data as { payment_notice_response_days?: number | null })
          .payment_notice_response_days?.toString() ?? '7',
      transport_insurance_amount:
        (data as { transport_insurance_amount?: number | null })
          .transport_insurance_amount?.toString() ?? '1000',
      invoice_number_format: data.invoice_number_format || DEFAULT_INVOICE_NUMBER_FORMAT,
      document_format_key:   data.document_format_key   || 'standard',
      seal_image:            (data as { seal_image?: string | null }).seal_image ?? '',
    },
    error: null,
  }
}

/**
 * 自社情報を保存する（1テナント1行。無ければ作成、あれば更新）。
 * 口座情報はサーバーサイドで AES-256-GCM 暗号化してから保存する。
 */
export async function saveCompany(values: CompanyFormValues): Promise<ActionResult<null>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }

  const name       = values.name.trim()
  const invoiceReg = values.invoice_reg_number.trim()
  if (!name)       return { data: null, error: '会社名は必須です。' }
  if (!invoiceReg) return { data: null, error: 'インボイス登録番号は必須です。' }

  // 決算月: 未入力なら NULL（暦年で集計する）。1〜12 以外は弾く
  // ⚠️ DB 側にも CHECK 制約があるが、ここで止めたほうが分かるエラーになる
  const fiscalRaw = values.fiscal_year_end_month.trim()
  let fiscalYearEndMonth: number | null = null
  if (fiscalRaw !== '') {
    const n = Number(fiscalRaw)
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      return { data: null, error: '決算月は1〜12の月で指定してください。' }
    }
    fiscalYearEndMonth = n
  }

  // 返事の待機日数: 0〜90。⚠️ 空欄を既定値で握りつぶさない（設定したつもりのズレを防ぐ）
  const daysRaw = values.payment_notice_response_days.trim()
  const days = Number(daysRaw)
  if (daysRaw === '' || !Number.isInteger(days) || days < 0 || days > 90) {
    return { data: null, error: '返事を待つ日数は0〜90の整数で指定してください。' }
  }

  // 運送保険料: 0以上の整数。⚠️ 空欄を既定値で握りつぶさない（返事の待機日数と同じ方針）。
  //    ここを黙って1000に戻すと、0にしたつもりの会社から毎月1,000円を相殺してしまう。
  const insuranceRaw = values.transport_insurance_amount.trim()
  const insurance = Number(insuranceRaw)
  if (insuranceRaw === '' || !Number.isInteger(insurance) || insurance < 0) {
    return { data: null, error: '運送保険料は0以上の整数で指定してください。' }
  }

  // 採番書式: {SEQ} 必須・未知トークン拒否。空欄は既定書式に戻す
  const numberFormat = values.invoice_number_format.trim() || DEFAULT_INVOICE_NUMBER_FORMAT
  const fmtErr = validateDocumentNumberFormat(numberFormat)
  if (fmtErr) return { data: null, error: `請求書番号の書式: ${fmtErr}` }
  // 様式キー: レジストリに無いものは standard に倒す
  const formatKey = listDocumentFormatOptions('invoice').some(o => o.key === values.document_format_key)
    ? values.document_format_key : 'standard'

  // 印影: PNG の data URL のみ受け付ける（SVG は script を含みうるので不可）。サイズ上限あり
  const sealRaw = values.seal_image.trim()
  if (sealRaw !== '') {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(sealRaw)) {
      return { data: null, error: '印影は PNG 画像のみ登録できます。' }
    }
    if (sealRaw.length > SEAL_IMAGE_MAX_CHARS) {
      return { data: null, error: '印影の画像が大きすぎます（300KB 以下の PNG にしてください）。' }
    }
  }

  const tenantId = await getCurrentTenantId()
  const service  = createServiceClient()

  // encryptBankFields が bank_name / bank_branch / account_number / account_holder を暗号化する。
  // account_type は対象外なので平文のまま渡る（既存の clients / contractors と同じ扱い）。
  const payload = {
    ...encryptBankFields({
      bank_name:      values.bank_name.trim(),
      bank_branch:    values.bank_branch.trim(),
      account_number: values.account_number.trim(),
      account_holder: values.account_holder.trim(),
    }),
    name,
    invoice_reg_number: invoiceReg,
    postal_code:        values.postal_code.trim(),
    address:            values.address.trim(),
    phone:              values.phone.trim(),
    email:              values.email.trim(),
    account_type:       values.account_type.trim(),
    fiscal_year_end_month: fiscalYearEndMonth,
    payment_notice_response_days: days,
    transport_insurance_amount: insurance,
    invoice_number_format: numberFormat,
    document_format_key:   formatKey,
    seal_image:            sealRaw === '' ? null : sealRaw,
    tenant_id:          tenantId,
    updated_at:         new Date().toISOString(),
  }

  const { data: existing } = await service
    .from('companies').select('id').eq('tenant_id', tenantId).maybeSingle()

  const { error } = existing
    ? await service.from('companies').update(payload).eq('id', existing.id)
    : await service.from('companies').insert(payload)

  if (error) {
    // tenant_id の UNIQUE 制約に当たった場合＝同時保存の競合
    if (error.message.includes('companies_tenant_id_unique')) {
      return { data: null, error: '他の操作と競合しました。画面を再読み込みしてもう一度保存してください。' }
    }
    return { data: null, error: error.message }
  }
  return { data: null, error: null }
}
