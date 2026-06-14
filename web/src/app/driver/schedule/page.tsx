import ScheduleCalendar from '@/components/driver/ScheduleCalendar'

export default function SchedulePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-lg font-bold text-zinc-900">予定管理</h1>
        <p className="text-xs text-zinc-500 mt-0.5">日付をタップして稼働予定を切り替えます</p>
      </div>
      <ScheduleCalendar />
    </div>
  )
}
