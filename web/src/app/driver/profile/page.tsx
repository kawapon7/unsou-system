'use client'

import { useState, useEffect } from 'react'
import { handleLogout } from '@/app/auth/actions'
import { fetchMyProfile, type MyProfile } from '@/app/_actions/driver-actions'

export default function DriverProfilePage() {
  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetchMyProfile().then(res => {
      if (!alive) return
      if (res.error) setError(res.error)
      else setProfile(res.data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
      <h1 className="text-sm font-bold text-zinc-900">マイページ</h1>

      {loading ? (
        <p className="py-10 text-center text-sm text-zinc-400">読み込み中...</p>
      ) : error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : (
        <section className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
          <Row label="お名前"       value={profile?.name ?? '—'} />
          <Row label="メールアドレス" value={profile?.email ?? '—'} />
          <Row label="インボイス区分" value={profile?.invoiceRegistrationLabel ?? '—'} />
        </section>
      )}

      {/* ⚠️ 口座情報はここに出さない（暗号化保存の意味を薄めるため）。変更は親分側で行う */}
      <p className="px-1 text-xs leading-relaxed text-zinc-500">
        お名前・口座などの登録内容を変更したいときは、管理者にご連絡ください。
      </p>

      <form action={handleLogout}>
        <button
          type="submit"
          className="w-full rounded-xl border border-zinc-300 bg-white py-4 text-base font-medium text-zinc-700 active:bg-zinc-100"
        >
          ログアウト
        </button>
      </form>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-base text-zinc-900 break-all">{value}</p>
    </div>
  )
}
