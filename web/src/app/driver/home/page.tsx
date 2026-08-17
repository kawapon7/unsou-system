'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  fetchMyMonthSummary,
  fetchMyUpcomingSchedules,
  fetchMyPaymentNotices,
  type MonthSummary,
  type UpcomingSchedule,
} from '@/app/_actions/driver-actions'

const currentYearMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  // ⚠️ new Date('YYYY-MM-DD') はUTC解釈で曜日が1日ずれることがあるため、
  //    ローカル日付として組み立てる
  const [y] = iso.split('-').map(Number)
  return `${m}/${d}(${WEEK[new Date(y, m - 1, d).getDay()]})`
}

export default function DriverHomePage() {
  const yearMonth = currentYearMonth()

  const [summary,  setSummary]  = useState<MonthSummary | null>(null)
  const [sumErr,   setSumErr]   = useState<string | null>(null)
  const [sumLoad,  setSumLoad]  = useState(true)

  const [upcoming, setUpcoming] = useState<UpcomingSchedule[]>([])
  const [pendingCount, setPendingCount] = useState(0)

  // ⚠️ effect の中で setState を同期的に呼ばないこと（cascading renders になる）。
  //    await を挟んでから更新し、アンマウント後の更新は alive で止める。
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [s, u, n] = await Promise.all([
        fetchMyMonthSummary(yearMonth),
        fetchMyUpcomingSchedules(3),
        fetchMyPaymentNotices(),
      ])
      if (!alive) return

      if (s.error) setSumErr(s.error)
      else { setSummary(s.data); setSumErr(null) }
      setSumLoad(false)

      if (!u.error && u.data) setUpcoming(u.data)
      if (!n.error && n.data) setPendingCount(n.data.filter(x => x.approvalStatus !== 'approved').length)
    })()
    return () => { alive = false }
  }, [yearMonth])

  const [, month] = yearMonth.split('-')

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">

      {/* ── 今月の金額 ─────────────────────────────── */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-bold text-zinc-900">{Number(month)}月の{summary?.isConfirmed ? '支払額' : '見込み'}</h2>

        {sumLoad ? (
          <p className="py-6 text-center text-sm text-zinc-400">読み込み中...</p>
        ) : sumErr ? (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {sumErr}
          </div>
        ) : summary?.estimatedAmount === null ? (
          // ⚠️ ここで ¥0 を出さないこと。「働いたのに報酬0」と読めてしまう
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            金額を取得できませんでした。時間をおいて開き直してください。
          </div>
        ) : (
          <>
            <p className="mt-2 text-4xl font-bold tracking-tight text-zinc-900 tabular-nums">
              {yen(summary?.estimatedAmount ?? 0)}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {summary?.isConfirmed
                ? '※ 確定した支払通知書の金額です'
                : '※ 確定前の見込みです。締め後に変わることがあります'}
            </p>
          </>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-4">
          <div>
            <p className="text-xs text-zinc-500">稼働日数</p>
            <p className="text-xl font-bold text-zinc-900 tabular-nums">{summary?.workDays ?? 0}<span className="ml-1 text-sm font-medium text-zinc-500">日</span></p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">個数</p>
            <p className="text-xl font-bold text-zinc-900 tabular-nums">{summary?.pieceTotal ?? 0}<span className="ml-1 text-sm font-medium text-zinc-500">個</span></p>
          </div>
        </div>

        {summary && (
          <p className="mt-3 text-[11px] text-zinc-400">
            集計期間 {summary.period.from} 〜 {summary.period.to}
          </p>
        )}
      </section>

      {/* ── 未承認の通知書 ─────────────────────────── */}
      {pendingCount > 0 && (
        <Link
          href="/driver/billing"
          className="flex items-center justify-between rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 active:bg-amber-100"
        >
          <span className="text-sm font-bold text-amber-900">
            ⚠ 未承認の支払通知書が {pendingCount} 件
          </span>
          <span className="text-sm font-medium text-amber-700">確認する →</span>
        </Link>
      )}

      {/* ── 次の予定 ───────────────────────────────── */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-900">次の予定</h2>
          <Link href="/driver/schedule" className="text-xs font-medium text-zinc-500">すべて見る →</Link>
        </div>

        {upcoming.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400">予定はありません</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {upcoming.map(s => (
              <li key={`${s.date}-${s.projectName}`} className="flex items-center justify-between py-3">
                <span className="text-base font-medium text-zinc-900 tabular-nums">{shortDate(s.date)}</span>
                <span className={`text-base ${s.status === 'absent' ? 'text-zinc-400' : 'text-zinc-700'}`}>
                  {s.projectName}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
