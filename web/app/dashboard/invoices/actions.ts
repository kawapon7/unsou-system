'use server'

import { createClient } from '@/utils/supabase/server'
import { calculateTax, type TaxLineItem } from '@/utils/tax'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

/**
 * 請求書を確定・保存する
 * ① DBの明細行からは「税抜き金額」のみを取得し、明細ごとの消費税計算・端数処理は行わない。
 * ⑤ 確定した金額、消費税額をスナップショットとして invoices テーブルに保存する。
 */
export async function finalizeInvoice(formData: FormData) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const project_id = formData.get('project_id') as string
  const client_id = formData.get('client_id') as string
  const target_month = formData.get('target_month') as string // 例: "2026-06"

  // ① 対象月の勤務記録（tax_excl金額）を取得
  const { data: workRecords, error: workError } = await supabase
    .from('work_records')
    .select('id, quantity, status')
    .eq('project_id', project_id)
    .gte('date', `${target_month}-01`)
    .lte('date', `${target_month}-31`)
    .eq('status', 'approved')

  if (workError) {
    console.error(workError)
    redirect('/dashboard?error=勤務記録の取得に失敗しました')
  }

  // 案件の単価ルール・荷主インボイス区分を取得
  const { data: priceRule } = await supabase
    .from('price_rules')
    .select('calculation_type, sales_price')
    .eq('project_id', project_id)
    .single()

  const { data: client } = await supabase
    .from('clients')
    .select('tax_treatment, has_invoice')
    .eq('id', client_id)
    .single()

  if (!priceRule || !client) {
    redirect('/dashboard?error=案件または荷主情報の取得に失敗しました')
  }

  // 荷主のインボイス区分を判定
  const invoiceCategory = !client.has_invoice
    ? 'exempt'
    : client.tax_treatment === 'exempt'
    ? 'exempt'
    : 'registered'

  // ② 明細をカテゴリ分類し、税抜き金額のみを集める（明細ごとの端数処理は行わない）
  const lineItems: TaxLineItem[] = (workRecords ?? []).map((rec) => ({
    amount: (rec.quantity ?? 0) * (priceRule.sales_price ?? 0),
    invoiceCategory,
  }))

  // 立替金も取得してカテゴリ分類
  const { data: expenseRecords } = await supabase
    .from('expense_records')
    .select('amount, expense_type')
    .eq('contractor_id', project_id)
    .gte('date', `${target_month}-01`)
    .lte('date', `${target_month}-31`)
    .eq('status', 'approved')

  const expenseItems: TaxLineItem[] = (expenseRecords ?? []).map((e) => ({
    amount: e.amount ?? 0,
    invoiceCategory: 'registered', // 立替金は課税（登録あり扱い）
  }))

  const allItems = [...lineItems, ...expenseItems]
  const transactionDate = new Date(`${target_month}-01`)

  // ③④ カテゴリごとの総額に対して1回のみ四捨五入・経過措置適用
  const taxSummary = calculateTax(allItems, transactionDate)

  // ⑤ スナップショットとして invoices テーブルに保存
  const { error: insertError } = await supabase.from('invoices').insert([
    {
      project_id,
      client_id,
      target_month,
      subtotal_registered: taxSummary.registeredSubtotal,
      tax_registered: taxSummary.registeredTax,
      subtotal_unregistered: taxSummary.unregisteredSubtotal,
      tax_unregistered: taxSummary.unregisteredTax,
      deduction_unregistered: taxSummary.unregisteredDeduction,
      subtotal_exempt: taxSummary.exemptSubtotal,
      total_excluding_tax: taxSummary.totalExcludingTax,
      total_tax: taxSummary.totalTax,
      total_deduction: taxSummary.totalDeduction,
      total_amount: taxSummary.totalAmount,
      status: 'draft',
    },
  ])

  if (insertError) {
    console.error(insertError)
    redirect('/dashboard?error=請求書の保存に失敗しました')
  }

  revalidatePath('/dashboard')
  redirect('/dashboard?success=請求書を作成しました')
}

/**
 * 支払通知書を確定・保存する
 * 委託先（contractors）ごとに同様のロジックで計算し payment_notices へスナップショット保存
 */
export async function finalizePaymentNotice(formData: FormData) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const contractor_id = formData.get('contractor_id') as string
  const target_month = formData.get('target_month') as string

  // 委託先のインボイス区分を取得
  const { data: contractor } = await supabase
    .from('contractors')
    .select('invoice_status, tax_type')
    .eq('id', contractor_id)
    .single()

  if (!contractor) redirect('/dashboard?error=委託先情報の取得に失敗しました')

  // ② 委託先のインボイス登録区分でカテゴリ判定
  const invoiceCategory =
    contractor.invoice_status === 'registered' ? 'registered' :
    contractor.tax_type === 'exempt' ? 'exempt' : 'unregistered'

  // ① 対象月の承認済み勤務記録（税抜き金額）を取得
  const { data: workRecords } = await supabase
    .from('work_records')
    .select('quantity, project_id')
    .eq('contractor_id', contractor_id)
    .gte('date', `${target_month}-01`)
    .lte('date', `${target_month}-31`)
    .eq('status', 'approved')

  // 買値（支払単価）を案件ごとに取得してライン明細を構築
  const lineItems: TaxLineItem[] = []
  for (const rec of workRecords ?? []) {
    const { data: pr } = await supabase
      .from('price_rules')
      .select('buying_price')
      .eq('project_id', rec.project_id)
      .single()
    lineItems.push({
      amount: (rec.quantity ?? 0) * (pr?.buying_price ?? 0),
      invoiceCategory,
    })
  }

  // 立替金（承認済み）
  const { data: expenseRecords } = await supabase
    .from('expense_records')
    .select('amount')
    .eq('contractor_id', contractor_id)
    .gte('date', `${target_month}-01`)
    .lte('date', `${target_month}-31`)
    .eq('status', 'approved')

  const expenseItems: TaxLineItem[] = (expenseRecords ?? []).map((e) => ({
    amount: e.amount ?? 0,
    invoiceCategory: 'registered',
  }))

  const allItems = [...lineItems, ...expenseItems]
  const transactionDate = new Date(`${target_month}-01`)

  // ③④ カテゴリごとの総額に対して1回のみ四捨五入・経過措置適用
  const taxSummary = calculateTax(allItems, transactionDate)

  // ⑤ スナップショットとして payment_notices テーブルに保存
  const { error: insertError } = await supabase.from('payment_notices').insert([
    {
      contractor_id,
      target_month,
      subtotal_registered: taxSummary.registeredSubtotal,
      tax_registered: taxSummary.registeredTax,
      subtotal_unregistered: taxSummary.unregisteredSubtotal,
      tax_unregistered: taxSummary.unregisteredTax,
      deduction_unregistered: taxSummary.unregisteredDeduction,
      subtotal_exempt: taxSummary.exemptSubtotal,
      total_excluding_tax: taxSummary.totalExcludingTax,
      total_tax: taxSummary.totalTax,
      total_deduction: taxSummary.totalDeduction,
      total_amount: taxSummary.totalAmount,
      status: 'pending',
    },
  ])

  if (insertError) {
    console.error(insertError)
    redirect('/dashboard?error=支払通知書の保存に失敗しました')
  }

  revalidatePath('/dashboard')
  redirect('/dashboard?success=支払通知書を作成しました')
}
