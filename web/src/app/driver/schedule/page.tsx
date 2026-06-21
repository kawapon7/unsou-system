'use client'

import { useState, useEffect } from 'react'
import { fetchMyContractor } from '../dashboard/actions'
import { VoiceButton } from '@/components/voice/VoiceButton'
import ScheduleCalendar from '@/components/driver/ScheduleCalendar'

export default function DriverSchedulePage() {
  const [contractorId, setContractorId] = useState<string | undefined>(undefined)
  const [error,        setError]        = useState<string | null>(null)

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

        <ScheduleCalendar contractorId={contractorId} />
      </div>

      <VoiceButton contractorId={contractorId} />
    </div>
  )
}
