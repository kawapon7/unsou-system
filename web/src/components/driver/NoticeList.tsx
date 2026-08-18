'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { fetchMyNotices, markNoticeRead, type MyNotice } from '@/app/_actions/driver-actions'

/**
 * アプリ内お知らせ。
 * ⚠️ 既読表（notification_reads）が本番未適用のあいだは全件が未読で出る。
 *    その状態でも「催促が見えない」よりは良い、という判断（Server Action 側のコメント参照）。
 */
export default function NoticeList() {
  const [notices, setNotices] = useState<MyNotice[]>([])
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetchMyNotices().then(res => {
      if (!alive) return
      if (res.error) setError(res.error)
      else setNotices(res.data ?? [])
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const unread = notices.filter(n => !n.isRead)

  async function handleRead(id: string) {
    // 先に画面を更新し、失敗したら戻す（タップの反応を待たせない）
    setNotices(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
    const res = await markNoticeRead(id)
    if (res.error) setNotices(prev => prev.map(n => n.id === id ? { ...n, isRead: false } : n))
  }

  if (loading) return null
  if (error) {
    return <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
  }
  if (unread.length === 0) return null

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="text-sm font-bold text-zinc-900">お知らせ（{unread.length}）</h2>

      <ul className="mt-3 space-y-3">
        {unread.slice(0, 5).map(n => (
          <li key={n.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-base font-bold text-amber-900">{n.title}</p>
              <span className="shrink-0 text-xs text-amber-700 tabular-nums">{n.date.slice(5).replace('-', '/')}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-amber-900">{n.body}</p>

            <div className="mt-3 flex gap-2">
              <Link
                href={n.href}
                className="flex-1 rounded-lg bg-amber-600 py-3 text-center text-sm font-bold text-white active:bg-amber-700"
              >
                対応する
              </Link>
              <button
                onClick={() => handleRead(n.id)}
                className="rounded-lg border border-amber-300 bg-white px-4 py-3 text-sm font-medium text-amber-800 active:bg-amber-100"
              >
                閉じる
              </button>
            </div>
          </li>
        ))}
      </ul>

      {unread.length > 5 && (
        <p className="mt-3 text-center text-xs text-zinc-400">他 {unread.length - 5} 件</p>
      )}
    </section>
  )
}
