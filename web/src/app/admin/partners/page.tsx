'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  fetchClients,
  fetchContractors,
  createClient_,
  updateClient,
  deleteClient,
  deleteContractor,
  createContractor,
  updateContractor,
} from './actions'
import type { Database } from '@/types/supabase'

type ClientRow = Database['public']['Tables']['clients']['Row']
type ContractorRow = Database['public']['Tables']['contractors']['Row']

type ClientInsert = Database['public']['Tables']['clients']['Insert']
type ContractorInsert = Database['public']['Tables']['contractors']['Insert']

// ── 定数 ─────────────────────────────────────────────────

const TAX_TYPES = [
  { value: 'exclusive', label: '外税' },
  { value: 'inclusive', label: '内税' },
  { value: 'exempt',    label: '非課税' },
] as const

const ACCOUNT_TYPES = [
  { value: '普通', label: '普通' },
  { value: '当座', label: '当座' },
] as const

const PAYMENT_METHODS = [
  { value: '振込', label: '振込' },
  { value: '現金', label: '現金' },
] as const

const INVOICE_REG_TYPES = [
  { value: '適格', label: '適格事業者' },
  { value: '免税', label: '免税事業者' },
] as const

// ── 荷主フォームの型 ──────────────────────────────────────

type ClientForm = {
  company_name: string
  contact_name: string
  phone: string
  email: string
  closing_day: string
  payment_month_offset: string   // '0'=当月, '1'=翌月, '2'=翌々月, '3'=3ヶ月後
  payment_day: string            // '1'-'28' or '月末'
  tax_type: string
  invoice_registered: boolean
  bank_name: string
  bank_branch: string
  account_type: string
  account_number: string
  account_holder: string
}

const defaultClientForm = (): ClientForm => ({
  company_name: '',
  contact_name: '',
  phone: '',
  email: '',
  closing_day: '月末',
  payment_month_offset: '1',
  payment_day: '月末',
  tax_type: 'exclusive',
  invoice_registered: false,
  bank_name: '',
  bank_branch: '',
  account_type: '普通',
  account_number: '',
  account_holder: '',
})

// ── 委託先フォームの型 ────────────────────────────────────

type ContractorForm = {
  name: string
  phone: string
  email: string
  login_email: string
  payment_method: string
  closing_day: string
  payment_month_offset: string
  payment_day: string
  tax_type: string
  invoice_registration_type: string
  invoice_number: string
  same_person_id: string
  bank_name: string
  bank_branch: string
  account_type: string
  account_number: string
  account_holder: string
  parent_contractor_id: string
}

const defaultContractorForm = (): ContractorForm => ({
  name: '',
  phone: '',
  email: '',
  login_email: '',
  payment_method: '振込',
  closing_day: '月末',
  payment_month_offset: '1',
  payment_day: '月末',
  tax_type: 'exclusive',
  invoice_registration_type: '免税',
  invoice_number: '',
  same_person_id: '',
  bank_name: '',
  bank_branch: '',
  account_type: '普通',
  account_number: '',
  account_holder: '',
  parent_contractor_id: '',
})

// ── 共通コンポーネント ────────────────────────────────────

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300 disabled:bg-zinc-50 disabled:text-zinc-400'

const selectCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300'

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide border-b border-zinc-100 pb-1 mb-3 mt-5 first:mt-0">
      {children}
    </p>
  )
}

// ── モーダル ─────────────────────────────────────────────

