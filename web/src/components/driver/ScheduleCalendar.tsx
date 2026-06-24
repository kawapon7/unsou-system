'use client'

import { useState, useTransition, useCallback, useEffect, useRef, useMemo } from 'react'
import HolidayJp from '@holiday-jp/holiday_jp'
import {
  fetchSchedules,
  upsertSchedule,
  bulkUpsertSchedules,
  deleteSchedule,
  copyPrevMonthSchedules,
  fetchDriverProjectOptions,
  fetchMyWorkedDates,
  type ScheduleStatus,
} from '@/app/_actions/scheduleActions'
import { submitWorkRecord, submitOffMasterReport } from '@/app/_actions/workRecordActions'
import { submitExpense } from '@/app/driver/dashboard/actions'

// ── 型定義 ──────────────────────────────────────────────────────

type ScheduleEntry = { id: string; status: ScheduleStatus; projectId: string }
type ScheduleMap   = Map<string, ScheduleEntry>   // key: 'YYYY-MM-DD'
type ProjectOption = { id: string; name: string }

type BottomSheet =
  | { type: 'complete';  date: string; entry: ScheduleEntry }
  | { type: 'schedule';  date: string }
  | { type: 'bulk';      dates: string[] }
  | { type: 'offmaster'; date: string }
  | null

type ExpenseFormItem = {
  key: string
  expenseType: string
  amount: string
  remarks: string
}

const EXPENSE_TYPES = [
  { value: 'toll',    label: '高速' },
  { value: 'parking', label: '駐車場' },
  { value: 'fuel',    label: '燃料費' },
  { value: 'other',   label: 'その他' },
] as const

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

