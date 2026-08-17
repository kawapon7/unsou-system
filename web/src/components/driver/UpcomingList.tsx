'use client'

import { useState, useEffect } from 'react'
import { fetchMyUpcomingSchedules, type UpcomingSchedule } from '@/app/_actions/driver-actions'

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

/** 'YYYY-MM-DD' をローカル日付として読む。new Date(iso) はUTC解釈で曜日が1日ずれる */
function label(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${m}/${d}（${WEEK[new Date(y, m - 1, d).getDay()]}）`
}

export default function UpcomingList() {
  const [rows,    setRows]    = useState<UpcomingSchedule[]>([])
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    // 先の予定は30件まで。これ以上はカレンダーで見るほうが早い
    fetchMyUpcomingSchedules(30).then(res => {
      if (!alive) return
      if (res.error) setError(res.error)
      else setRows(res.data ?? [])
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  if (loading) return <p className="py-10 text-center text-sm text-zinc-400">読み込み中...</p>
  if (error)   return <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-zinc-400 rounded-xl border border-dashed border-zinc-200 bg-white">
        今日以降の予定はありません
      </div>
    )
  }

  return (
    <ul className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
      {rows.map(r => (
        <li key={`${r.date}-${r.projectName}`} className="flex items-center justify-between gap-3 px-4 py-4">
          <span className="text-base font-medium text-zinc-900 tabular-nums shrink-0">{label(r.date)}</span>
          <span className={`text-base text-right ${r.status === 'absent' ? 'text-zinc-400' : 'text-zinc-800'}`}>
            {r.projectName}
          </span>
        </li>
      ))}
    </ul>
  )
}
