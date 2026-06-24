'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  fetchProjects,
  fetchClientOptions,
  fetchContractorOptions,
  createProject,
  updateProject,
  fetchProjectPayees,
  upsertProjectPayee,
  deleteProjectPayee,
  type ProjectWithRelations,
  type ProjectPayee,
  type PayeeUpsertOpts,
} from './actions'
import type { Database } from '@/types/supabase'

type ClientRow = Database['public']['Tables']['clients']['Row']
type ContractorRow = Database['public']['Tables']['contractors']['Row']
type ProjectInsert = Database['public']['Tables']['projects']['Insert']

// ── ステータス定義（3状態のみ。DBへの書き込みは cancelled 以外しない） ──

const STATUSES = [
  { value: 'accepted',  label: '受託',       color: 'bg-blue-100 text-blue-700' },
  { value: 'completed', label: '完了',       color: 'bg-zinc-100 text-zinc-500' },
  { value: 'cancelled', label: 'キャンセル', color: 'bg-red-100 text-red-500'  },
] as const

type StatusValue = (typeof STATUSES)[number]['value']

// ── 自動ステータス推論（work_records の有無のみで判定） ──────────

function computeAutoStatus(row: ProjectWithRelations): StatusValue {
  if (row.status === 'cancelled') return 'cancelled'
  if (row.work_record_count > 0)  return 'completed'
  return 'accepted'
}