/** 指定月の祝日を Map<'YYYY-MM-DD', 祝日名> で返す */
function buildHolidayMap(yearMonth: string): Map<string, string> {
  const [y, m] = yearMonth.split('-').map(Number)
  const from = new Date(y, m - 1, 1)
  const to   = new Date(y, m, 0)
  const holidays = HolidayJp.between(from, to)
  const map = new Map<string, string>()
  for (const h of holidays) {
    const d = h.date
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    map.set(key, h.name)
  }
  return map
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
  date, entry, projectName, isToday, isSunday, isSaturday, isHoliday, holidayName,
  isWorked, isPending, isSelected, multiMode, onTap,
}: {
  date: string
  entry: ScheduleEntry | undefined
  projectName?: string
  isToday: boolean
  isSunday: boolean
  isSaturday: boolean
  isHoliday: boolean
  holidayName?: string
  isWorked: boolean
  isPending: boolean
  isSelected: boolean
  multiMode: boolean
  onTap: (date: string) => void
}) {
  const day = parseInt(date.split('-')[2], 10)

  // ── タッチ操作
  //   SP: 短タップ → ツールチップ表示（空白セル or 複数選択モードは直接 onTap）
  //       長押し(500ms) → onTap（編集シート）
  //   PC: hover → ツールチップ（CSS）/ click → onTap（編集シート）
  const [showTip, setShowTip]     = useState(false)
  const actionTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPress = useRef(false)

  const hasTip = !!(projectName || isWorked || entry)
  // 空白セル or 複数選択モードはタップで直接 onTap（確認ステップ不要）
  const tapDirectly = !hasTip || multiMode

  function handleTouchStart() {
    didLongPress.current = false
    if (tapDirectly) return  // 長押し判定不要
    actionTimer.current = setTimeout(() => {
      didLongPress.current = true
      if (!isPending) onTap(date)
    }, 500)
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (actionTimer.current) {
      clearTimeout(actionTimer.current)
      actionTimer.current = null
    }
    if (didLongPress.current) {
      // 長押しで onTap 済み → click イベントをキャンセルするだけ
      e.preventDefault()
      return
    }
    if (tapDirectly) return  // onClick に委譲
    // 短タップ → ツールチップ表示
    e.preventDefault()  // click イベントをキャンセル
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current)
    setShowTip(true)
    autoHideTimer.current = setTimeout(() => setShowTip(false), 2500)
  }

  function handleTouchMove() {
    if (actionTimer.current) {
      clearTimeout(actionTimer.current)
      actionTimer.current = null
    }
  }

  function clearTip() {
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current)
    setShowTip(false)
  }

  // ── セル色・バッジ（isSelected を最優先で評価） ──────────────
  let bg        = 'bg-white'
  let textColor = (isSunday || isHoliday) ? 'text-rose-500' : isSaturday ? 'text-blue-500' : 'text-zinc-800'
  let badge: React.ReactNode = null

  if (isSelected) {
    // 複数選択でチェック済み（最優先）
    bg        = 'bg-blue-600'
    textColor = 'text-white'
    badge     = <span className="block text-[8px] font-bold">✓</span>
  } else if (isWorked) {
    bg        = 'bg-emerald-500'
    textColor = 'text-white'
    badge     = <span className="block text-[8px] font-bold">完了</span>
  } else if (entry?.status === 'scheduled') {
    bg        = 'bg-blue-500'
    textColor = 'text-white'
    badge     = <span className="block text-[8px] font-bold">予定</span>
  } else if (entry?.status === 'absent') {
    bg        = 'bg-zinc-200'
    textColor = 'text-zinc-400'
    badge     = <span className="block text-[8px]">休み</span>
  }

  const selectableInMulti = multiMode && !isWorked
  // ring クラスは isSelected / isToday で排他的に設定（競合防止）
  const ringCls = isSelected
    ? 'ring-2 ring-offset-1 ring-blue-400'
    : isToday
      ? 'ring-2 ring-offset-1 ring-zinc-900'
      : ''

  // ── ツールチップ文言 ─────────────────────────────────────────
  const statusLabel = isWorked
    ? '✅ 完了'
    : entry?.status === 'scheduled'
      ? '📅 稼働予定'
      : entry?.status === 'absent'
        ? '💤 休み'
        : null
  const tipText = [holidayName, projectName, statusLabel].filter(Boolean).join('　')

  // ── 表示位置（週の後半は左寄せ、前半は右寄せで画面外を防ぐ） ─
  // i % 7 が不明なので、左右は中央配置 + transform で対応
  const tipAlign = 'left-1/2 -translate-x-1/2'

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => !isPending && onTap(date)}
        disabled={isPending || (multiMode && isWorked)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        className={`
          aspect-square w-full rounded-lg flex flex-col items-center justify-center gap-0.5
          text-xs font-semibold transition-transform active:scale-95 select-none
          ${bg} ${textColor} ${ringCls}
          ${selectableInMulti && !isSelected ? 'opacity-80 hover:opacity-100' : ''}
          disabled:opacity-40
        `}
      >
        <span>{day}</span>
        {isHoliday && !badge && (
          <span className="block text-[7px] leading-none text-rose-400 font-normal truncate w-full text-center px-0.5">祝</span>
        )}
        {badge}
      </button>

      {/* ツールチップ（デスクトップ: hover / スマホ: 長押し） */}
      {hasTip && tipText && (
        <div
          className={`
            absolute z-50 bottom-[calc(100%+6px)] ${tipAlign}
            whitespace-nowrap rounded-lg bg-zinc-900/95 px-2.5 py-1.5
            text-[11px] font-medium text-white shadow-lg
            transition-all duration-150 cursor-default
            pointer-events-none opacity-0 scale-95
            group-hover:pointer-events-auto group-hover:opacity-100 group-hover:scale-100
            ${showTip ? '!pointer-events-auto !opacity-100 !scale-100' : ''}
          `}
          onTouchStart={e => { e.stopPropagation(); clearTip() }}
        >
          {tipText}
          {/* 下向き三角 */}
          <span className="absolute left-1/2 -translate-x-1/2 top-full
            border-4 border-transparent border-t-zinc-900/95" />
        </div>
      )}
    </div>
  )
}

// ── 完了報告フォーム（実績＋立替金一体型） ─────────────────────

function newExpenseRow(): ExpenseFormItem {
  return { key: Math.random().toString(36).slice(2), expenseType: 'toll', amount: '', remarks: '' }
}