function Modal({
  title,
  onClose,
  isDirty,
  children,
}: {
  title: string
  onClose: () => void
  isDirty?: boolean
  children: React.ReactNode
}) {
  function handleClose() {
    if (isDirty && !window.confirm('変更内容を破棄しますか？')) return
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          <button
            onClick={handleClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// ── 荷主フォーム ──────────────────────────────────────────

function ClientFormFields({
  form,
  onChange,
}: {
  form: ClientForm
  onChange: (f: ClientForm) => void
}) {
  const set = (k: keyof ClientForm, v: string | boolean) =>
    onChange({ ...form, [k]: v })

  return (
    <>
      <SectionTitle>基本情報</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Field label="会社名" required>
            <input className={inputCls} value={form.company_name} onChange={e => set('company_name', e.target.value)} required />
          </Field>
        </div>
        <Field label="担当者名">
          <input className={inputCls} value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
        </Field>
        <Field label="電話番号">
          <input className={inputCls} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="メールアドレス">
            <input className={inputCls} type="email" value={form.email} onChange={e => set('email', e.target.value)} />
          </Field>
        </div>
      </div>

      <SectionTitle>入金ルール（締め日・支払サイト）</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="締め日" required>
          <select className={selectCls} value={form.closing_day} onChange={e => set('closing_day', e.target.value)}>
            <option value="月末">月末</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
              <option key={d} value={String(d)}>{d}日</option>
            ))}
          </select>
        </Field>
        <Field label="支払月" required>
          <select className={selectCls} value={form.payment_month_offset} onChange={e => set('payment_month_offset', e.target.value)}>
            <option value="0">当月</option>
            <option value="1">翌月</option>
            <option value="2">翌々月</option>
            <option value="3">3ヶ月後</option>
          </select>
        </Field>
        <Field label="支払日" required>
          <select className={selectCls} value={form.payment_day} onChange={e => set('payment_day', e.target.value)}>
            <option value="月末">月末</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
              <option key={d} value={String(d)}>{d}日</option>
            ))}
          </select>
        </Field>
        <Field label="消費税区分" required>
          <select className={selectCls} value={form.tax_type} onChange={e => set('tax_type', e.target.value)}>
            {TAX_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="インボイス登録">
          <div className="flex items-center gap-2 h-[34px]">
            <input
              type="checkbox"
              id="invoice_registered"
              checked={form.invoice_registered}
              onChange={e => set('invoice_registered', e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            <label htmlFor="invoice_registered" className="text-sm text-zinc-700">登録済み</label>
          </div>
        </Field>
      </div>

      <SectionTitle>振込先口座</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="銀行名">
          <input className={inputCls} value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
        </Field>
        <Field label="支店名">
          <input className={inputCls} value={form.bank_branch} onChange={e => set('bank_branch', e.target.value)} />
        </Field>
        <Field label="口座種別">
          <select className={selectCls} value={form.account_type} onChange={e => set('account_type', e.target.value)}>
            {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="口座番号">
          <input className={inputCls} value={form.account_number} onChange={e => set('account_number', e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="口座名義">
            <input className={inputCls} value={form.account_holder} onChange={e => set('account_holder', e.target.value)} />
          </Field>
        </div>
      </div>
    </>
  )
}

// ── 委託先フォーム ────────────────────────────────────────

function ContractorFormFields({
  form,
  onChange,
  allContractors = [],
  editTargetId,
}: {
  form: ContractorForm
  onChange: (f: ContractorForm) => void
  allContractors?: ContractorRow[]
  editTargetId?: string | null
}) {
  const set = (k: keyof ContractorForm, v: string) =>
    onChange({ ...form, [k]: v })

  return (
    <>
      <SectionTitle>基本情報</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Field label="氏名" required>
            <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} required />
          </Field>
        </div>
        <Field label="電話番号">
          <input className={inputCls} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </Field>
        <Field label="メールアドレス" required>
          <input className={inputCls} type="email" value={form.email} onChange={e => set('email', e.target.value)} required />
        </Field>
        <div className="col-span-2">
          <Field label="ログインメールアドレス">
            <input className={inputCls} type="email" value={form.login_email} onChange={e => set('login_email', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mt-5">
        <Field label="親委託先（1次業者）">
          <select
            value={form.parent_contractor_id}
            onChange={e => set('parent_contractor_id', e.target.value)}
            className={inputCls + ' bg-white'}
          >
            <option value="">なし（1次委託先）</option>
            {allContractors
              .filter(c => c.id !== editTargetId)
              .map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
        </Field>
      </div>

      <SectionTitle>出金ルール（締め日・支払サイト）</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="支払方式" required>
          <select className={selectCls} value={form.payment_method} onChange={e => set('payment_method', e.target.value)}>
            {PAYMENT_METHODS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="締め日" required>
          <select className={selectCls} value={form.closing_day} onChange={e => set('closing_day', e.target.value)}>
            <option value="月末">月末</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
              <option key={d} value={String(d)}>{d}日</option>
            ))}
          </select>
        </Field>
        <Field label="支払月" required>
          <select className={selectCls} value={form.payment_month_offset} onChange={e => set('payment_month_offset', e.target.value)}>
            <option value="0">当月</option>
            <option value="1">翌月</option>
            <option value="2">翌々月</option>
            <option value="3">3ヶ月後</option>
          </select>
        </Field>
        <Field label="支払日" required>
          <select className={selectCls} value={form.payment_day} onChange={e => set('payment_day', e.target.value)}>
            <option value="月末">月末</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
              <option key={d} value={String(d)}>{d}日</option>
            ))}
          </select>
        </Field>
        <Field label="消費税区分" required>
          <select className={selectCls} value={form.tax_type} onChange={e => set('tax_type', e.target.value)}>
            {TAX_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
      </div>

      <SectionTitle>インボイス情報</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="インボイス登録区分" required>
          <select className={selectCls} value={form.invoice_registration_type} onChange={e => set('invoice_registration_type', e.target.value)}>
            {INVOICE_REG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="登録番号（T+13桁）" required={form.invoice_registration_type === '適格'}>
          <input
            className={inputCls}
            placeholder="T1234567890123"
            value={form.invoice_number}
            onChange={e => set('invoice_number', e.target.value)}
            pattern="T[0-9]{13}"
            title="T+13桁の数字で入力してください"
            required={form.invoice_registration_type === '適格'}
            disabled={form.invoice_registration_type === '免税'}
          />
        </Field>
        <div className="col-span-2">
          <Field label="同一人物ID（users.id）">
            <input className={inputCls} value={form.same_person_id} onChange={e => set('same_person_id', e.target.value)} placeholder="UUID（任意）" />
          </Field>
        </div>
      </div>

      <SectionTitle>振込先口座</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="銀行名">
          <input className={inputCls} value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
        </Field>
        <Field label="支店名">
          <input className={inputCls} value={form.bank_branch} onChange={e => set('bank_branch', e.target.value)} />
        </Field>
        <Field label="口座種別">
          <select className={selectCls} value={form.account_type} onChange={e => set('account_type', e.target.value)}>
            {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="口座番号">
          <input className={inputCls} value={form.account_number} onChange={e => set('account_number', e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="口座名義">
            <input className={inputCls} value={form.account_holder} onChange={e => set('account_holder', e.target.value)} />
          </Field>
        </div>
      </div>

      <SectionTitle>拡張項目（管理用）</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="源泉徴収フラグ">
          <input disabled className={inputCls} value="デフォルト: false" readOnly />
        </Field>
        <Field label="業者区分">
          <input disabled className={inputCls} value="デフォルト: individual" readOnly />
        </Field>
      </div>
    </>
  )
}

// ── 荷主タブ ──────────────────────────────────────────────

function ClientsTab() {
  const [rows, setRows] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ClientRow | null>(null)
  const [form, setForm] = useState<ClientForm>(defaultClientForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await fetchClients()
    if (result.error) setError(result.error)
    else setRows(result.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditTarget(null)
    setForm(defaultClientForm())
    setFormError(null)
    setIsDirty(false)
    setModalOpen(true)
  }

  function openEdit(row: ClientRow) {
    setEditTarget(row)
    // payment_site（整数）から payment_month_offset と payment_day を逆算
    const siteVal = row.payment_site ?? 30
    const pdRaw = siteVal % 30
    const pmOffset = pdRaw === 0 ? siteVal / 30 - 1 : Math.floor(siteVal / 30)
    setForm({
      company_name: row.company_name,
      contact_name: row.contact_name ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      closing_day: ((row as any).closing_day == null || (row as any).closing_day >= 28) ? '月末' : String((row as any).closing_day),
      payment_month_offset: String(Math.max(0, pmOffset)),
      payment_day: pdRaw === 0 ? '月末' : String(pdRaw),
      tax_type: row.tax_type,
      invoice_registered: (row as any).invoice_registered ?? (row as any).is_invoice_registered ?? false,
      bank_name: row.bank_name ?? '',
      bank_branch: row.bank_branch ?? '',
      account_type: row.account_type ?? '普通',
      account_number: row.account_number ?? '',
      account_holder: row.account_holder ?? '',
    })
    setFormError(null)
    setIsDirty(false)
    setModalOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)

    const paymentDayNum = form.payment_day === '月末' ? 30 : Number(form.payment_day)
    const payload: any = {
      company_name: form.company_name,
      contact_name: form.contact_name || null,
      phone: form.phone || null,
      email: form.email || null,
      closing_day: form.closing_day === '月末' ? 99 : Number(form.closing_day),
      payment_site: Number(form.payment_month_offset) * 30 + paymentDayNum,
      tax_type: form.tax_type,
      invoice_registered: form.invoice_registered,
      is_invoice_registered: form.invoice_registered,
      has_invoice: form.invoice_registered,
      bank_name: form.bank_name || null,
      bank_branch: form.bank_branch || null,
      account_type: form.account_type || null,
      account_number: form.account_number || null,
      account_holder: form.account_holder || null,
    }

    const result = editTarget
      ? await updateClient(editTarget.id, payload)
      : await createClient_(payload)

    if (result.error) {
      setFormError(result.error)
    } else {
      setModalOpen(false)
      await load()
    }
    setSaving(false)
  }

  const taxLabel = (v: string) => TAX_TYPES.find(t => t.value === v)?.label ?? v

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-zinc-500">{rows.length} 件</p>
        <button
          onClick={openCreate}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition"
        >
          + 新規登録
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">読み込み中...</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">データがありません</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">会社名</th>
                <th className="px-4 py-3 text-left font-medium">担当者</th>
                <th className="px-4 py-3 text-left font-medium">締め日</th>
                <th className="px-4 py-3 text-left font-medium">サイト</th>
                <th className="px-4 py-3 text-left font-medium">消費税</th>
                <th className="px-4 py-3 text-left font-medium">電話番号</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-900">{row.company_name}</td>
                  <td className="px-4 py-3 text-zinc-600">{row.contact_name ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-600">{(row as any).closing_day >= 28 ? '月末' : `${(row as any).closing_day}日`}</td>
                  <td className="px-4 py-3 text-zinc-600">{row.payment_site}日</td>
                  <td className="px-4 py-3 text-zinc-600">{taxLabel(row.tax_type)}</td>
                  <td className="px-4 py-3 text-zinc-600">{row.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => openEdit(row)}
                        className="text-xs text-zinc-500 hover:text-zinc-900 underline underline-offset-2"
                      >
                        編集
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm('本当にこの荷主を削除しますか？')) return
                          const result = await deleteClient(row.id)
                          if (result.error) setError(result.error)
                          else await load()
                        }}
                        className="text-xs text-red-400 hover:text-red-600 underline underline-offset-2"
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal
          title={editTarget ? '荷主を編集' : '荷主を新規登録'}
          onClose={() => setModalOpen(false)}
          isDirty={isDirty}
        >
          <form onSubmit={handleSubmit}>
            <ClientFormFields form={form} onChange={f => { setForm(f); setIsDirty(true) }} />
            {formError && (
              <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 transition"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── 委託先タブ ────────────────────────────────────────────

function ContractorsTab() {
  const [rows, setRows] = useState<ContractorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ContractorRow | null>(null)
  const [form, setForm] = useState<ContractorForm>(defaultContractorForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await fetchContractors()
    if (result.error) setError(result.error)
    else setRows(result.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditTarget(null)
    setForm(defaultContractorForm())
    setFormError(null)
    setIsDirty(false)
    setModalOpen(true)
  }

  function openEdit(row: ContractorRow) {
    setEditTarget(row)
    // payment_site（整数）から payment_month_offset と payment_day を逆算
    const siteVal = row.payment_site ?? 30
    const pdRaw = siteVal % 30
    const pmOffset = pdRaw === 0 ? siteVal / 30 - 1 : Math.floor(siteVal / 30)
    setForm({
      name: row.name,
      phone: row.phone ?? '',
      email: row.email ?? '',
      login_email: row.email ?? '',
      payment_method: row.payment_type === 'bank_transfer' ? '振込' : (row.payment_type ?? '振込'),
      closing_day: String((row as any).closing_day ?? '月末'),
      payment_month_offset: String(Math.max(0, pmOffset)),
      payment_day: pdRaw === 0 ? '月末' : String(pdRaw),
      tax_type: row.tax_category ?? 'exclusive',
      invoice_registration_type: row.invoice_registration_type,
      invoice_number: row.invoice_number ?? '',
      same_person_id: row.same_person_id ?? '',
      bank_name: row.bank_name ?? '',
      bank_branch: row.bank_branch ?? '',
      account_type: row.account_type ?? '普通',
      account_number: row.account_number ?? '',
      account_holder: row.account_holder ?? '',
      parent_contractor_id: (row as any).parent_contractor_id ?? '',
    })
    setFormError(null)
    setIsDirty(false)
    setModalOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const numReg = form.invoice_number
    if (numReg && !/^T[0-9]{13}$/.test(numReg)) {
      setFormError('登録番号は T+13桁の数字で入力してください（例: T1234567890123）')
      return
    }

    setSaving(true)
    setFormError(null)

    const paymentDayNumC = form.payment_day === '月末' ? 30 : Number(form.payment_day)
    const payload: any = {
      name: form.name,
      phone: form.phone || null,
      email: form.email || form.login_email || 'noreply@local.dev',
      payment_type: form.payment_method === '振込' ? 'bank_transfer' : form.payment_method,
      payment_site: Number(form.payment_month_offset) * 30 + paymentDayNumC,
      tax_category: form.tax_type,
      invoice_registration_type: form.invoice_registration_type,
      invoice_number: form.invoice_number || null,
      same_person_id: form.same_person_id || null,
      bank_name: form.bank_name || null,
      bank_branch: form.bank_branch || null,
      account_type: form.account_type || null,
      account_number: form.account_number || null,
      account_holder: form.account_holder || null,
      contractor_type: 'individual',
      has_withholding: false,
      show_detail_switch: true,
      parent_contractor_id: form.parent_contractor_id || null,
    }

    const result = editTarget
      ? await updateContractor(editTarget.id, payload)
      : await createContractor(payload)

    if (result.error) {
      setFormError(result.error)
    } else {
      setModalOpen(false)
      await load()
    }
    setSaving(false)
  }

  const invoiceLabel = (v: string) => INVOICE_REG_TYPES.find(t => t.value === v)?.label ?? v

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-zinc-500">{rows.length} 件</p>
        <button
          onClick={openCreate}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition"
        >
          + 新規登録
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">読み込み中...</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">データがありません</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">氏名</th>
                <th className="px-4 py-3 text-left font-medium">メール</th>
                <th className="px-4 py-3 text-left font-medium">支払方式</th>
                <th className="px-4 py-3 text-left font-medium">サイト</th>
                <th className="px-4 py-3 text-left font-medium">インボイス</th>
                <th className="px-4 py-3 text-left font-medium">電話番号</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-900">{row.name}</td>
                  <td className="px-4 py-3 text-zinc-600">{row.email ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-600">{row.payment_type}</td>
                  <td className="px-4 py-3 text-zinc-600">{row.payment_site}日</td>
                  <td className="px-4 py-3 text-zinc-600">{invoiceLabel(row.invoice_registration_type)}</td>
                  <td className="px-4 py-3 text-zinc-600">{row.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => openEdit(row)}
                        className="text-xs text-zinc-500 hover:text-zinc-900 underline underline-offset-2"
                      >
                        編集
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm('本当にこの委託先を削除しますか？')) return
                          const result = await deleteContractor(row.id)
                          if (result.error) setError(result.error)
                          else await load()
                        }}
                        className="text-xs text-red-400 hover:text-red-600 underline underline-offset-2"
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal
          title={editTarget ? '委託先を編集' : '委託先を新規登録'}
          onClose={() => setModalOpen(false)}
          isDirty={isDirty}
        >
          <form onSubmit={handleSubmit}>
            <ContractorFormFields
              form={form}
              onChange={f => { setForm(f); setIsDirty(true) }}
              allContractors={rows}
              editTargetId={editTarget?.id}
            />
            {formError && (
              <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 transition"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────

type Tab = 'clients' | 'contractors'

export default function PartnersPage() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const tab          = (searchParams.get('tab') as Tab | null) ?? 'clients'
  const setTab       = (t: Tab) => router.replace(`${pathname}?tab=${t}`)

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-xl font-semibold text-zinc-900 mb-6">取引先マスタ</h1>

        {/* タブ */}
        <div className="flex gap-1 border-b border-zinc-200 mb-6">
          {(
            [
              { key: 'clients' as Tab, label: '荷主マスタ' },
              { key: 'contractors' as Tab, label: '委託先マスタ' },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
                tab === key
                  ? 'border-zinc-900 text-zinc-900'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'clients' ? <ClientsTab /> : <ContractorsTab />}
      </div>
    </div>
  )
}
