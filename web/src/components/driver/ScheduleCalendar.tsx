'use client'

import { useState, useTransition, useCallback, useEffect, useRef } from 'react'

// ── 型定義 ──────────────────────────────────────────────────────
type ScheduleStatus = 'scheduled' | 'absent'
type ScheduleMap   = Map<string, ScheduleStatus>  // key: 'YYYY-MM-DD'

type WorkRecord = {
  id:        string
  date:      string   // 'YYYY-MM-DD'
  projectId: string
  note:      string
}

type MockProject = { id: string; name: string }

// ── モック定数 ──────────────────────────────────────────────────
const MOCK_PROJECTS: MockProject[] = [
  { id: 'proj-001', name: '東京→大阪 定期便' },
  { id: 'proj-002', name: '名古屋スポット' },
  { id: 'proj-003', name: '横浜港 荷役' },
]

// ── モック API（実装時に Server Actions へ差し替え） ──────────────
async function mockFetchSchedules(yearMonth: string): Promise<ScheduleMap> {
  await delay(400)
  // 当月の 3日・5日・10日を scheduled で返すサンプルデータ
  const map: ScheduleMap = new Map()
  const days = [3, 5, 10, 15, 20, 22, 25]
  days.forEach(d => {
    map.set(`${yearMonth}-${String(d).padStart(2, '0')}`, 'scheduled')
  })
  return map
}

async function mockUpsertSchedule(date: string, status: ScheduleStatus | null): Promise<void> {
  await delay(500)
  // null = 削除（クリア）
}

async function mockCopyPrevMonth(fromYM: string, toYM: string): Promise<number> {
  await delay(800)
  return 12  // コピーした件数（サンプル）
}

async function mockFetchWorkRecords(yearMonth: string): Promise<WorkRecord[]> {
  await delay(300)
  return [
    { id: 'wr-001', date: `${yearMonth}-03`, projectId: 'proj-001', note: '' },
    { id: 'wr-002', date: `${yearMonth}-10`, projectId: 'proj-002', note: '' },
  ]
}

async function mockSubmitWorkRecord(rec: Omit<WorkRecord, 'id'>): Promise<string> {
  await delay(700)
  return `wr-${Date.now()}`
}

