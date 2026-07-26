'use server'

import { createServiceClient } from '@/utils/supabase/service'
import { requireOwner } from '@/utils/auth'
import { getCurrentTenantId } from '@/utils/tenant'
import { encryptBankFields, decryptBankFieldValue } from '@/utils/crypto'

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
}

const EMPTY: CompanyFormValues = {
  name: '', invoice_reg_number: '', postal_code: '', address: '', phone: '', email: '',
  bank_name: '', bank_branch: '', account_type: '', account_number: '', account_holder: '',
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
