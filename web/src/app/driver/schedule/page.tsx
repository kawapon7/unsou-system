'use client'

import { useState, useEffect } from 'react'
import { fetchMyContractor } from '../dashboard/actions'
import { VoiceButton } from '@/components/voice/VoiceButton'
import ScheduleCalendar from '@/components/driver/ScheduleCalendar'
import UpcomingList from '@/components/driver/UpcomingList'
import WorkRecordList from '@/components/driver/WorkRecordList'

type View = 'calendar' | 'upcoming' | 'records'

const VIEWS: { key: View; label: string }[] = [
  { key: 'calendar', label: 'カレンダー' },
  { key: 'upcoming', label: '予定' },
  { key: 'records',  label: '実績' },
]

export default function DriverSchedulePage() {
  const [contractorId, setContractorId] = useState<string | undefined>(undefined)
  const [error,        setError]        = useState<string | null>(null)
  const [view,         setView]         = useState<View>('calendar')

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const cRes = await fetchMyContractor()
        if (cancelled) return
        if (cRes.error || !cRes.data) {
          setError(cRes.error ?? '委託先が見つかりません')
          return
        }
        setContractorId(cRes.data.id)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '委託先の取得に失敗しました')
        }
      }
    })()

    return () => { cancelled = true }
  }, [])

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-2xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        {/* ⚠️ 既存のカレンダー実装には手を入れない。表示の切り替えだけを外側に足す */}
        <div className="mb-4 flex rounded-xl border border-zinc-200 bg-white p-1">
          {VIEWS.map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition ${
                view === v.key ? 'bg-zinc-900 text-white' : 'text-zinc-500 active:bg-zinc-100'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {view === 'calendar' && <ScheduleCalendar contractorId={contractorId} />}
        {view === 'upcoming' && <UpcomingList />}
        {view === 'records'  && <WorkRecordList />}
      </div>

      <VoiceButton contractorId={contractorId} />
    </div>
  )
}