function CompletionFormSheet({
  date, entry, projectName, contractorId, onDone, onClose,
}: {
  date: string
  entry: ScheduleEntry
  projectName: string
  contractorId?: string
  onDone: (date: string) => void
  onClose: () => void
}) {
  const [submitting,  setSubmitting]  = useState(false)
  const [pieceCount,  setPieceCount]  = useState('')
  const [note,        setNote]        = useState('')
  const [startMeter,  setStartMeter]  = useState('')
  const [endMeter,    setEndMeter]    = useState('')
  const [expenses,    setExpenses]    = useState<ExpenseFormItem[]>([newExpenseRow()])
  const [offJobs,     setOffJobs]     = useState<string[]>([''])
  const [forceMode,   setForceMode]   = useState(false)
  const [confirming,  setConfirming]  = useState(false)
  const [errMsg,      setErrMsg]      = useState<string | null>(null)

  // ── 立替金操作 ──────────────────────────────────────
  function addExpense() {
    setExpenses(prev => [...prev, newExpenseRow()])
  }
  function removeExpense(key: string) {
    setExpenses(prev => prev.filter(e => e.key !== key))
  }
  function updateExpense(key: string, field: keyof Omit<ExpenseFormItem, 'key'>, value: string) {
    setExpenses(prev => prev.map(e => e.key === key ? { ...e, [field]: value } : e))
  }

  // ── 突発案件行操作 ──────────────────────────────────
  function addOffJob() {
    setOffJobs(prev => [...prev, ''])
  }
  function removeOffJob(i: number) {
    setOffJobs(prev => prev.filter((_, idx) => idx !== i))
  }
  function updateOffJob(i: number, value: string) {
    setOffJobs(prev => prev.map((v, idx) => idx === i ? value : v))
  }

  // ── 送信 ────────────────────────────────────────────
  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    setErrMsg(null)

    // メーターをnoteに付加
    const meterText = (startMeter || endMeter)
      ? `[メーター: ${startMeter || '?'}→${endMeter || '?'}km]`
      : ''
    const fullNote = [meterText, note.trim()].filter(Boolean).join(' ') || undefined

    const res = await submitWorkRecord(
      { projectId: entry.projectId, date, pieceCount: pieceCount ? parseInt(pieceCount, 10) : undefined, note: fullNote },
      { force: forceMode },
    )

    if (res.error === 'DUPLICATE_EXISTS') {
      setForceMode(true)
      setConfirming(false)
      setErrMsg('この日付にはすでに実績が登録されています。下の「完了報告する」で上書き登録できます。')
      setSubmitting(false)
      return
    }
    if (res.error) {
      setConfirming(false)
      setErrMsg(`エラー: ${res.error}`)
      setSubmitting(false)
      return
    }

    // 突発案件（ベストエフォート）
    for (const jobName of offJobs) {
      if (jobName.trim()) {
        await submitOffMasterReport({ date, jobName: jobName.trim() })
      }
    }

    // 立替金（ベストエフォート）
    if (contractorId) {
      for (const exp of expenses) {
        const amount = parseInt(exp.amount, 10)
        if (!isNaN(amount) && amount > 0) {
          await submitExpense({ contractorId, expenseDate: date, expenseType: exp.expenseType, amountActual: amount, remarks: exp.remarks.trim() })
        }
      }
    }

    setSubmitting(false)
    onDone(date)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-sm rounded-t-2xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

        {/* ヘッダ */}
        <div className="px-5 pt-5 pb-3 flex-shrink-0">
          <p className="text-xs text-zinc-400 tabular-nums">{date}</p>
          <h3 className="text-base font-bold text-zinc-900 mt-0.5">{projectName}</h3>
        </div>

        {/* スクロールエリア */}
        <div className="overflow-y-auto flex-1 px-5 py-2 space-y-5">

          {/* 稼働実績 */}
          <section>
            <p className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wider">稼働実績</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">個数・件数（任意）</label>
                <input type="number" min="0" value={pieceCount} onChange={e => setPieceCount(e.target.value)}
                  placeholder="例: 50"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">メモ（任意）</label>
                <input type="text" value={note} onChange={e => setNote(e.target.value)}
                  placeholder="特記事項など"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">開始メーター（任意）</label>
                <div className="relative">
                  <input type="number" min="0" value={startMeter} onChange={e => setStartMeter(e.target.value)}
                    placeholder="例: 12345"
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 pr-7 text-sm outline-none focus:border-zinc-500" />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400">km</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">終了メーター（任意）</label>
                <div className="relative">
                  <input type="number" min="0" value={endMeter} onChange={e => setEndMeter(e.target.value)}
                    placeholder="例: 12890"
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 pr-7 text-sm outline-none focus:border-zinc-500" />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400">km</span>
                </div>
              </div>
            </div>
          </section>

          {/* 突発案件 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">突発案件（任意）</p>
              <button type="button" onClick={addOffJob}
                className="text-xs text-rose-600 font-semibold hover:text-rose-700">
                ＋ 追加
              </button>
            </div>
            <div className="space-y-2">
              {offJobs.map((job, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                  <input type="text" value={job} onChange={e => updateOffJob(i, e.target.value)}
                    placeholder="案件名（例：○○配送）"
                    className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-xs outline-none focus:border-zinc-500 min-w-0" />
                  {offJobs.length > 1 && (
                    <button type="button" onClick={() => removeOffJob(i)}
                      className="shrink-0 text-zinc-400 hover:text-red-500 text-lg leading-none">×</button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-zinc-400 mt-1.5">入力した場合は管理者へ通知されます</p>
          </section>

          {/* 立替金 */}
          <section>
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">立替金（任意）</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">高速代・駐車場・燃料費など業務で立て替えた費用</p>
              </div>
              <button type="button" onClick={addExpense}
                className="text-xs text-blue-600 font-semibold hover:text-blue-700 shrink-0 ml-2">
                ＋ 追加
              </button>
            </div>
            <div className="space-y-3 mt-2">
              {expenses.map((exp, idx) => (
                <div key={exp.key} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-zinc-400">立替金 {idx + 1}</span>
                    <button type="button" onClick={() => removeExpense(exp.key)}
                      className="text-[10px] text-zinc-400 hover:text-red-500 font-medium">削除</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-zinc-500 mb-1 font-medium">種別</label>
                      <select value={exp.expenseType} onChange={e => updateExpense(exp.key, 'expenseType', e.target.value)}
                        className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-800 outline-none focus:border-zinc-500">
                        {EXPENSE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-500 mb-1 font-medium">金額（税込・円）</label>
                      <input type="number" min="1" value={exp.amount}
                        onChange={e => updateExpense(exp.key, 'amount', e.target.value)}
                        placeholder="例: 1500"
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-zinc-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1 font-medium">備考（任意）</label>
                    <input type="text" value={exp.remarks}
                      onChange={e => updateExpense(exp.key, 'remarks', e.target.value)}
                      placeholder="例: 〇〇IC→△△IC、領収書あり"
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-zinc-500" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {errMsg && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-700 font-medium">
              {errMsg}
            </div>
          )}
        </div>

        {/* 確認ダイアログ（インライン） */}
        {confirming && (
          <div className="absolute inset-0 z-10 flex flex-col bg-white rounded-t-2xl">
            <div className="px-5 pt-6 pb-4 flex-1 overflow-y-auto">
              <p className="text-base font-bold text-zinc-900 mb-1">内容を確認してください</p>
              <p className="text-xs text-zinc-500 mb-4">以下の内容で完了報告を送信します。よろしいですか？</p>

              <div className="space-y-3 text-sm">
                {/* 案件 */}
                <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-4 py-3">
                  <p className="text-[10px] font-semibold text-zinc-400 mb-1">案件</p>
                  <p className="font-medium text-zinc-800">{projectName}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{date}</p>
                </div>

                {/* 稼働実績 */}
                <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-4 py-3 space-y-1">
                  <p className="text-[10px] font-semibold text-zinc-400 mb-1">稼働実績</p>
                  <div className="flex justify-between text-xs text-zinc-600">
                    <span>個数・件数</span>
                    <span className="font-medium text-zinc-800">{pieceCount || '未入力'}</span>
                  </div>
                  {(startMeter || endMeter) && (
                    <div className="flex justify-between text-xs text-zinc-600">
                      <span>メーター</span>
                      <span className="font-medium text-zinc-800">{startMeter || '?'} → {endMeter || '?'} km</span>
                    </div>
                  )}
                  {note && (
                    <div className="flex justify-between text-xs text-zinc-600">
                      <span>メモ</span>
                      <span className="font-medium text-zinc-800">{note}</span>
                    </div>
                  )}
                </div>

                {/* 突発案件 */}
                {offJobs.some(j => j.trim()) && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3">
                    <p className="text-[10px] font-semibold text-rose-400 mb-1">突発案件</p>
                    {offJobs.filter(j => j.trim()).map((j, i) => (
                      <p key={i} className="text-xs text-zinc-800 font-medium">{j}</p>
                    ))}
                  </div>
                )}

                {/* 立替金 */}
                {expenses.some(e => parseInt(e.amount) > 0) && (
                  <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 space-y-1">
                    <p className="text-[10px] font-semibold text-blue-400 mb-1">立替金</p>
                    {expenses.filter(e => parseInt(e.amount) > 0).map(e => (
                      <div key={e.key} className="flex justify-between text-xs text-zinc-700">
                        <span>{EXPENSE_TYPES.find(t => t.value === e.expenseType)?.label}{e.remarks ? `（${e.remarks}）` : ''}</span>
                        <span className="font-medium">¥{Number(e.amount).toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="border-t border-blue-200 mt-1.5 pt-1.5 flex justify-between text-xs font-bold text-zinc-800">
                      <span>合計</span>
                      <span>¥{expenses.reduce((sum, e) => sum + (parseInt(e.amount) || 0), 0).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 pb-6 pt-3 space-y-3 border-t border-zinc-100">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full rounded-xl bg-emerald-600 py-4 text-sm font-bold text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition"
              >
                {submitting ? '送信中…' : forceMode ? '⚠️ 上書きして送信する' : '✅ この内容で送信する'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={submitting}
                className="w-full rounded-xl border border-zinc-300 py-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-50 transition"
              >
                ← 戻って修正する
              </button>
            </div>
          </div>
        )}

        {/* フッタ */}
        <div className="px-5 pb-6 pt-3 space-y-3 flex-shrink-0 border-t border-zinc-100">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={submitting}
            className="w-full rounded-xl bg-emerald-600 py-4 text-sm font-bold text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition"
          >
            {forceMode ? '⚠️ 上書きして完了報告する' : '✅ 完了報告する'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 案件選択シート（単一日付 / 複数日付一括 両対応） ───────────────

function ScheduleSelectSheet({
  dates,
  projects,
  onSchedule,
  onAbsent,
  onOffMaster,
  onClose,
  onBackToCalendar,
  submitting,
}: {
  dates:              string[]
  projects:           ProjectOption[]
  onSchedule:         (projectId: string) => void
  onAbsent?:          () => void
  onOffMaster?:       () => void
  onClose:            () => void
  onBackToCalendar?:  () => void   // 確認画面から「← 戻る」でカレンダーに戻る
  submitting:         boolean
}) {
  const [selected, setSelected] = useState<string>(projects[0]?.id ?? '')
  // 一括時のみ確認ステップを挟む: null = 選択中, 'schedule' | 'absent' = 確認中
  const [confirmAction, setConfirmAction] = useState<'schedule' | 'absent' | null>(null)
  const isBulk = dates.length > 1

  const selectedProjectName = projects.find(p => p.id === selected)?.name ?? ''

  // 確認画面から戻る（カレンダー優先、なければ選択画面）
  function backToSelect() {
    if (onBackToCalendar) onBackToCalendar()
    else setConfirmAction(null)
  }

  // 確認後に実行
  function confirmAndExecute() {
    if (confirmAction === 'schedule') onSchedule(selected)
    else if (confirmAction === 'absent' && onAbsent) onAbsent()
  }

  // 一括の場合は確認ステップを挟む、単日はそのまま実行
  function handleScheduleClick() {
    if (!selected) return
    if (isBulk) setConfirmAction('schedule')
    else onSchedule(selected)
  }
  function handleAbsentClick() {
    if (isBulk) setConfirmAction('absent')
    else onAbsent?.()
  }

  const dateLabel = isBulk ? `${dates.length}日分を一括登録` : dates[0] ?? ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-t-2xl bg-white shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">

        {/* ── 確認画面（一括時のみ） ── */}
        {confirmAction && (
          <>
            <div className="px-5 pt-5 pb-3 flex-shrink-0">
              <p className="text-xs text-zinc-400 tabular-nums">{dates.length}日分</p>
              <h3 className="text-base font-bold text-zinc-900 mt-0.5">登録内容の確認</h3>
            </div>
            <div className="px-5 flex-1 overflow-y-auto space-y-3 pb-2">
              {/* 登録内容サマリ */}
              <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-4 py-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">種別</span>
                  <span className="font-semibold text-zinc-900">
                    {confirmAction === 'schedule' ? '📅 稼働予定' : '💤 休み'}
                  </span>
                </div>
                {confirmAction === 'schedule' && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">案件</span>
                    <span className="font-semibold text-zinc-900">{selectedProjectName}</span>
                  </div>
                )}
                <div className="flex justify-between items-start">
                  <span className="text-zinc-500">対象日</span>
                  <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                    {dates.map(d => (
                      <span key={d} className="rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium px-2 py-0.5 tabular-nums">
                        {d.slice(5).replace('-', '/')}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-xs text-zinc-400 text-center">既存の予定がある日付は上書きされます</p>
            </div>
            <div className="px-5 pb-6 pt-3 space-y-2 flex-shrink-0 border-t border-zinc-100">
              <button
                type="button"
                onClick={confirmAndExecute}
                disabled={submitting}
                className="w-full rounded-xl bg-blue-600 py-4 text-sm font-bold text-white hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 transition"
              >
                {submitting ? '登録中…' : `✅ ${dates.length}日分を確定する`}
              </button>
              <button
                type="button"
                onClick={backToSelect}
                disabled={submitting}
                className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 text-sm font-medium text-zinc-500 hover:bg-zinc-50 disabled:opacity-50"
              >
                ← 戻る
              </button>
            </div>
          </>
        )}

        {/* ── 選択画面 ── */}
        {!confirmAction && (
          <>
            <div className="px-5 pt-5 pb-3 flex-shrink-0">
              <p className="text-xs text-zinc-400 tabular-nums">{dateLabel}</p>
              <h3 className="text-base font-bold text-zinc-900 mt-0.5">
                {isBulk ? '一括で予定を登録' : 'この日の予定を登録'}
              </h3>
              {isBulk && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {dates.map(d => (
                    <span key={d} className="rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium px-2 py-0.5 tabular-nums">
                      {d.slice(5).replace('-', '/')}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {projects.length === 0 ? (
              <div className="px-5 pb-4 flex-shrink-0">
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700 font-medium">
                  ⚠ 担当案件が登録されていません。管理者にご確認ください。
                </div>
              </div>
            ) : (
              <>
                <p className="px-5 text-xs font-semibold text-zinc-500 mb-2 flex-shrink-0">稼働案件を選択</p>
                <div className="overflow-y-auto flex-1 px-5 space-y-1.5 pb-2">
                  {projects.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelected(p.id)}
                      className={`w-full text-left rounded-xl border px-4 py-3 text-sm font-medium transition ${
                        selected === p.id
                          ? 'border-blue-400 bg-blue-50 text-blue-700'
                          : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 active:bg-zinc-100'
                      }`}
                    >
                      <span className={`inline-block w-4 mr-1.5 text-center ${selected === p.id ? 'text-blue-500' : 'text-transparent'}`}>✓</span>
                      {p.name}
                    </button>
                  ))}
                </div>
                <div className="px-5 pt-2 pb-3 flex-shrink-0">
                  <button
                    type="button"
                    onClick={handleScheduleClick}
                    disabled={!selected || submitting}
                    className="w-full rounded-xl bg-blue-600 py-4 text-sm font-bold text-white hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {submitting
                      ? '登録中…'
                      : isBulk
                        ? `📅 ${dates.length}日分をまとめて登録`
                        : '📅 この案件で予定登録'}
                  </button>
                </div>
              </>
            )}

            <div className="px-5 pb-6 pt-2 space-y-2 flex-shrink-0 border-t border-zinc-100">
              {onAbsent && (
                <button type="button" onClick={handleAbsentClick} disabled={submitting}
                  className="w-full rounded-xl bg-zinc-100 border border-zinc-200 py-3 text-sm font-bold text-zinc-700 hover:bg-zinc-200 active:bg-zinc-300 disabled:opacity-50 transition">
                  {isBulk ? `💤 ${dates.length}日分を休みとして登録` : '💤 休みとして登録'}
                </button>
              )}
              {onOffMaster && (
                <button type="button" onClick={onOffMaster} disabled={submitting}
                  className="w-full rounded-xl bg-rose-50 border border-rose-200 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50 transition">
                  📣 突発案件を報告
                </button>
              )}
              <button type="button" onClick={onClose}
                className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 text-sm font-medium text-zinc-500 hover:bg-zinc-50">
                キャンセル
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── 突発案件報告ボトムシート ─────────────────────────────────────

function OffMasterSheet({
  date, onSubmit, onClose, submitting,
}: {
  date: string; onSubmit: (jobName: string) => void; onClose: () => void; submitting: boolean
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

export default function ScheduleCalendar({ contractorId }: { contractorId?: string }) {
  const [yearMonth,   setYearMonth]   = useState(currentYearMonth)
  const [schedules,   setSchedules]   = useState<ScheduleMap>(new Map())
  const [workedDates, setWorkedDates] = useState<string[]>([])
  const [projects,    setProjects]    = useState<ProjectOption[]>([])
  const [loadErr,     setLoadErr]     = useState<string | null>(null)
  const [loadingCal,  setLoadingCal]  = useState(true)
  const [isPending,   startTransition] = useTransition()

  const [bottomSheet, setBottomSheet] = useState<BottomSheet>(null)
  const [submitting,  setSubmitting]  = useState(false)
  const [submitMsg,   setSubmitMsg]   = useState<{ text: string; ok: boolean } | null>(null)

  const [copying, setCopying] = useState(false)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)

  // 複数選択モード
  const [multiMode,    setMultiMode]    = useState(false)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())

  const today = todayISO()

  useEffect(() => {
    fetchDriverProjectOptions().then(res => {
      if (res.data) setProjects(res.data)
    }).catch(() => {})
  }, [])

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

  async function handleScheduleFromSheet(dates: string[], projectId: string) {
    if (submitting) return
    setSubmitting(true)

    // 楽観的更新
    setSchedules(p => {
      const m = new Map(p)
      dates.forEach(d => m.set(d, { id: '', status: 'scheduled', projectId }))
      return m
    })

    const res = dates.length === 1
      ? await upsertSchedule({ projectId, date: dates[0], status: 'scheduled' })
          .then(r => r.error ? r : { data: { ids: [r.data!.id], count: 1 }, error: null })
      : await bulkUpsertSchedules({ dates, projectId, status: 'scheduled' })

    setSubmitting(false)

    if (res.error) {
      // ロールバック
      setSchedules(p => {
        const m = new Map(p)
        dates.forEach(d => m.delete(d))
        return m
      })
      setSubmitMsg({ text: `エラー: ${res.error}`, ok: false })
    } else {
      const name = projects.find(p => p.id === projectId)?.name ?? '案件'
      setSubmitMsg({
        text: dates.length > 1
          ? `${name} を ${dates.length} 日分まとめて登録しました`
          : `${name} を予定に登録しました`,
        ok: true,
      })
      setTimeout(() => setSubmitMsg(null), 3500)
    }

    // 複数選択モードを解除
    setMultiMode(false)
    setSelectedDates(new Set())
    setBottomSheet(null)
  }

  function handleDayTap(date: string) {
    if (workedDates.includes(date)) return
    const entry = schedules.get(date)

    // ── 複数選択モード ──────────────────────────────────────
    if (multiMode) {
      setSelectedDates(prev => {
        const next = new Set(prev)
        if (next.has(date)) next.delete(date)
        else next.add(date)
        return next
      })
      return
    }

    // ── 通常モード ──────────────────────────────────────────
    if (entry?.status === 'scheduled') {
      setBottomSheet({ type: 'complete', date, entry })
    } else if (!entry) {
      setBottomSheet({ type: 'schedule', date })
    } else {
      // absent → 休み取り消し
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

  function exitMultiMode() {
    setMultiMode(false)
    setSelectedDates(new Set())
  }

  async function handleAbsent(date: string) {
    await handleAbsentFromSheet([date])
  }

  async function handleAbsentFromSheet(dates: string[]) {
    if (submitting) return
    setSubmitting(true)
    // 楽観的更新
    setSchedules(p => {
      const m = new Map(p)
      dates.forEach(d => m.set(d, { id: '', status: 'absent', projectId: '' }))
      return m
    })
    const res = dates.length === 1
      ? await upsertSchedule({ projectId: null, date: dates[0], status: 'absent' })
          .then(r => r.error ? r : { data: { ids: [r.data!.id], count: 1 }, error: null })
      : await bulkUpsertSchedules({ dates, projectId: null, status: 'absent' })
    setSubmitting(false)
    if (res.error) {
      setSchedules(p => { const m = new Map(p); dates.forEach(d => m.delete(d)); return m })
      setSubmitMsg({ text: `エラー: ${res.error}`, ok: false })
    } else {
      setSubmitMsg({
        text: dates.length > 1 ? `${dates.length} 日分を休みとして登録しました` : '休みとして登録しました',
        ok: true,
      })
      setTimeout(() => setSubmitMsg(null), 3000)
    }
    setMultiMode(false)
    setSelectedDates(new Set())
    setBottomSheet(null)
  }

  function handleCompletionDone(date: string) {
    setWorkedDates(prev => [...new Set([...prev, date])])
    setSubmitMsg({ text: '完了を報告しました', ok: true })
    setBottomSheet(null)
    setTimeout(() => setSubmitMsg(null), 3500)
  }

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
    setTimeout(() => setSubmitMsg(null), 3500)
  }

  async function handleCopyPrevMonth() {
    if (copying) return
    const fromYM = prevYearMonth(yearMonth)
    setCopying(true)
    setCopyMsg(null)
    const res = await copyPrevMonthSchedules({ fromYearMonth: fromYM, toYearMonth: yearMonth })
    if (res.error) {
      setCopyMsg(`エラー: ${res.error}`)
    } else {
      const copied  = res.data?.copied  ?? 0
      const skipped = res.data?.skipped ?? 0
      if (copied === 0 && skipped === 0) {
        setCopyMsg(`${fromYM} にコピー元の予定がありません`)
      } else {
        const skipNote = skipped > 0 ? `（第5週など対応なし ${skipped} 件はスキップ）` : ''
        setCopyMsg(`${copied} 件を曜日ベースでコピーしました${skipNote}`)
      }
      await load(yearMonth)
    }
    setCopying(false)
    setTimeout(() => setCopyMsg(null), 4000)
  }

  const cells = buildCalendarDays(yearMonth)
  const [y, m] = yearMonth.split('-').map(Number)
  const holidayMap = useMemo(() => buildHolidayMap(yearMonth), [yearMonth])
  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? '案件'

  return (
    <div className="space-y-5">

      {/* ヘッダー */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              exitMultiMode()
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
              exitMultiMode()
              const d = new Date(y, m, 1)
              setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
            }}
            className="h-8 w-8 flex items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 text-sm"
          >›</button>
        </div>
        <div className="flex items-center gap-2 flex-1">
          <button
            type="button"
            onClick={() => multiMode ? exitMultiMode() : setMultiMode(true)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
              multiMode
                ? 'border-blue-400 bg-blue-600 text-white'
                : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            {multiMode ? '✕ 選択解除' : '☑ 複数選択'}
          </button>
          <button
            type="button"
            onClick={handleCopyPrevMonth}
            disabled={copying || isPending || loadingCal || multiMode}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition
              ${(copying || multiMode) ? 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed'
                        : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
          >
            {copying ? '…コピー中' : '📋 前月コピー'}
          </button>
        </div>
      </div>

      {/* サマリーカード（ヘッダー直下） */}
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

      <div className="mb-1">
        <Legend />
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
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 sm:p-4 overflow-visible">
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
                  projectName={projects.find(p => p.id === schedules.get(date)?.projectId)?.name}
                  isToday={date === today}
                  isSunday={i % 7 === 0}
                  isSaturday={i % 7 === 6}
                  isHoliday={holidayMap.has(date)}
                  holidayName={holidayMap.get(date)}
                  isWorked={workedDates.includes(date)}
                  isPending={isPending || submitting}
                  isSelected={selectedDates.has(date)}
                  multiMode={multiMode}
                  onTap={handleDayTap}
                />
              )
            )}
          </div>
        )}
      </div>

      {/* カレンダー下部ボタン（上部と同じ操作を下からも届くように） */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => multiMode ? exitMultiMode() : setMultiMode(true)}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium transition ${
            multiMode
              ? 'border-blue-400 bg-blue-600 text-white'
              : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
          }`}
        >
          {multiMode ? '✕ 選択解除' : '☑ 複数選択'}
        </button>
        <button
          type="button"
          onClick={handleCopyPrevMonth}
          disabled={copying || isPending || loadingCal || multiMode}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium transition ${
            (copying || multiMode)
              ? 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed'
              : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
          }`}
        >
          {copying ? '…コピー中' : '📋 前月コピー'}
        </button>
      </div>

      {/* 操作ガイド */}
      <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-xs text-zinc-500 space-y-1">
        <p className="font-semibold text-zinc-700">使い方</p>
        <p>• <span className="text-zinc-600 font-medium">空白</span>のセルをタップ → 案件を選んで稼働予定を登録</p>
        <p>• <span className="text-blue-600 font-medium">青（予定）</span>のセルをタップ → 実績・立替金を入力して完了報告</p>
        <p>• <span className="text-zinc-400 font-medium">休み</span>のセルをタップ → 休み取り消し</p>
        <p>• <span className="text-zinc-600 font-medium">☑ 複数選択</span>ボタン → 複数の日付を選んで一括登録</p>
      </div>

      {/* モーダル */}
      {bottomSheet?.type === 'complete' && (
        <CompletionFormSheet
          date={bottomSheet.date}
          entry={bottomSheet.entry}
          projectName={projectName(bottomSheet.entry.projectId)}
          contractorId={contractorId}
          onDone={handleCompletionDone}
          onClose={() => setBottomSheet(null)}
        />
      )}
      {bottomSheet?.type === 'schedule' && (
        <ScheduleSelectSheet
          dates={[bottomSheet.date]}
          projects={projects}
          onSchedule={projectId => handleScheduleFromSheet([bottomSheet.date], projectId)}
          onAbsent={() => handleAbsent(bottomSheet.date)}
          onOffMaster={() => setBottomSheet({ type: 'offmaster', date: bottomSheet.date })}
          onClose={() => setBottomSheet(null)}
          submitting={submitting}
        />
      )}
      {bottomSheet?.type === 'bulk' && (
        <ScheduleSelectSheet
          dates={bottomSheet.dates}
          projects={projects}
          onSchedule={projectId => handleScheduleFromSheet(bottomSheet.dates, projectId)}
          onAbsent={() => handleAbsentFromSheet(bottomSheet.dates)}
          onOffMaster={() => {
            setBottomSheet({ type: 'offmaster', date: bottomSheet.dates[0] })
          }}
          onClose={() => setBottomSheet(null)}
          onBackToCalendar={() => setBottomSheet(null)}
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

      {/* 複数選択モード：スティッキーアクションバー */}
      {multiMode && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-sm px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-zinc-900 shadow-2xl px-4 py-3">
            <span className="flex-1 text-sm font-semibold text-white">
              {selectedDates.size === 0
                ? '日付をタップして選択'
                : `${selectedDates.size}日 選択中`}
            </span>
            <button
              type="button"
              onClick={exitMultiMode}
              className="rounded-lg border border-zinc-600 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              キャンセル
            </button>
            <button
              type="button"
              disabled={selectedDates.size === 0}
              onClick={() => {
                if (selectedDates.size === 0) return
                setBottomSheet({ type: 'bulk', dates: Array.from(selectedDates).sort() })
              }}
              className="rounded-lg bg-blue-500 px-4 py-2 text-xs font-bold text-white hover:bg-blue-400 disabled:opacity-40 transition"
            >
              案件を選んで登録
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
