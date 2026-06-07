import { createClient } from '@/utils/supabase/server'
import { createProjectMaster } from '../actions'

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const resolvedParams = await searchParams
  const supabase = await createClient()

  // フォームの選択肢として利用するため、登録済みの荷主一覧を高速取得
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .order('created_at', { ascending: false })

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded shadow-md my-8 text-black">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">案件マスタ 新規登録</h1>
      
      {resolvedParams.error && (
        <p className="text-red-500 mb-4 font-medium">{resolvedParams.error}</p>
      )}

      <form action={createProjectMaster} className="space-y-6">
        {/* 案件基本設定 */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">発注元荷主 <span className="text-red-500">*</span></label>
            <select name="client_id" required className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white">
              <option value="">-- 荷主を選択してください --</option>
              {clients?.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">案件名（仕事の種類） <span className="text-red-500">*</span></label>
            <input name="name" type="text" required placeholder="例: 城南エリア宅配便、企業間スポット配送" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
        </div>

        <hr className="border-gray-200" />

        {/* 単価ルール・計算方式設定 */}
        <div>
          <h2 className="text-lg font-bold text-gray-800 mb-4">単価ルール設定</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">計算方式 <span className="text-red-500">*</span></label>
              <select name="calculation_type" required className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white">
                <option value="hourly">時給制（稼働時間×時給）</option>
                <option value="piece">個数制（配達個数×単価）</option>
                <option value="fixed">固定制（稼働日数×日当）</option>
                <option value="mixed">混合制（基本固定＋個数歩合）</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">荷主請求単価（売値） <span className="text-red-500">*</span></label>
              <input name="sales_price" type="number" min="0" required placeholder="税抜金額" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">委託先支払単価（買値） <span className="text-red-500">*</span></label>
              <input name="buying_price" type="number" min="0" required placeholder="税抜金額" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
            </div>
          </div>
        </div>

        {/* 中間マージン設定 */}
        <div className="bg-gray-50 p-4 rounded border border-gray-200">
          <h3 className="text-sm font-bold text-gray-800 mb-3">中間マージン設定（親分粗利計算用）</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600">設定タイプ</label>
              <select name="margin_setting" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white">
                <option value="percentage">パーセント指定（%）</option>
                <option value="fixed">定額指定（円）</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600">値（デフォルト10%）</label>
              <input name="margin_value" type="number" min="0" defaultValue="10" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-4">
          <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition font-medium">
            案件マスタを登録する
          </button>
        </div>
      </form>
    </div>
  )
}
