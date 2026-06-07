import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { recordWork, recordExpense } from './actions'

export default async function DriverPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>
}) {
  const resolvedParams = await searchParams
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: contractor } = await supabase
    .from('contractors')
    .select('id, name')
    .eq('email', user.email)
    .single()

  if (!contractor) {
    return <div className="p-8 text-red-500">委託先マスタに登録されていません。親分に連絡してください。</div>
  }

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .order('created_at', { ascending: false })

  const todayStr = new Date().toISOString().split('T')[0]

  return (
    <div className="min-h-screen bg-gray-100 p-4 max-w-md mx-auto space-y-6 text-black pb-12">
      <header className="bg-white p-4 rounded shadow-sm flex justify-between items-center">
        <div>
          <p className="text-xs text-gray-500">お疲れ様です！</p>
          <h1 className="text-lg font-bold text-gray-900">{contractor.name} さん</h1>
        </div>
        <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded font-bold">子分アプリ</span>
      </header>

      {resolvedParams.success && (
        <div className="bg-green-500 text-white p-3 rounded text-sm font-medium shadow-sm">{resolvedParams.success}</div>
      )}
      {resolvedParams.error && (
        <div className="bg-red-500 text-white p-3 rounded text-sm font-medium shadow-sm">{resolvedParams.error}</div>
      )}

      {/* ① 勤務記録入力 */}
      <section className="bg-white p-4 rounded shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-gray-700 border-b pb-2">① 今日の運行・稼働記録</h2>
        <form action={recordWork} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-gray-600">稼働日</label>
            <input type="date" name="date" defaultValue={todayStr} required className="mt-1 block w-full rounded border border-gray-300 p-2 text-sm bg-gray-50" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600">案件</label>
            <select name="project_id" className="mt-1 block w-full rounded border border-gray-300 p-2 text-sm bg-gray-50">
              <option value="">-- 案件を選択（任意）--</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600">開始時刻</label>
              <input type="time" name="start_time" className="mt-1 block w-full rounded border border-gray-300 p-2 text-sm bg-gray-50" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600">終了時刻</label>
              <input type="time" name="end_time" className="mt-1 block w-full rounded border border-gray-300 p-2 text-sm bg-gray-50" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600">休憩（分）</label>
              <input type="number" name="break_minutes" min="0" defaultValue="0" className="mt-1 block w-full rounded border border-gray-300 p-2 text-sm bg-gray-50" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600">配達個数</label>
              <input type="number" name="quantity" min="0" defaultValue="0" className="mt-1 block w-full rounded border border-gray-300 p-2 text-sm bg-gray-50" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600">メモ</label>
            <textarea name="note" rows={2} placeholder="特記事項があれば入力" className="mt-1 block w-full rounded border border-gray-300 p-2 text-sm bg-gray-50 resize-none" />
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded font-bold text-sm hover:bg-blue-700 transition">
            勤務記録を登録する
          </button>
        </form>
      </section>

      {/* ② 立替金入力 */}
      <section className="bg-white p-4 rounded shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-gray-700 border-b pb-2">② 立替金・経費の入力</h2>
        <form action={recordExpense} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-gray-600">発生日</label>
            <input type="date" name="date" defaultValue={todayStr} required className="mt-1 block w-full rounded border border-gray-300 p-2 text-sm bg-gray-50" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600">種別</label>
            <select name="expense_type" required className="mt-1 block w-full rounded border border-gray-300 p-2 text-sm bg-gray-50">
              <option value="toll">高速代・有料道路</option>
              <option value="parking">駐車場代</option>
              <option value="fuel">燃料費</option>
              <option value="other">その他</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600">金額（円）</label>
            <input type="number" name="amount" min="0" required placeholder="0" className="mt-1 block w-full rounded border border-gray-300 p-2 text-sm bg-gray-50" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600">メモ</label>
            <textarea name="note" rows={2} placeholder="領収書番号や詳細など" className="mt-1 block w-full rounded border border-gray-300 p-2 text-sm bg-gray-50 resize-none" />
          </div>
          <button type="submit" className="w-full bg-orange-500 text-white py-3 rounded font-bold text-sm hover:bg-orange-600 transition">
            立替金を登録する
          </button>
        </form>
      </section>
    </div>
  )
}
