'use client'

import { useState, useEffect } from 'react'
import {
  fetchMyWorkRecords,
  fetchMyMonthSummary,
  type MyWorkRecordRow,
  type MonthSummary,
} from '@/app/_actions/driver-actions'

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

const currentYearMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const dayLabel = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${m}/${d}`
}

export default function WorkRecordList() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [rows,      setRows]      = useState<MyWorkRecordRow[]>([])
  const [summary,   setSummary]   = useState<MonthSummary | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [openId,    setOpenId]    = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([fetchMyWorkRecords(yearMonth), fetchMyMonthSummary(yearMonth)]).then(([w, s]) => {
      if (!alive) return
      if (w.error) { setError(w.error); setRows([]) }
      else { setRows(w.data ?? []); setError(null) }
      setSummary(s.error ? null : s.data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [yearMonth])

  const laborTotal = rows.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-zinc-900">実績</h2>
        <input
          type="month"
          value={yearMonth}
          onChange={e => { setLoading(true); setYearMonth(e.target.value) }}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500"
        />
      </div>

      {/* ⚠️ 集計期間は暦月ではなく委託先の締め期間。ここを出さないと
          「月を選んだのに前月末の稼働が入っている」と誤解される */}
      {summary && (
        <p className="text-[11px] text-zinc-400">
          集計期間 {summary.period.from} 〜 {summary.period.to}
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-zinc-400">読み込み中...</p>
      ) : error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-zinc-400 rounded-xl border border-dashed border-zinc-200 bg-white">
          この期間の稼働はありません
        </div>
      ) : (
        <>
          <ul className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
            {rows.map(r => (
              <li key={r.id}>
                <button
                  onClick={() => setOpenId(openId === r.id ? null : r.id)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left active:bg-zinc-50"
                >
                  <div className="min-w-0">
                    <p className="text-base font-medium text-zinc-900 tabular-nums">{dayLabel(r.workDate)}</p>
                    <p className="text-sm text-zinc-500 truncate">{r.projectName}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold text-zinc-900 tabular-nums">{yen(r.amount)}</p>
                    <p className="text-xs text-zinc-400">{r.pieceCount}個</p>
                  </div>
                </button>

                {/* 単価の内訳（金額の根拠）。問い合わせを減らすために出す */}
                {openId === r.id && (
                  <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-3">
                    <p className="text-xs text-zinc-500">内訳</p>
                    <p className="mt-1 text-sm font-medium text-zinc-800">{r.formula}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-4">
            <span className="text-sm font-bold text-zinc-900">労務報酬 小計（税抜）</span>
            <span className="text-xl font-bold text-zinc-900 tabular-nums">{yen(laborTotal)}</span>
          </div>

          <p className="px-1 text-[11px] leading-relaxed text-zinc-400">
            ※ 立替経費・消費税・控除を含めた支払額は「支払」タブでご確認ください。
          </p>
        </>
      )}
    </div>
  )
}