function StatusBadge({ status }: { status: StatusValue }) {
  const s = STATUSES.find(s => s.value === status)
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s?.color ?? 'bg-zinc-100 text-zinc-500'}`}>
      {s?.label ?? status}
    </span>
  )
}

// ── フォーム型（statusは cancelled フラグのみ管理者操作） ─────

type ProjectForm = {
  project_code:   string
  project_name:   string
  client_id:      string
  contractor_id:  string
  sale_amount:    string
  buy_amount:     string
  cancelled:      boolean
  unit_type:      string
  driver_visible: boolean
}

const defaultForm = (): ProjectForm => ({
  project_code:   '',
  project_name:   '',
  client_id:      '',
  contractor_id:  '',
  sale_amount:    '0',
  buy_amount:     '',
  cancelled:      false,
  unit_type:      'quantity',
  driver_visible: true,
})

// ── 共通 UI ───────────────────────────────────────────────────

const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300'

const selectCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300'

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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide border-b border-zinc-100 pb-1 mb-3 mt-5 first:mt-0">
      {children}
    </p>
  )
}

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

// ── フォームコンポーネント ─────────────────────────────────────

function ProjectFormFields({
  form,
  onChange,
  clients,
  contractors,
}: {
  form: ProjectForm
  onChange: (f: ProjectForm) => void
  clients: Pick<ClientRow, 'id' | 'company_name'>[]
  contractors: Pick<ContractorRow, 'id' | 'name'>[]
}) {
  const set = (k: keyof ProjectForm, v: string | boolean) => onChange({ ...form, [k]: v })

  return (
    <>
      <SectionTitle>案件基本情報</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="案件コード" required>
          <input className={inputCls} value={form.project_code} onChange={e => set('project_code', e.target.value)} required placeholder="例: PRJ-001" />
        </Field>
        <Field label="案件名" required>
          <input className={inputCls} value={form.project_name} onChange={e => set('project_name', e.target.value)} required />
        </Field>
        <div className="col-span-2">
          <Field label="荷主" required>
            <select className={selectCls} value={form.client_id} onChange={e => set('client_id', e.target.value)} required>
              <option value="">-- 荷主を選択 --</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="担当委託先">
            <select className={selectCls} value={form.contractor_id} onChange={e => set('contractor_id', e.target.value)}>
              <option value="">-- 未設定 --</option>
              {contractors.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <SectionTitle>運賃</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="受託運賃（円・税抜）" required>
          <input className={inputCls} type="number" min="0" value={form.sale_amount} onChange={e => set('sale_amount', e.target.value)} required />
        </Field>
        <Field label="支払運賃（円・税抜）">
          <input className={inputCls} type="number" min="0" value={form.buy_amount} onChange={e => set('buy_amount', e.target.value)} placeholder="未定の場合は空欄" />
        </Field>
      </div>

      <SectionTitle>ドライバー表示設定</SectionTitle>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.driver_visible}
          onChange={e => set('driver_visible', e.target.checked)}
          className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-300"
        />
        <span className="text-sm text-zinc-700">ドライバーの予定入力画面に表示する</span>
      </label>
      {!form.driver_visible && (
        <p className="mt-1 text-xs text-amber-600">非表示にするとドライバーが案件を選択できなくなります。</p>
      )}

      <SectionTitle>中止フラグ</SectionTitle>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.cancelled}
          onChange={e => set('cancelled', e.target.checked)}
          className="rounded border-zinc-300 text-red-500 focus:ring-red-300"
        />
        <span className="text-sm text-zinc-700">この案件をキャンセル（中止）にする</span>
      </label>
      {form.cancelled && (
        <p className="mt-1 text-xs text-red-500">チェックを外すと受託ステータスに戻ります（実績入力で自動判定）。</p>
      )}
    </>
  )
}

// ── 支払先設定パネル ──────────────────────────────────────────

type PayeeFormState = PayeeUpsertOpts & { contractor_id: string }

const defaultPayeeForm = (): PayeeFormState => ({
  contractor_id:             '',
  payment_type:              'per_unit',
  unit_price:                null,
  tax_method:                'exclusive',
  rounding_rule:             'round',
  adjustment_enabled:        false,
  work_source_contractor_id: null,
  payee_tier:                'primary',
})

function PayeeSettingPanel({
  project,
  contractors,
  onClose,
}: {
  project:     ProjectWithRelations
  contractors: Pick<ContractorRow, 'id' | 'name'>[]
  onClose:     () => void
}) {
  const [payees, setPayees]       = useState<ProjectPayee[]>([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [panelErr, setPanelErr]   = useState<string | null>(null)
  const [formOpen, setFormOpen]   = useState(false)
  const [editTarget, setEditTarget] = useState<ProjectPayee | null>(null)
  const [form, setForm]           = useState<PayeeFormState>(defaultPayeeForm())

  useEffect(() => {
    fetchProjectPayees(project.id).then(res => {
      if (res.data) setPayees(res.data)
      else setPanelErr(res.error)
      setLoading(false)
    })
  }, [project.id])

  function openAdd() {
    setEditTarget(null)
    setForm(defaultPayeeForm())
    setPanelErr(null)
    setFormOpen(true)
  }

  function openEdit(p: ProjectPayee) {
    setEditTarget(p)
    setForm({
      contractor_id:             p.contractor_id,
      payment_type:              p.payment_type,
      unit_price:                p.unit_price,
      tax_method:                p.tax_method,
      rounding_rule:             p.rounding_rule,
      adjustment_enabled:        p.adjustment_enabled,
      work_source_contractor_id: p.work_source_contractor_id,
      payee_tier:                p.payee_tier,
    })
    setPanelErr(null)
    setFormOpen(true)
  }

  async function handleSave() {
    if (!form.contractor_id) { setPanelErr('委託先を選択してください'); return }
    setSaving(true)
    const res = await upsertProjectPayee(
      project.id,
      form.contractor_id,
      {
        payment_type:              form.payment_type,
        unit_price:                form.payment_type === 'per_unit' ? form.unit_price : null,
        tax_method:                form.tax_method,
        rounding_rule:             form.rounding_rule,
        adjustment_enabled:        form.adjustment_enabled,
        work_source_contractor_id: form.work_source_contractor_id,
        payee_tier:                form.payee_tier,
      },
      editTarget?.id,
    )
    if (res.error) { setPanelErr(res.error); setSaving(false); return }
    const refreshed = await fetchProjectPayees(project.id)
    if (refreshed.data) setPayees(refreshed.data)
    setFormOpen(false)
    setSaving(false)
  }

  async function handleDelete(p: ProjectPayee) {
    if (!confirm(`「${p.contractor_name}」の支払設定を削除しますか？`)) return
    const res = await deleteProjectPayee(p.id)
    if (res.error) { setPanelErr(res.error); return }
    setPayees(prev => prev.filter(x => x.id !== p.id))
  }

  const setF = (k: keyof PayeeFormState, v: string | number | boolean | null) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const tierLabel   = (t: string) => t === 'primary' ? '直接' : '再委託'
  const methodLabel = (m: string) => m === 'inclusive' ? '税込思考' : '税抜思考'
  const roundLabel  = (r: string) => r === 'round' ? '四捨五入' : r === 'floor' ? '切り捨て' : '切り上げ'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 shrink-0">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">支払先設定</h2>
          <p className="text-xs text-zinc-500 mt-0.5">{project.project_name}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openAdd}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition"
          >
            + 追加
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition"
          >
            ✕
          </button>
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {panelErr && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{panelErr}</p>
        )}

        {loading ? (
          <p className="text-sm text-zinc-400 text-center py-20">読み込み中...</p>
        ) : payees.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm text-zinc-400">支払先が登録されていません</p>
            <p className="text-xs text-zinc-400 mt-1">「追加」から委託先ごとの支払設定を登録できます</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">委託先</th>
                  <th className="px-4 py-3 text-left font-medium">階層</th>
                  <th className="px-4 py-3 text-right font-medium">件数単価</th>
                  <th className="px-4 py-3 text-left font-medium">税計算</th>
                  <th className="px-4 py-3 text-left font-medium">端数</th>
                  <th className="px-4 py-3 text-center font-medium">調整金</th>
                  <th className="px-4 py-3 text-left font-medium">カウント元</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {payees.map(p => (
                  <tr key={p.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium text-zinc-900">{p.contractor_name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${p.payee_tier === 'primary' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                        {tierLabel(p.payee_tier)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-900">
                      {p.unit_price !== null ? `¥${p.unit_price.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 text-xs">{methodLabel(p.tax_method)}</td>
                    <td className="px-4 py-3 text-zinc-600 text-xs">{roundLabel(p.rounding_rule)}</td>
                    <td className="px-4 py-3 text-center">
                      {p.adjustment_enabled
                        ? <span className="text-green-600 text-xs font-medium">有効</span>
                        : <span className="text-zinc-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {p.work_source_name ?? <span className="text-zinc-300">自身</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => openEdit(p)}
                          className="text-xs text-zinc-500 hover:text-zinc-900 underline underline-offset-2"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => handleDelete(p)}
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
      </div>

      {/* 支払先追加・編集フォーム */}
      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
              <h3 className="text-base font-semibold text-zinc-900">
                {editTarget ? '支払設定を編集' : '支払先を追加'}
              </h3>
              <button
                onClick={() => setFormOpen(false)}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                ✕
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* 委託先 */}
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">委託先 <span className="text-red-500">*</span></label>
                <select
                  className={selectCls}
                  value={form.contractor_id}
                  onChange={e => setF('contractor_id', e.target.value)}
                  disabled={!!editTarget}
                >
                  <option value="">-- 選択 --</option>
                  {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* 支払階層 */}
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">支払階層</label>
                <div className="flex gap-4">
                  {[{ v: 'primary', l: '直接委託先（primary）' }, { v: 'sub', l: '再委託先（sub）' }].map(o => (
                    <label key={o.v} className="flex items-center gap-1.5 cursor-pointer text-sm text-zinc-700">
                      <input
                        type="radio"
                        name="payee_tier"
                        value={o.v}
                        checked={form.payee_tier === o.v}
                        onChange={() => setF('payee_tier', o.v)}
                      />
                      {o.l}
                    </label>
                  ))}
                </div>
              </div>

              {/* 支払タイプ */}
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">支払タイプ</label>
                <div className="flex gap-4">
                  {[{ v: 'per_unit', l: '件数×単価' }, { v: 'fixed_monthly', l: '月額固定' }].map(o => (
                    <label key={o.v} className="flex items-center gap-1.5 cursor-pointer text-sm text-zinc-700">
                      <input
                        type="radio"
                        name="payment_type"
                        value={o.v}
                        checked={form.payment_type === o.v}
                        onChange={() => setF('payment_type', o.v)}
                      />
                      {o.l}
                    </label>
                  ))}
                </div>
              </div>

              {/* 件数単価（per_unit の場合のみ） */}
              {form.payment_type === 'per_unit' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">件数単価（円・税抜）</label>
                  <input
                    className={inputCls}
                    type="number"
                    min="0"
                    value={form.unit_price ?? ''}
                    onChange={e => setF('unit_price', e.target.value === '' ? null : Number(e.target.value))}
                    placeholder="例: 1500"
                  />
                </div>
              )}

              {/* 税計算方式 */}
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">税計算方式</label>
                <div className="flex gap-4">
                  {[
                    { v: 'exclusive', l: '税抜思考（標準）' },
                    { v: 'inclusive', l: '税込思考（単価×1.1を端数処理）' },
                  ].map(o => (
                    <label key={o.v} className="flex items-center gap-1.5 cursor-pointer text-sm text-zinc-700">
                      <input
                        type="radio"
                        name="tax_method"
                        value={o.v}
                        checked={form.tax_method === o.v}
                        onChange={() => setF('tax_method', o.v)}
                      />
                      {o.l}
                    </label>
                  ))}
                </div>
              </div>

              {/* 端数処理 */}
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">端数処理</label>
                <select
                  className={selectCls}
                  value={form.rounding_rule}
                  onChange={e => setF('rounding_rule', e.target.value)}
                >
                  <option value="round">四捨五入</option>
                  <option value="floor">切り捨て</option>
                  <option value="ceil">切り上げ</option>
                </select>
              </div>

              {/* 調整金 */}
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-zinc-300"
                  checked={form.adjustment_enabled}
                  onChange={e => setF('adjustment_enabled', e.target.checked)}
                />
                <span className="text-sm text-zinc-700">
                  調整金を有効にする
                  <span className="block text-xs text-zinc-400 mt-0.5">
                    税込思考の場合に生じる端数差額を支払通知書の調整金として計上します
                  </span>
                </span>
              </label>

              {/* 稼働カウント元（再委託ケース） */}
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">
                  稼働カウント元
                  <span className="ml-1 text-zinc-400 font-normal">（再委託の場合のみ）</span>
                </label>
                <select
                  className={selectCls}
                  value={form.work_source_contractor_id ?? ''}
                  onChange={e => setF('work_source_contractor_id', e.target.value || null)}
                >
                  <option value="">自身の稼働記録を使用</option>
                  {contractors
                    .filter(c => c.id !== form.contractor_id)
                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {form.work_source_contractor_id && (
                  <p className="mt-1 text-xs text-amber-600">
                    支払計算時は選択した委託先の稼働記録件数を使用します
                  </p>
                )}
              </div>

              {panelErr && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{panelErr}</p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 transition"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── メインページ ───────────────────────────────────────────────

export default function ProjectsPage() {
  const [rows, setRows]               = useState<ProjectWithRelations[]>([])
  const [loading, setLoading]         = useState(true)
  const [pageError, setPageError]     = useState<string | null>(null)
  const [clients, setClients]         = useState<Pick<ClientRow, 'id' | 'company_name'>[]>([])
  const [contractors, setContractors] = useState<Pick<ContractorRow, 'id' | 'name'>[]>([])
  const [modalOpen, setModalOpen]     = useState(false)
  const [editTarget, setEditTarget]   = useState<ProjectWithRelations | null>(null)
  const [form, setForm]               = useState<ProjectForm>(defaultForm())
  const [saving, setSaving]           = useState(false)
  const [formError, setFormError]     = useState<string | null>(null)
  const [isDirty, setIsDirty]         = useState(false)
  const [payeeProject, setPayeeProject] = useState<ProjectWithRelations | null>(null)
  const searchParams    = useSearchParams()
  const router          = useRouter()
  const pathname        = usePathname()
  const filterStatus    = searchParams.get('status') ?? 'all'
  const setFilterStatus = (s: string) => {
    if (s === 'all') router.replace(pathname)
    else router.replace(`${pathname}?status=${s}`)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [projRes, clientRes, contractorRes] = await Promise.all([
      fetchProjects(),
      fetchClientOptions(),
      fetchContractorOptions(),
    ])
    if (projRes.error) setPageError(projRes.error)
    else setRows(projRes.data ?? [])
    if (clientRes.data) setClients(clientRes.data)
    if (contractorRes.data) setContractors(contractorRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditTarget(null)
    setForm(defaultForm())
    setFormError(null)
    setIsDirty(false)
    setModalOpen(true)
  }

  function openEdit(row: ProjectWithRelations) {
    setEditTarget(row)
    setForm({
      project_code:   row.project_code ?? '',
      project_name:   row.project_name,
      client_id:      row.client_id,
      contractor_id:  row.contractor_id ?? '',
      sale_amount:    String(row.sale_amount),
      buy_amount:     row.buy_amount != null ? String(row.buy_amount) : '',
      cancelled:      row.status === 'cancelled',
      unit_type:      row.unit_type,
      driver_visible: (row as any).driver_visible ?? true,
    })
    setFormError(null)
    setIsDirty(false)
    setModalOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)

    try {
      if (!form.project_code.trim()) { setFormError('案件コードを入力してください'); setSaving(false); return }
      if (!form.project_name.trim()) { setFormError('案件名を入力してください'); setSaving(false); return }
      if (!form.client_id) { setFormError('荷主を選択してください'); setSaving(false); return }

      const payload: ProjectInsert = {
        project_code:   form.project_code,
        project_name:   form.project_name,
        client_id:      form.client_id,
        contractor_id:  form.contractor_id || null,
        sale_amount:    Number(form.sale_amount),
        buy_amount:     form.buy_amount !== '' ? Number(form.buy_amount) : null,
        status:         form.cancelled ? 'cancelled' : 'accepted',
        unit_type:      form.unit_type,
        driver_visible: form.driver_visible,
      } as any

      const result = editTarget
        ? await updateProject(editTarget.id, payload)
        : await createProject(payload)

      if (result.error) {
        setFormError(result.error)
      } else {
        setIsDirty(false)
        setModalOpen(false)
        await load()
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存中にエラーが発生しました')
    } finally {
      setSaving(false)
    }
  }

  // 自動推論ステータスを付与した行
  const rowsWithStatus = rows.map(r => ({ ...r, autoStatus: computeAutoStatus(r) }))

  const filtered = filterStatus === 'all'
    ? rowsWithStatus
    : rowsWithStatus.filter(r => r.autoStatus === filterStatus)

  const countByStatus = (val: StatusValue) => rowsWithStatus.filter(r => r.autoStatus === val).length

  const fmt = (iso: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-xl font-semibold text-zinc-900 mb-6">案件管理</h1>

        {/* ツールバー */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setFilterStatus('all')}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${filterStatus === 'all' ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-300 text-zinc-600 hover:bg-zinc-50'}`}
            >
              すべて
            </button>
            {STATUSES.map(s => (
              <button
                key={s.value}
                onClick={() => setFilterStatus(s.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${filterStatus === s.value ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-300 text-zinc-600 hover:bg-zinc-50'}`}
              >
                {s.label}
                {filterStatus !== s.value && (
                  <span className="ml-1 text-zinc-400">({countByStatus(s.value)})</span>
                )}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <button
              onClick={openCreate}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition"
            >
              + 新規登録
            </button>
          </div>
        </div>

        <p className="text-sm text-zinc-500 mb-3">{filtered.length} 件</p>

        {pageError && (
          <p className="text-sm text-red-600 mb-4 bg-red-50 rounded-lg px-3 py-2">{pageError}</p>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-sm text-zinc-400">データがありません</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">案件名</th>
                  <th className="px-4 py-3 text-left font-medium">ステータス</th>
                  <th className="px-4 py-3 text-left font-medium">荷主</th>
                  <th className="px-4 py-3 text-right font-medium">受託運賃</th>
                  <th className="px-4 py-3 text-center font-medium">D表示</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map(row => (
                  <tr key={row.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium text-zinc-900">{row.project_name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.autoStatus} />
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{row.client_name ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-zinc-900 font-medium">
                      ¥{row.selling_price?.toLocaleString() ?? '0'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(row as any).driver_visible !== false
                        ? <span className="text-green-600 text-xs font-medium">表示</span>
                        : <span className="text-zinc-400 text-xs font-medium">非表示</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => setPayeeProject(row)}
                          className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-100 transition"
                        >
                          支払先
                        </button>
                        <button
                          onClick={() => openEdit(row)}
                          className="text-xs text-zinc-500 hover:text-zinc-900 underline underline-offset-2"
                        >
                          編集
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {payeeProject && (
          <PayeeSettingPanel
            project={payeeProject}
            contractors={contractors}
            onClose={() => setPayeeProject(null)}
          />
        )}

        {modalOpen && (
          <Modal
            title={editTarget ? '案件を編集' : '案件を新規登録'}
            onClose={() => setModalOpen(false)}
            isDirty={isDirty}
          >
            <form onSubmit={handleSubmit} noValidate>
              <ProjectFormFields
                form={form}
                onChange={f => { setForm(f); setIsDirty(true) }}
                clients={clients}
                contractors={contractors}
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
    </div>
  )
}