function delay(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

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
  const firstDay = new Date(y, m - 1, 1).getDay()  // 0=Sun
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

// ── 重複警告モーダル ─────────────────────────────────────────────
function DuplicateModal({
  date,
  projectName,
  onConfirm,
  onCancel,
}: {
  date:        string
  projectName: string
  onConfirm:   () => void
  onCancel:    () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xl">⚠️</span>
            <h3 className="font-bold text-zinc-900 text-base">記録が重複しています</h3>
          </div>
          <p className="text-sm text-zinc-600 leading-relaxed">
            <span className="font-semibold text-zinc-800">{date}</span>（
            <span className="font-semibold text-zinc-800">{projectName}</span>）
            には既に勤務記録があります。<br />本当に登録しますか？
          </p>
        </div>
        <div className="grid grid-cols-2 border-t border-zinc-100">
          <button
            onClick={onCancel}
            className="py-4 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition border-r border-zinc-100"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className="py-4 text-sm font-bold text-rose-600 hover:bg-rose-50 transition"
          >
            それでも登録
          </button>
        </div>
      </div>
    </div>
  )
}

// ── カレンダーセル ───────────────────────────────────────────────
const DAY_HEADERS = ['日', '月', '火', '水', '木', '金', '土']

const STATUS_STYLE: Record<ScheduleStatus, { bg: string; text: string; ring: string; label: string }> = {
  scheduled: { bg: 'bg-blue-500', text: 'text-white', ring: 'ring-blue-300', label: '予定' },
  absent:    { bg: 'bg-zinc-200', text: 'text-zinc-500', ring: 'ring-zinc-300', label: '休み' },
}

function DayCell({
  date,
  status,
  isToday,
  isSunday,
  isSaturday,
  isPending,
  onTap,
}: {
  date:       string
  status:     ScheduleStatus | undefined
  isToday:    boolean
  isSunday:   boolean
  isSaturday: boolean
  isPending:  boolean
  onTap:      (date: string) => void
}) {
  const day     = Number(date.split('-')[2])
  const style   = status ? STATUS_STYLE[status] : null
  const dayText = isSunday ? 'text-rose-500' : isSaturday ? 'text-blue-400' : 'text-zinc-700'

  return (
    <button
      type="button"
      onClick={() => onTap(date)}
      disabled={isPending}
      aria-label={`${date} ${status ?? '未設定'}`}
      className={`
        relative flex flex-col items-center justify-start gap-0.5 rounded-xl p-1.5 min-h-[52px] transition-all
        ${style ? `${style.bg} ${style.text} ring-2 ${style.ring}` : 'bg-white hover:bg-zinc-50 active:bg-zinc-100'}
        ${isToday && !style ? 'ring-2 ring-zinc-900' : ''}
        ${isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        border border-zinc-100
      `}
    >
      <span className={`text-xs font-semibold tabular-nums ${style ? '' : dayText} ${isToday && !style ? 'text-zinc-900 font-bold' : ''}`}>
        {day}
      </span>
      {style && (
        <span className="text-[9px] font-medium leading-none opacity-90">{style.label}</span>
      )}
      {isToday && (
        <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full ${style ? 'bg-white/60' : 'bg-zinc-900'}`} />
      )}
    </button>
  )
}

// ── 凡例 ─────────────────────────────────────────────────────────
function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-zinc-500">
      {Object.entries(STATUS_STYLE).map(([k, v]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-full ${v.bg}`} />
          {v.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full ring-2 ring-zinc-900 bg-white" />
        今日
      </span>
    </div>
  )
}

// ── 勤務記録フォーム ─────────────────────────────────────────────
function WorkRecordForm({
  yearMonth,
  workRecords,
  onSubmitted,
}: {
  yearMonth:   string
  workRecords: WorkRecord[]
  onSubmitted: (rec: WorkRecord) => void
}) {
  const [date,      setDate]      = useState(todayISO())
  const [projectId, setProjectId] = useState(MOCK_PROJECTS[0].id)
  const [note,      setNote]      = useState('')
  const [err,       setErr]       = useState<string | null>(null)
  const [ok,        setOk]        = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // 重複モーダル
  const [dupModal, setDupModal]   = useState<{ date: string; projectName: string } | null>(null)
  const pendingSubmitRef = useRef<(() => Promise<void>) | null>(null)

  function isDuplicate(d: string, pid: string) {
    return workRecords.some(r => r.date === d && r.projectId === pid)
  }

  async function doSubmit() {
    if (submitting) return          // 連打ガード
    setSubmitting(true)             // 即座に disabled
    setErr(null)
    try {
      const id = await mockSubmitWorkRecord({ date, projectId, note })
      onSubmitted({ id, date, projectId, note })
      setOk(true)
      setNote('')
      setTimeout(() => setOk(false), 3000)
    } catch {
      setErr('記録の送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return          // フォーム送信の二重防止

    if (isDuplicate(date, projectId)) {
      const proj = MOCK_PROJECTS.find(p => p.id === projectId)
      pendingSubmitRef.current = doSubmit
      setDupModal({ date, projectName: proj?.name ?? '' })
      return
    }
    doSubmit()
  }

  function confirmDuplicate() {
    setDupModal(null)
    pendingSubmitRef.current?.()
    pendingSubmitRef.current = null
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
        <h3 className="text-sm font-bold text-zinc-800">勤務実績の記録</h3>

        <div className="grid grid-cols-2 gap-3">
          {/* 日付 */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">日付</label>
            <input
              type="date"
              value={date}
              min={`${yearMonth}-01`}
              max={`${yearMonth}-31`}
              onChange={e => setDate(e.target.value)}
              required
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
            />
          </div>

          {/* 案件 */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">案件</label>
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500"
            >
              {MOCK_PROJECTS.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* メモ */}
          <div className="col-span-2">
            <label className="block text-xs text-zinc-500 mb-1">メモ（任意）</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="特記事項など"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
            />
          </div>
        </div>

        {/* 重複インジケータ */}
        {isDuplicate(date, projectId) && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
            <span>⚠️</span>
            <span>この日付・案件の記録がすでに存在します（送信時に確認します）</span>
          </div>
        )}

        {err && <p className="text-xs text-red-600">{err}</p>}
        {ok  && <p className="text-xs text-emerald-600">✅ 記録しました</p>}

        {/* 記録ボタン — 連打防止: submitting=true で即 disabled */}
        <button
          type="submit"
          disabled={submitting}
          className={`
            w-full rounded-xl py-3.5 text-sm font-bold transition-all
            ${submitting
              ? 'bg-zinc-300 text-zinc-500 cursor-not-allowed'
              : 'bg-zinc-900 hover:bg-zinc-700 active:bg-zinc-800 text-white'
            }
          `}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              送信中…
            </span>
          ) : '記録する'}
        </button>
      </form>

      {/* 重複確認モーダル */}
      {dupModal && (
        <DuplicateModal
          date={dupModal.date}
          projectName={dupModal.projectName}
          onConfirm={confirmDuplicate}
          onCancel={() => { setDupModal(null); pendingSubmitRef.current = null }}
        />
      )}
    </>
  )
}

// ================================================================
// ScheduleCalendar（メインコンポーネント）
// ================================================================
export default function ScheduleCalendar() {
  const [yearMonth, setYearMonth]     = useState(currentYearMonth)
  const [schedules, setSchedules]     = useState<ScheduleMap>(new Map())
  const [workRecords, setWorkRecords] = useState<WorkRecord[]>([])
  const [loadErr, setLoadErr]         = useState<string | null>(null)
  const [loadingCal, setLoadingCal]   = useState(true)
  const [isPending, startTransition]  = useTransition()

  // コピーボタン専用ローディング
  const [copying, setCopying] = useState(false)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)

  const today = todayISO()

  // ── データ読み込み ─────────────────────────────────────────
  const load = useCallback(async (ym: string) => {
    setLoadingCal(true)
    setLoadErr(null)
    try {
      const [sched, recs] = await Promise.all([
        mockFetchSchedules(ym),
        mockFetchWorkRecords(ym),
      ])
      setSchedules(sched)
      setWorkRecords(recs)
    } catch {
      setLoadErr('予定データの読み込みに失敗しました')
    } finally {
      setLoadingCal(false)
    }
  }, [])

  useEffect(() => { load(yearMonth) }, [load, yearMonth])

  // ── 日付セルタップ（scheduled → absent → clear → scheduled） ──
  function handleDayTap(date: string) {
    const current = schedules.get(date)
    const next: ScheduleStatus | null =
      current === 'scheduled' ? 'absent'
      : current === 'absent'  ? null
      : 'scheduled'

    // 楽観的UI更新
    setSchedules(prev => {
      const m = new Map(prev)
      if (next === null) m.delete(date)
      else m.set(date, next)
      return m
    })

    // バックグラウンドで保存（startTransitionでisPendingを制御）
    startTransition(async () => {
      try {
        await mockUpsertSchedule(date, next)
      } catch {
        // 失敗時はロールバック
        setSchedules(prev => {
          const m = new Map(prev)
          if (current === undefined) m.delete(date)
          else m.set(date, current)
          return m
        })
        setLoadErr('予定の保存に失敗しました')
      }
    })
  }

  // ── 前月コピー ─────────────────────────────────────────────
  async function handleCopyPrevMonth() {
    if (copying) return
    const from = prevYearMonth(yearMonth)
    setCopying(true)
    setCopyMsg(null)
    try {
      const count = await mockCopyPrevMonth(from, yearMonth)
      setCopyMsg(`${from} の予定を ${count} 件コピーしました`)
      await load(yearMonth)
    } catch {
      setCopyMsg('コピーに失敗しました')
    } finally {
      setCopying(false)
      setTimeout(() => setCopyMsg(null), 4000)
    }
  }

  // ── カレンダーグリッド構築 ─────────────────────────────────
  const cells = buildCalendarDays(yearMonth)
  const [y, m] = yearMonth.split('-').map(Number)

  return (
    <div className="space-y-6">

      {/* ヘッダー：月選択 + コピーボタン */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const d = new Date(y, m - 2, 1)
              setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
            }}
            className="h-8 w-8 flex items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 transition text-sm"
            aria-label="前の月"
          >
            ‹
          </button>
          <h2 className="text-base font-bold text-zinc-900 tabular-nums min-w-[90px] text-center">
            {y}年{m}月
          </h2>
          <button
            type="button"
            onClick={() => {
              const d = new Date(y, m, 1)
              setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
            }}
            className="h-8 w-8 flex items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 transition text-sm"
            aria-label="次の月"
          >
            ›
          </button>
        </div>

        {/* 前月コピーボタン — 連打防止: copying=true で即 disabled */}
        <button
          type="button"
          onClick={handleCopyPrevMonth}
          disabled={copying || isPending || loadingCal}
          className={`
            flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition
            ${copying
              ? 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed'
              : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
            }
          `}
        >
          {copying ? (
            <>
              <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              コピー中…
            </>
          ) : (
            <>📋 前月の予定をコピー</>
          )}
        </button>
      </div>

      {/* コピー結果メッセージ */}
      {copyMsg && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
          {copyMsg}
        </div>
      )}

      {/* エラー */}
      {loadErr && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
          {loadErr}
        </div>
      )}

      {/* カレンダー本体 */}
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 sm:p-4">
        {/* 曜日ヘッダー */}
        <div className="grid grid-cols-7 mb-2">
          {DAY_HEADERS.map((h, i) => (
            <div
              key={h}
              className={`text-center text-[10px] font-semibold py-1 ${
                i === 0 ? 'text-rose-400' : i === 6 ? 'text-blue-400' : 'text-zinc-400'
              }`}
            >
              {h}
            </div>
          ))}
        </div>

        {/* 日付グリッド */}
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
                  status={schedules.get(date)}
                  isToday={date === today}
                  isSunday={i % 7 === 0}
                  isSaturday={i % 7 === 6}
                  isPending={isPending}
                  onTap={handleDayTap}
                />
              )
            )}
          </div>
        )}

        {/* 凡例 */}
        <div className="mt-3 pt-3 border-t border-zinc-200">
          <Legend />
        </div>
      </div>

      {/* サマリー */}
      {!loadingCal && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '稼働予定', value: [...schedules.values()].filter(s => s === 'scheduled').length, color: 'text-blue-600' },
            { label: '休み予定', value: [...schedules.values()].filter(s => s === 'absent').length,    color: 'text-zinc-400' },
            { label: '記録済み', value: workRecords.length, color: 'text-emerald-600' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-zinc-200 bg-white px-3 py-3 text-center">
              <p className="text-xs text-zinc-500 mb-1">{s.label}</p>
              <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 勤務実績記録フォーム */}
      <div className="mt-2">
        <WorkRecordForm
          yearMonth={yearMonth}
          workRecords={workRecords}
          onSubmitted={rec => setWorkRecords(prev => [...prev, rec])}
        />
      </div>
    </div>
  )
}
