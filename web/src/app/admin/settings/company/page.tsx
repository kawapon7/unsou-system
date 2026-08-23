'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchCompanyForEdit, saveCompany, type CompanyFormValues } from './actions'
import { listDocumentFormatOptions } from '@/utils/document-formats'

const EMPTY: CompanyFormValues = {
  name: '', invoice_reg_number: '', postal_code: '', address: '', phone: '', email: '',
  bank_name: '', bank_branch: '', account_type: '', account_number: '', account_holder: '',
  fiscal_year_end_month: '',
  payment_notice_response_days: '7',
  transport_insurance_amount: '1000',
  invoice_number_format: 'INV-{YYYY}{MM}-{SEQ:4}',
  document_format_key: 'standard',
}

function Field({
  label, value, onChange, placeholder, required, hint, type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  hint?: string
  type?: string
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">
        {label}
        {required && <span className="ml-1 text-red-600">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm
                   text-zinc-900 placeholder:text-zinc-400
                   focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
      />
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  )
}

export default function CompanySettingsPage() {
  const [values,  setValues]  = useState<CompanyFormValues>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [saved,   setSaved]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetchCompanyForEdit()
    if (res.error) setError(res.error)
    else if (res.data) setValues(res.data)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const set = (key: keyof CompanyFormValues) => (v: string) => {
    setValues(prev => ({ ...prev, [key]: v }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await saveCompany(values)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setSaved(true)
  }

  if (loading) {
    return <div className="p-8 text-sm text-zinc-500">読み込み中...</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-zinc-900">自社情報</h1>
        <p className="mt-1 text-sm text-zinc-600">
          請求書・支払通知書のPDFに発行元として印字される情報です。
          会社名とインボイス登録番号が未登録の場合、PDFは発行できません。
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          保存しました。
        </div>
      )}

      <section className="mb-8 space-y-4">
        <h2 className="border-b border-zinc-200 pb-2 text-sm font-semibold text-zinc-900">
          請求書に必須の項目
        </h2>
        <Field
          label="会社名" required
          value={values.name} onChange={set('name')}
          placeholder="株式会社○○運送"
        />
        <Field
          label="インボイス登録番号" required
          value={values.invoice_reg_number} onChange={set('invoice_reg_number')}
          placeholder="T1234567890123"
          hint="「T」＋13桁。誤った番号を載せると、受け取った荷主が仕入税額控除を受けられなくなります。"
        />
      </section>

      <section className="mb-8 space-y-4">
        <h2 className="border-b border-zinc-200 pb-2 text-sm font-semibold text-zinc-900">
          決算
        </h2>
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">決算月</span>
          <select
            value={values.fiscal_year_end_month}
            onChange={e => set('fiscal_year_end_month')(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm
                       text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          >
            <option value="">未設定（暦年 1月〜12月で集計）</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={String(m)}>{m}月</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-zinc-500">
            事業年度は決算月の翌月から始まります（3月決算なら4月〜翌年3月）。
            委託先ごとの年度累計の集計期間に使います。未設定でも他の機能は止まりません。
          </span>
        </label>
      </section>

      <section className="mb-8 space-y-4">
        <h2 className="border-b border-zinc-200 pb-2 text-sm font-semibold text-zinc-900">
          帳票の発行
        </h2>
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">請求書番号の書式</span>
          <input
            type="text"
            placeholder="INV-{YYYY}{MM}-{SEQ:4}"
            value={values.invoice_number_format}
            onChange={e => set('invoice_number_format')(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-mono
                       text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          />
          <span className="mt-1 block text-xs text-zinc-500">
            使えるトークン: {'{YYYY} {YY} {MM} {DD} {FY}（事業年度） {CLIENT}（荷主コード） {SEQ} {SEQ:4}（4桁ゼロ埋め）'}。
            連番は {'{FY}'} / {'{YYYY}'} / {'{MM}'} の組み合わせごとにリセットされます（どれも無ければ通し番号）。
            確定発行した番号は変わりません。書式を変えても発行済みの控えには影響しません。
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">標準の請求書様式</span>
          <select
            value={values.document_format_key}
            onChange={e => set('document_format_key')(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm
                       text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          >
            {listDocumentFormatOptions('invoice').map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-zinc-500">
            荷主ごとに様式を指定していない場合に使う様式です。導入先様式は今後追加されます。
          </span>
        </label>
      </section>

      <section className="mb-8 space-y-4">
        <h2 className="border-b border-zinc-200 pb-2 text-sm font-semibold text-zinc-900">
          支払通知書の承認
        </h2>
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">返事を待つ日数</span>
          <input
            type="number"
            min={0}
            max={90}
            value={values.payment_notice_response_days}
            onChange={e => set('payment_notice_response_days')(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm
                       text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          />
          <span className="mt-1 block text-xs text-zinc-500">
            支払通知書を作ってから、委託先本人の返事をこの日数だけ待ちます。
            期間中は「未応答のまま確定」できません（口頭確認による「代理承認」はいつでも使えます）。
            期間を過ぎると確定できるようになります。0 にすると待たずにいつでも確定できます。
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-zinc-700">運送保険料（月額・委託先負担）</span>
          <input
            type="number"
            min={0}
            step={1}
            value={values.transport_insurance_amount}
            onChange={e => set('transport_insurance_amount')(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm
                       text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          />
          <span className="mt-1 block text-xs text-zinc-500">
            支払通知書の相殺額に「運送保険（非課税）」として計上します。稼働のある委託先へ毎月一律で適用します。
            <strong>非課税項目</strong>なので消費税・経過措置の計算には含めません。0 にすると相殺しません。
          </span>
        </label>
      </section>

      <section className="mb-8 space-y-4">
        <h2 className="border-b border-zinc-200 pb-2 text-sm font-semibold text-zinc-900">
          連絡先
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="郵便番号" value={values.postal_code} onChange={set('postal_code')} placeholder="123-4567" />
          <Field label="電話番号" value={values.phone} onChange={set('phone')} placeholder="03-1234-5678" />
        </div>
        <Field label="住所" value={values.address} onChange={set('address')} placeholder="東京都○○区○○1-2-3" />
        <Field label="メールアドレス" type="email" value={values.email} onChange={set('email')} placeholder="info@example.co.jp" />
      </section>

      <section className="mb-8 space-y-4">
        <h2 className="border-b border-zinc-200 pb-2 text-sm font-semibold text-zinc-900">
          振込先口座
        </h2>
        <p className="text-xs text-zinc-500">
          請求書PDFにのみ印字されます（支払通知書には出ません）。
          口座情報は暗号化して保存されます。
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="銀行名"   value={values.bank_name}   onChange={set('bank_name')}   placeholder="○○銀行" />
          <Field label="支店名"   value={values.bank_branch} onChange={set('bank_branch')} placeholder="○○支店" />
          <Field label="口座種別" value={values.account_type} onChange={set('account_type')} placeholder="普通" />
          <Field label="口座番号" value={values.account_number} onChange={set('account_number')} placeholder="1234567" />
        </div>
        <Field label="口座名義" value={values.account_holder} onChange={set('account_holder')} placeholder="カ）マルマルウンソウ" />
      </section>

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white
                     hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        <button
          onClick={() => void load()}
          disabled={saving}
          className="rounded-md border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700
                     hover:bg-zinc-50 disabled:opacity-50"
        >
          取り消して再読み込み
        </button>
      </div>
    </div>
  )
}
