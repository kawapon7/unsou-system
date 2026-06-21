'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  listUsers,
  listContractors,
  listProjects,
  createAdminUser,
  createDriverUser,
  updateUser,
  deleteUser,
  fetchDriverAssignments,
  updateDriverAssignments,
  type ManagedUser,
  type UserRole,
  type ProjectOption,
} from './actions'

type Contractor = { id: string; name: string }
type ModalType  = 'admin' | 'driver' | 'edit' | null

// ── ユーザーバッジ ────────────────────────────────────────

function RoleBadge({ role }: { role: UserRole }) {
  if (role === 'master') {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">
        管理者
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
      ドライバー
    </span>
  )
}

// ── 共通：パスワード入力ペア ──────────────────────────────

function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  required,
  placeholder,
}: {
  password: string
  confirm: string
  onPassword: (v: string) => void
  onConfirm: (v: string) => void
  required?: boolean
  placeholder?: string
}) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">
          パスワード{!required && <span className="ml-1 text-xs text-zinc-400">（変更する場合のみ入力）</span>}
        </label>
        <input
          type="password"
          required={required}
          value={password}
          onChange={e => onPassword(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200"
          placeholder={placeholder ?? '6文字以上'}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">パスワード（確認）</label>
        <input
          type="password"
          required={required && password.length > 0}
          value={confirm}
          onChange={e => onConfirm(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200"
          placeholder="もう一度入力"
        />
      </div>
    </>
  )
}

// ── 編集モーダル ──────────────────────────────────────────

function EditModal({
  user,
  contractors,
  onClose,
  onSaved,
}: {
  user: ManagedUser
  contractors: Contractor[]
  onClose: () => void
  onSaved: () => void
}) {
  const [role, setRole]                 = useState<UserRole>(user.role)
  const [contractorId, setContractorId] = useState(user.contractor_id ?? '')
  const [password, setPassword]         = useState('')
  const [confirm, setConfirm]           = useState('')
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password && password !== confirm) { setError('パスワードが一致しません'); return }
    if (password && password.length < 6)  { setError('パスワードは6文字以上にしてください'); return }
    setLoading(true)
    const result = await updateUser(user.id, {
      role: role !== user.role ? role : undefined,
      password: password || undefined,
      contractorId: role === 'driver' && contractorId !== user.contractor_id
        ? (contractorId || null)
        : undefined,
    })
    setLoading(false)
    if (result.error) { setError(result.error); return }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl max-h-[90vh] flex flex-col">
        <div className="border-b border-zinc-100 px-6 py-4 shrink-0">
          <h2 className="text-base font-semibold text-zinc-900">ユーザーを編集</h2>
          <p className="mt-0.5 text-xs text-zinc-400">{user.email}</p>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">ロール</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="role" value="master" checked={role === 'master'} onChange={() => setRole('master')} className="h-4 w-4" />
                <span className="text-sm text-zinc-700">管理者</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="role" value="driver" checked={role === 'driver'} onChange={() => setRole('driver')} className="h-4 w-4" />
                <span className="text-sm text-zinc-700">ドライバー</span>
              </label>
            </div>
          </div>
          {role === 'driver' && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">紐づく委託先</label>
              <select
                value={contractorId}
                onChange={e => setContractorId(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 bg-white"
              >
                <option value="">未設定</option>
                {contractors.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="border-t border-zinc-100 pt-4 space-y-4">
            <PasswordFields
              password={password}
              confirm={confirm}
              onPassword={setPassword}
              onConfirm={setConfirm}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 transition">
              キャンセル
            </button>
            <button type="submit" disabled={loading}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition disabled:opacity-50">
              {loading ? '保存中...' : '保存する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── 案件振り分けパネル ────────────────────────────────────

function ProjectAssignmentPanel({
  driver,
  onClose,
  onSaved,
}: {
  driver: ManagedUser
  onClose: () => void
  onSaved: () => void
}) {
  const [allProjects, setAllProjects] = useState<ProjectOption[]>([])
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [confirming, setConfirming]   = useState(false)

  useEffect(() => {
    if (!driver.contractor_id) { setLoading(false); return }
    Promise.all([
      listProjects(),
      fetchDriverAssignments(driver.contractor_id),
    ]).then(([projRes, assignRes]) => {
      if (projRes.data)   setAllProjects(projRes.data)
      if (assignRes.data) setAssignedIds(new Set(assignRes.data))
      setLoading(false)
    })
  }, [driver.contractor_id])

  // 荷主別グループ化
  const groups: { clientName: string; projects: ProjectOption[] }[] = []
  for (const p of allProjects) {
    const name = p.client_name ?? '（荷主未設定）'
    const g = groups.find(g => g.clientName === name)
    if (g) g.projects.push(p)
    else groups.push({ clientName: name, projects: [p] })
  }

  function toggle(id: string) {
    setAssignedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll()   { setAssignedIds(new Set(allProjects.map(p => p.id))) }
  function clearAll()    { setAssignedIds(new Set()) }
  function selectGroup(ids: string[]) {
    setAssignedIds(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next })
  }
  function clearGroup(ids: string[]) {
    setAssignedIds(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next })
  }

  async function handleSave() {
    if (!driver.contractor_id) return
    setSaving(true)
    setError(null)
    const result = await updateDriverAssignments(driver.contractor_id, [...assignedIds])
    setSaving(false)
    if (result.error) { setError(result.error); setConfirming(false); return }
    onSaved()
    onClose()
  }

  const driverLabel = driver.contractor_name ?? driver.email

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* ヘッダー */}
      <div className="border-b border-zinc-200 px-5 py-4 flex items-center gap-3 shrink-0">
        <button type="button" onClick={onClose}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50 transition">
          ← 戻る
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-zinc-900 truncate">{driverLabel}</h2>
          <p className="text-xs text-zinc-400">担当案件の振り分け</p>
        </div>
      </div>

      {/* ツールバー */}
      {!loading && allProjects.length > 0 && (
        <div className="border-b border-zinc-100 px-5 py-2.5 flex items-center gap-3 shrink-0 bg-zinc-50">
          <span className="text-xs text-zinc-500 flex-1">
            {assignedIds.size} 件選択中 / 全 {allProjects.length} 件
          </span>
          <button type="button" onClick={selectAll}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 transition">
            全選択
          </button>
          <span className="text-zinc-300">|</span>
          <button type="button" onClick={clearAll}
            className="text-xs font-medium text-zinc-400 hover:text-zinc-700 transition">
            全解除
          </button>
        </div>
      )}

      {/* 案件リスト */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
        ) : !driver.contractor_id ? (
          <div className="py-20 text-center text-sm text-zinc-400">委託先が紐づいていません</div>
        ) : allProjects.length === 0 ? (
          <div className="py-20 text-center text-sm text-zinc-400">案件が登録されていません</div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {groups.map(group => {
              const groupIds = group.projects.map(p => p.id)
              const checkedCount = groupIds.filter(id => assignedIds.has(id)).length
              const allChecked = checkedCount === groupIds.length
              return (
                <div key={group.clientName}>
                  {/* 荷主ヘッダー */}
                  <div className="sticky top-0 bg-zinc-50 border-b border-zinc-200 px-5 py-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-600">{group.clientName}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-zinc-400">
                        {checkedCount}/{groupIds.length}件
                      </span>
                      <button type="button"
                        onClick={() => allChecked ? clearGroup(groupIds) : selectGroup(groupIds)}
                        className="text-[11px] font-medium text-blue-500 hover:text-blue-700 transition">
                        {allChecked ? '解除' : '全選択'}
                      </button>
                    </div>
                  </div>
                  {/* 案件行 */}
                  {group.projects.map(p => (
                    <label key={p.id}
                      className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-zinc-50 select-none border-b border-zinc-50">
                      <input
                        type="checkbox"
                        checked={assignedIds.has(p.id)}
                        onChange={() => toggle(p.id)}
                        className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-400 shrink-0"
                      />
                      <span className="text-sm text-zinc-800 flex-1">{p.project_name}</span>
                      {p.project_code && (
                        <span className="text-xs text-zinc-400 shrink-0">{p.project_code}</span>
                      )}
                    </label>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* フッター */}
      {error && (
        <p className="px-5 py-2 text-xs text-red-600 bg-red-50 border-t border-red-100 shrink-0">{error}</p>
      )}
      {!loading && (
        <div className="border-t border-zinc-200 px-5 py-4 shrink-0 bg-white">
          <button
            type="button"
            disabled={saving}
            onClick={() => setConfirming(true)}
            className="w-full rounded-xl bg-zinc-900 py-3.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 transition"
          >
            登録する
          </button>
        </div>
      )}

      {/* 確認ダイアログ */}
      {confirming && (
        <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/30">
          <div className="w-full max-w-sm rounded-t-2xl bg-white shadow-2xl px-6 py-6 space-y-4">
            <h3 className="text-base font-bold text-zinc-900">登録内容を確認</h3>
            <p className="text-xs text-zinc-500">
              {driverLabel} さんの担当案件を以下の通り登録します。
            </p>
            <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100 max-h-48 overflow-y-auto">
              {assignedIds.size === 0 ? (
                <p className="px-4 py-3 text-sm text-zinc-400">（案件なし・表示されません）</p>
              ) : (
                groups.map(group => {
                  const selected = group.projects.filter(p => assignedIds.has(p.id))
                  if (selected.length === 0) return null
                  return (
                    <div key={group.clientName} className="px-4 py-2.5">
                      <p className="text-[10px] font-semibold text-zinc-400 mb-1">{group.clientName}</p>
                      {selected.map(p => (
                        <p key={p.id} className="text-sm text-zinc-800">・{p.project_name}</p>
                      ))}
                    </div>
                  )
                })
              )}
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setConfirming(false)} disabled={saving}
                className="flex-1 rounded-xl border border-zinc-200 py-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition">
                戻る
              </button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="flex-1 rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 transition">
                {saving ? '登録中...' : '登録'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 管理者作成モーダル ────────────────────────────────────

function AdminModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError('パスワードが一致しません'); return }
    if (password.length < 6) { setError('パスワードは6文字以上にしてください'); return }
    setLoading(true)
    const result = await createAdminUser(email, password)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-zinc-100 px-6 py-4">
          <h2 className="text-base font-semibold text-zinc-900">管理者アカウント作成</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200"
              placeholder="admin@example.com"
            />
          </div>
          <PasswordFields
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
            required
          />
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 transition"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition disabled:opacity-50"
            >
              {loading ? '作成中...' : '作成する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── ドライバー作成モーダル ────────────────────────────────

function DriverModal({
  contractors,
  onClose,
  onCreated,
}: {
  contractors: Contractor[]
  onClose: () => void
  onCreated: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [contractorId, setContractorId] = useState(contractors[0]?.id ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError('パスワードが一致しません'); return }
    if (password.length < 6) { setError('パスワードは6文字以上にしてください'); return }
    if (!contractorId) { setError('委託先を選択してください'); return }
    setLoading(true)
    const result = await createDriverUser(email, password, contractorId)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-zinc-100 px-6 py-4">
          <h2 className="text-base font-semibold text-zinc-900">ドライバーアカウント作成</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">委託先（ドライバー）</label>
            <select
              required
              value={contractorId}
              onChange={e => setContractorId(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 bg-white"
            >
              <option value="">選択してください</option>
              {contractors.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200"
              placeholder="driver@example.com"
            />
          </div>
          <PasswordFields
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
            required
          />
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 transition"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition disabled:opacity-50"
            >
              {loading ? '作成中...' : '作成する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────

export default function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalType>(null)
  const [editTarget, setEditTarget] = useState<ManagedUser | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [assigningDriver, setAssigningDriver] = useState<ManagedUser | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [usersResult, contractorsResult] = await Promise.all([
      listUsers(),
      listContractors(),
    ])
    if (usersResult.error) setError(usersResult.error)
    else setUsers(usersResult.data ?? [])
    if (contractorsResult.data) setContractors(contractorsResult.data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openEdit(user: ManagedUser) {
    setEditTarget(user)
    setModal('edit')
  }

  async function handleDelete(user: ManagedUser) {
    if (!window.confirm(`「${user.email}」を削除しますか？\nこの操作は取り消せません。`)) return
    setDeletingId(user.id)
    const result = await deleteUser(user.id)
    setDeletingId(null)
    if (result.error) { alert(`削除失敗: ${result.error}`); return }
    await load()
  }

  const admins = users.filter(u => u.role === 'master')
  const drivers = users.filter(u => u.role === 'driver')

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">ユーザー管理</h1>
          <p className="mt-0.5 text-sm text-zinc-500">管理者・ドライバーのアカウントを管理します</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setModal('driver')}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
          >
            + ドライバー追加
          </button>
          <button
            onClick={() => setModal('admin')}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition"
          >
            + 管理者追加
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">読み込み中...</div>
      ) : (
        <>
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">
              管理者 ({admins.length})
            </h2>
            <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
              {admins.length === 0 ? (
                <p className="px-5 py-4 text-sm text-zinc-400">管理者アカウントがありません</p>
              ) : (
                admins.map(u => (
                  <UserRow
                    key={u.id}
                    user={u}
                    deleting={deletingId === u.id}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                  />
                ))

              )}
            </div>
          </section>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">
              ドライバー ({drivers.length})
            </h2>
            <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
              {drivers.length === 0 ? (
                <p className="px-5 py-4 text-sm text-zinc-400">ドライバーアカウントがありません</p>
              ) : (
                drivers.map(u => (
                  <UserRow
                    key={u.id}
                    user={u}
                    deleting={deletingId === u.id}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onAssign={setAssigningDriver}
                  />
                ))
              )}
            </div>
          </section>
        </>
      )}

      {modal === 'edit' && editTarget && (
        <EditModal
          user={editTarget}
          contractors={contractors}
          onClose={() => { setModal(null); setEditTarget(null) }}
          onSaved={load}
        />
      )}
      {modal === 'admin' && (
        <AdminModal
          onClose={() => setModal(null)}
          onCreated={load}
        />
      )}
      {modal === 'driver' && (
        <DriverModal
          contractors={contractors}
          onClose={() => setModal(null)}
          onCreated={load}
        />
      )}
      {assigningDriver && (
        <ProjectAssignmentPanel
          driver={assigningDriver}
          onClose={() => setAssigningDriver(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

function UserRow({
  user,
  deleting,
  onEdit,
  onDelete,
  onAssign,
}: {
  user: ManagedUser
  deleting: boolean
  onEdit: (u: ManagedUser) => void
  onDelete: (u: ManagedUser) => void
  onAssign?: (u: ManagedUser) => void
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-zinc-900 truncate">{user.email}</span>
          <RoleBadge role={user.role} />
        </div>
        {user.contractor_name && (
          <p className="mt-0.5 text-xs text-zinc-400">{user.contractor_name}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {user.role === 'driver' && onAssign && (
          <button
            onClick={() => onAssign(user)}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100 hover:border-blue-300 transition"
          >
            案件振り分け
          </button>
        )}
        <button
          onClick={() => onEdit(user)}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-900 hover:bg-zinc-50 transition"
        >
          編集
        </button>
        <button
          onClick={() => onDelete(user)}
          disabled={deleting}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 hover:border-red-200 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-40"
        >
          {deleting ? '削除中...' : '削除'}
        </button>
      </div>
    </div>
  )
}
