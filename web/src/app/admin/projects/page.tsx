'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  fetchProjects,
  fetchClientOptions,
  fetchContractorOptions,
  createProject,
  updateProject,
  type ProjectWithRelations,
} from './actions'
import type { Database } from '@/types/supabase'

type ClientRow = Database['public']['Tables']['clients']['Row']
type ContractorRow = Database['public']['Tables']['contractors']['Row']

type ProjectInsert = Database['public']['Tables']['projects']['Insert']

// ── ステータス定義 ─────────────────────────────────────────

const STATUSES = [
  { value: 'accepted',   label: '受託',    color: 'bg-blue-100 text-blue-700'   },
  { value: 'dispatched', label: '配車済',  color: 'bg-amber-100 text-amber-700' },
  { value: 'in_transit', label: '運行中',  color: 'bg-green-100 text-green-700' },
  { value: 'completed',  label: '完了',    color: 'bg-zinc-100 text-zinc-500'   },
  { value: 'cancelled',  label: 'キャンセル', color: 'bg-red-100 text-red-500'  },
] as const

type StatusValue = (typeof STATUSES)[number]['value']

function StatusBadge({ status }: { status: string }) {
  const s = STATUSES.find(s => s.value === status)
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s?.color ?? 'bg-zinc-100 text-zinc-500'}`}>
      {s?.label ?? status}
    </span>
  )
}

// ── フォーム型 ────────────────────────────────────────────

type ProjectForm = {
  project_code: string
  project_name: string
  client_id: string
  contractor_id: string
  operation_start: string
  operation_end: string
  origin: string
  destination: string
  sale_amount: string
  buy_amount: string
  status: StatusValue
  unit_type: string
}

const defaultForm = (): ProjectForm => ({
  project_code: '',
  project_name: '',
  client_id: '',
  contractor_id: '',
  operation_start: '',
  operation_end: '',
  origin: '',
  destination: '',
  sale_amount: '0',
  buy_amount: '',
  status: 'accepted',
  unit_type: 'quantity',
})

// ── 共通 UI ───────────────────────────────────────────────

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
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          <button
            onClick={onClose}
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

// ── フォームコンポーネント ─────────────────────────────────

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
  const set = (k: keyof ProjectForm, v: string) => onChange({ ...form, [k]: v })

  return (
    <>
      <SectionTitle>案件基本情報</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="案件コード" required>
          <input className={inputCls} value={form.project_code} onChange={e => set('project_code', e.target.value)} required placeholder="例: PRJ-001" />
        </Field>
        <Field label="ステータス" required>
          <select className={selectCls} value={form.status} onChange={e => set('status', e.target.value as StatusValue)}>
            {STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Field>
        <div className="col-span-2">
          <Field label="案件名" required>
            <input className={inputCls} value={form.project_name} onChange={e => set('project_name', e.target.value)} required />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="荷主" required>
            <select
              className={selectCls}
              value={form.client_id}
              onChange={e => set('client_id', e.target.value)}
              required
            >
              <option value="">-- 荷主を選択 --</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="担当委託先（子分）">
            <select
              className={selectCls}
              value={form.contractor_id}
              onChange={e => set('contractor_id', e.target.value)}
            >
              <option value="">-- 未配車 --</option>
              {contractors.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <SectionTitle>運行情報</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="運行開始日時">
          <input className={inputCls} type="datetime-local" value={form.operation_start} onChange={e => set('operation_start', e.target.value)} />
        </Field>
        <Field label="運行終了日時">
          <input className={inputCls} type="datetime-local" value={form.operation_end} onChange={e => set('operation_end', e.target.value)} />
        </Field>
        <Field label="積地（出発地）" required>
          <input className={inputCls} value={form.origin} onChange={e => set('origin', e.target.value)} required placeholder="例: 東京都江東区" />
        </Field>
        <Field label="卸地（到着地）" required>
          <input className={inputCls} value={form.destination} onChange={e => set('destination', e.target.value)} required placeholder="例: 大阪府大阪市" />
        </Field>
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
    </>
  )
}

// ── メインページ ──────────────────────────────────────────

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
    setModalOpen(true)
  }

  function openEdit(row: ProjectWithRelations) {
    setEditTarget(row)
    setForm({
      project_code: row.project_code,
      project_name: row.project_name,
      client_id: row.client_id,
      contractor_id: row.contractor_id ?? '',
      operation_start: row.operation_start
        ? row.operation_start.slice(0, 16)
        : '',
      operation_end: row.operation_end
        ? row.operation_end.slice(0, 16)
        : '',
      origin: row.origin ?? '',
      destination: row.destination ?? '',
      sale_amount: String(row.sale_amount),
      buy_amount: row.buy_amount != null ? String(row.buy_amount) : '',
      status: (STATUSES.find(s => s.value === row.status)?.value ?? 'accepted') as StatusValue,
      unit_type: row.unit_type,
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)

    const payload: ProjectInsert = {
      project_code: form.project_code,
      project_name: form.project_name,
      client_id: form.client_id,
      contractor_id: form.contractor_id || null,
      operation_start: form.operation_start ? `${form.operation_start}:00+09:00` : null,
      operation_end: form.operation_end ? `${form.operation_end}:00+09:00` : null,
      origin: form.origin || null,
      destination: form.destination || null,
      sale_amount: Number(form.sale_amount),
      buy_amount: form.buy_amount !== '' ? Number(form.buy_amount) : null,
      status: form.status,
      unit_type: form.unit_type,
    }

    const result = editTarget
      ? await updateProject(editTarget.id, payload)
      : await createProject(payload)

    if (result.error) {
      setFormError(result.error)
    } else {
      setModalOpen(false)
      await load()
    }
    setSaving(false)
  }

  const filtered = filterStatus === 'all'
    ? rows
    : rows.filter(r => r.status === filterStatus)

  const fmt = (iso: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-xl font-semibold text-zinc-900 mb-6">案件・配車管理</h1>

        {/* ツールバー */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          {/* ステータスフィルタ */}
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
                  <th className="px-4 py-3 text-left font-medium">コード</th>
                  <th className="px-4 py-3 text-left font-medium">案件名</th>
                  <th className="px-4 py-3 text-left font-medium">ステータス</th>
                  <th className="px-4 py-3 text-left font-medium">荷主</th>
                  <th className="px-4 py-3 text-left font-medium">担当委託先</th>
                  <th className="px-4 py-3 text-left font-medium">積地 → 卸地</th>
                  <th className="px-4 py-3 text-left font-medium">運行開始</th>
                  <th className="px-4 py-3 text-right font-medium">受託運賃</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map(row => (
                  <tr key={row.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{row.project_code}</td>
                    <td className="px-4 py-3 font-medium text-zinc-900">{row.project_name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{row.client_name ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {row.contractor_name
                        ? row.contractor_name
                        : <span className="text-zinc-400 text-xs">未配車</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">
                      {row.origin && row.destination
                        ? `${row.origin} → ${row.destination}`
                        : row.origin ?? row.destination ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">{fmt(row.operation_start)}</td>
                    <td className="px-4 py-3 text-right text-zinc-900 font-medium">
                      ¥{row.selling_price?.toLocaleString() ?? '0'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEdit(row)}
                        className="text-xs text-zinc-500 hover:text-zinc-900 underline underline-offset-2"
                      >
                        編集
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {modalOpen && (
          <Modal
            title={editTarget ? '案件を編集' : '案件を新規登録'}
            onClose={() => setModalOpen(false)}
          >
            <form onSubmit={handleSubmit}>
              <ProjectFormFields
                form={form}
                onChange={setForm}
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
