'use client'

import { useState, useTransition, useCallback, useEffect } from 'react'
import {
  fetchSchedules,
  upsertSchedule,
  deleteSchedule,
  copyPrevMonthSchedules,
  fetchDriverProjectOptions,
  fetchMyWorkedDates,
  type ScheduleStatus,
} from '@/app/_actions/scheduleActions'
import { submitWorkRecord, submitOffMasterReport } from '@/app/_actions/workRecordActions'

// ── 型定義 ──────────────────────────────────────────────────────

type ScheduleEntry = { id: string; status: ScheduleStatus; projectId: string }
type ScheduleMap   = Map<string, ScheduleEntry>   // key: 'YYYY-MM-DD'
type ProjectOption = { id: string; name: string }

type BottomSheet =
  | { type: 'complete'; date: string; entry: ScheduleEntry }
  | { type: 'offmaster'; date: string }
  | null

// ── ユーティリティ ───────────────────────────────────────────────

function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function prevYearMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function buildCalendarDays(yearMonth: string): (string | null)[] {
  const [y, m] = yearMonth.split('-').map(Number)
  const firstDay    = new Date(y, m - 1, 1).getDay()
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${yearMonth}-${String(d).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DAY_HEADERS = ['日', '月', '火', '水', '木', '金', '土']

// ── DayCell ──────────────────────────────────────────────────────

function DayCell({
  date,
  entry,
  isToday,
  isSunday,
  isSaturday,
  isWorked,
  isPending,
  onTap,
}: {
  date:       string
  entry:      ScheduleEntry | undefined
  isToday:    boolean
  isSunday:   boolean
  isSaturday: boolean
  isWorked:   boolean
  isPending:  boolean
  onTap:      (date: string) => void
}) {
  const day = parseInt(date.split('-')[2], 10)

  let bg = 'bg-white'
  let textColor = isSunday ? 'text-rose-500' : isSaturday ? 'text-blue-500' : 'text-zinc-800'
  let badge: React.ReactNode = null

  if (isWorked) {
    bg = 'bg-emerald-500'
    textColor = 'text-white'
    badge = <span className="block text-[8px] font-bold">完了</span>
  } else if (entry?.status === 'scheduled') {
    bg = 'bg-blue-500'
    textColor = 'text-white'
    badge = <span className="block text-[8px] font-bold">予定</span>
  } else if (entry?.status === 'absent') {
    bg = 'bg-zinc-200'
    textColor = 'text-zinc-400'
    badge = <span className="block text-[8px]">休み</span>
  }

  const ringCls = isToday ? 'ring-2 ring-offset-1 ring-zinc-900' : ''

  return (
    <button
      type="button"
      onClick={() => !isPending && onTap(date)}
      disabled={isPending}
      className={`
        aspect-square w-full rounded-lg flex flex-col items-center justify-center gap-0.5
        text-xs font-semibold transition-transform active:scale-95 select-none
        ${bg} ${textColor} ${ringCls}
        disabled:opacity-50
      `}
    >
      <span>{day}</span>
      {badge}
    </button>
  )
}

// ── 完了確認ボトムシート ─────────────────────────────────────────

function CompleteSheet({
  date,
  projectName,
  onComplete,
  onClose,
  submitting,
}: {
  date:        string
  projectName: string
  onComplete:  () => void
  onClose:     () => void
  submitting:  boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-t-2xl bg-white shadow-2xl overflow-hidden">
        <div className="px-5 pt-6 pb-2">
          <p className="text-xs text-zinc-500 mb-1 tabular-nums">{date}</p>
          <h3 className="text-base font-bold text-zinc-900 mb-1">{projectName}</h3>
          <p className="text-sm text-zinc-500">この案件の稼働を「完了」として報告します。</p>
        </div>
        <div className="px-5 pb-6 pt-3 space-y-3">
          <button
            type="button"
            onClick={onComplete}
            disabled={submitting}
            className="w-full rounded-xl bg-emerald-600 py-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
          >
            {submitting ? '送信中…' : '✅ 完了報告する'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 突発案件報告ボトムシート ─────────────────────────────────────

function OffMasterSheet({
  date,
  onSubmit,
  onClose,
  submitting,
}: {
  date:       string
  onSubmit:   (jobName: string) => void
  onClose:    () => void
  submitting: boolean
}) {
  const [jobName, setJobName] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-t-2xl bg-white shadow-2xl overflow-hidden">
        <div className="px-5 pt-6 pb-2">
          <p className="text-xs text-zinc-500 mb-1 tabular-nums">{date}</p>
          <h3 className="text-base font-bold text-zinc-900 mb-1">マスタ外の完了報告</h3>
          <p className="text-sm text-zinc-500">
            事前に登録されていない急な仕事の場合、案件名を入力して報告してください。<br />
            金額は空欄のまま管理者に通知されます。
          </p>
        </div>
        <div className="px-5 pb-6 pt-3 space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">案件名</label>
            <input
              type="text"
              value={jobName}
              onChange={e => setJobName(e.target.value)}
              placeholder="例：〇〇配送、△△荷卸し…"
              maxLength={100}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={() => jobName.trim() && onSubmit(jobName.trim())}
            disabled={submitting || !jobName.trim()}
            className="w-full rounded-xl bg-rose-600 py-4 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50 transition"
          >
            {submitting ? '送信中…' : '📣 管理者へ報告する'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 凡例 ─────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-[10px] text-zinc-500">
      {[
        { color: 'bg-blue-500',    label: '稼働予定' },
        { color: 'bg-emerald-500', label: '完了' },
        { color: 'bg-zinc-200',    label: '休み' },
      ].map(s => (
        <span key={s.label} className="flex items-center gap-1">
          <span className={`inline-block w-2.5 h-2.5 rounded-sm ${s.color}`} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

// ── メインコンポーネント ─────────────────────────────────────────

export default function ScheduleCalendar() {
  const [yearMonth,  setYearMonth]  = useState(currentYearMonth)
  const [schedules,  setSchedules]  = useState<ScheduleMap>(new Map())
  const [workedDates, setWorkedDates] = useState<string[]>([])
  const [projects,   setProjects]   = useState<ProjectOption[]>([])
  const [loadErr,    setLoadErr]    = useState<string | null>(null)
  const [loadingCal, setLoadingCal] = useState(true)
  const [isPending,  startTransition] = useTransition()

  const [bottomSheet,  setBottomSheet]  = useState<BottomSheet>(null)
  const [submitting,   setSubmitting]   = useState(false)
  const [submitMsg,    setSubmitMsg]    = useState<{ text: string; ok: boolean } | null>(null)

  const [copying,  setCopying]  = useState(false)
  const [copyMsg,  setCopyMsg]  = useState<string | null>(null)

  const today = todayISO()

  // ── 案件リスト取得 ──────────────────────────────────────
  useEffect(() => {
    fetchDriverProjectOptions().then(res => {
      if (res.data) setProjects(res.data)
    })
  }, [])

  // ── カレンダー読み込み ──────────────────────────────────
  const load = useCallback(async (ym: string) => {
    setLoadingCal(true)
    setLoadErr(null)
    try {
      const [schedRes, workedRes] = await Promise.all([
        fetchSchedules(ym),
        fetchMyWorkedDates(ym),
      ])
      if (schedRes.error) { setLoadErr(schedRes.error); return }
      if (workedRes.error) { setLoadErr(workedRes.error); return }
      const map: ScheduleMap = new Map()
      for (const row of schedRes.data ?? []) {
        map.set(row.date, { id: row.id, status: row.status, projectId: row.projectId })
      }
      setSchedules(map)
      setWorkedDates(workedRes.data ?? [])
    } catch {
      setLoadErr('予定データの読み込みに失敗しました')
    } finally {
      setLoadingCal(false)
    }
  }, [])

  useEffect(() => { load(yearMonth) }, [load, yearMonth])

  // ── セルタップ ──────────────────────────────────────────
  function handleDayTap(date: string) {
    const entry = schedules.get(date)
    const isAlreadyWorked = workedDates.includes(date)

    if (isAlreadyWorked) return   // 完了済みは操作不可

    if (entry?.status === 'scheduled') {
      // 稼働予定セル → 完了確認シートを開く
      setBottomSheet({ type: 'complete', date, entry })
    } else if (!entry) {
      // 空セル → 突発案件報告シートを開く
      setBottomSheet({ type: 'offmaster', date })
    } else {
      // absent → toggle（休み取り消し）
      const prev = entry
      setSchedules(p => { const m = new Map(p); m.delete(date); return m })
      startTransition(async () => {
        if (!entry.id) return
        const res = await deleteSchedule(entry.id)
        if (res.error) {
          setSchedules(p => new Map(p).set(date, prev))
          setLoadErr(res.error)
        }
      })
    }
  }

  // ── 完了報告（スケジュール済み案件） ──────────────────────
  async function handleComplete() {
    if (bottomSheet?.type !== 'complete') return
    if (submitting) return
    setSubmitting(true)
    const { date, entry } = bottomSheet
    const res = await submitWorkRecord({ projectId: entry.projectId, date }, { force: false })
    setSubmitting(false)
    if (res.error && res.error !== 'DUPLICATE_EXISTS') {
      setSubmitMsg({ text: `エラー: ${res.error}`, ok: false })
      setBottomSheet(null)
      return
    }
    setWorkedDates(prev => [...new Set([...prev, date])])
    setSubmitMsg({ text: '完了を報告しました', ok: true })
    setBottomSheet(null)
    setTimeout(() => setSubmitMsg(null), 3000)
  }

  // ── 突発案件報告 ──────────────────────────────────────────
  async function handleOffMasterSubmit(jobName: string) {
    if (bottomSheet?.type !== 'offmaster') return
    if (submitting) return
    setSubmitting(true)
    const { date } = bottomSheet
    const res = await submitOffMasterReport({ date, jobName })
    setSubmitting(false)
    if (res.error) {
      setSubmitMsg({ text: `エラー: ${res.error}`, ok: false })
      setBottomSheet(null)
      return
    }
    setSubmitMsg({ text: '管理者へ報告しました', ok: true })
    setBottomSheet(null)
    setTimeout(() => setSubmitMsg(null), 3000)
  }

  // ── 前月コピー ─────────────────────────────────────────
  async function handleCopyPrevMonth() {
    if (copying) return
    const fromYM = prevYearMonth(yearMonth)
    setCopying(true)
    setCopyMsg(null)
    const res = await copyPrevMonthSchedules({ fromYearMonth: fromYM, toYearMonth: yearMonth })
    if (res.error) {
      setCopyMsg(`エラー: ${res.error}`)
    } else {
      const count = res.data?.copied ?? 0
      setCopyMsg(count > 0
        ? `${fromYM} の予定を ${count} 件コピーしました`
        : `${fromYM} にコピー元の予定がありません`
      )
      await load(yearMonth)
    }
    setCopying(false)
    setTimeout(() => setCopyMsg(null), 4000)
  }

  const cells = buildCalendarDays(yearMonth)
  const [y, m] = yearMonth.split('-').map(Number)

  const projectName = (id: string) =>
    projects.find(p => p.id === id)?.name ?? '案件'

  return (
    <div className="space-y-5">

      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const d = new Date(y, m - 2, 1)
              setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
            }}
            className="h-8 w-8 flex items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 text-sm"
          >‹</button>
          <h2 className="text-base font-bold text-zinc-900 tabular-nums min-w-[90px] text-center">
            {y}年{m}月
          </h2>
          <button
            type="button"
            onClick={() => {
              const d = new Date(y, m, 1)
              setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
            }}
            className="h-8 w-8 flex items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 text-sm"
          >›</button>
        </div>
        <button
          type="button"
          onClick={handleCopyPrevMonth}
          disabled={copying || isPending || loadingCal}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition
            ${copying ? 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed'
                      : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
        >
          {copying ? '…コピー中' : '📋 前月の予定をコピー'}
        </button>
      </div>

      {copyMsg && (
        <div className={`rounded-lg px-3 py-2 text-xs border ${copyMsg.startsWith('エラー') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
          {copyMsg}
        </div>
      )}

      {submitMsg && (
        <div className={`rounded-lg px-3 py-2 text-xs border font-medium ${submitMsg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {submitMsg.ok ? '✅ ' : '✗ '}{submitMsg.text}
        </div>
      )}

      {loadErr && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
          {loadErr}
        </div>
      )}

      {/* カレンダー */}
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 sm:p-4">
        <div className="grid grid-cols-7 mb-2">
          {DAY_HEADERS.map((h, i) => (
            <div key={h} className={`text-center text-[10px] font-semibold py-1 ${
              i === 0 ? 'text-rose-400' : i === 6 ? 'text-blue-400' : 'text-zinc-400'
            }`}>{h}</div>
          ))}
        </div>

        {loadingCal ? (
          <div className="py-16 text-center text-sm text-zinc-400">読み込み中…</div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, i) =>
              date === null ? (
                <div key={`empty-${i}`} />
              ) : (
                <DayCell
                  key={date}
                  date={date}
                  entry={schedules.get(date)}
                  isToday={date === today}
                  isSunday={i % 7 === 0}
                  isSaturday={i % 7 === 6}
                  isWorked={workedDates.includes(date)}
                  isPending={isPending}
                  onTap={handleDayTap}
                />
              )
            )}
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-zinc-200">
          <Legend />
        </div>
      </div>

      {/* サマリー */}
      {!loadingCal && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '稼働予定', value: [...schedules.values()].filter(s => s.status === 'scheduled').length, color: 'text-blue-600' },
            { label: '休み予定', value: [...schedules.values()].filter(s => s.status === 'absent').length,    color: 'text-zinc-400' },
            { label: '完了済み', value: workedDates.length, color: 'text-emerald-600' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-zinc-200 bg-white px-3 py-3 text-center">
              <p className="text-xs text-zinc-500 mb-1">{s.label}</p>
              <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 操作ガイド */}
      <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-xs text-zinc-500 space-y-1">
        <p className="font-semibold text-zinc-700">使い方</p>
        <p>• <span className="text-blue-600 font-medium">青（予定）</span>のセルをタップ → 完了報告（1タップで完了）</p>
        <p>• <span className="text-zinc-600 font-medium">空白</span>のセルをタップ → マスタ外の突発案件を報告</p>
        <p>• <span className="text-zinc-400 font-medium">休み</span>のセルをタップ → 休み取り消し</p>
      </div>

      {/* ボトムシート */}
      {bottomSheet?.type === 'complete' && (
        <CompleteSheet
          date={bottomSheet.date}
          projectName={projectName(bottomSheet.entry.projectId)}
          onComplete={handleComplete}
          onClose={() => setBottomSheet(null)}
          submitting={submitting}
        />
      )}

      {bottomSheet?.type === 'offmaster' && (
        <OffMasterSheet
          date={bottomSheet.date}
          onSubmit={handleOffMasterSubmit}
          onClose={() => setBottomSheet(null)}
          submitting={submitting}
        />
      )}
    </div>
  )
}
