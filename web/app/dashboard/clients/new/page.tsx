import { createClientMaster } from '../actions'

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const resolvedParams = await searchParams

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded shadow-md my-8 text-black">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">荷主マスタ 新規登録</h1>
      
      {resolvedParams.error && (
        <p className="text-red-500 mb-4 font-medium">{resolvedParams.error}</p>
      )}

      <form action={createClientMaster} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">会社名・屋号 <span className="text-red-500">*</span></label>
          <input name="name" type="text" required className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">担当者名</label>
            <input name="contact_name" type="text" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">電話番号</label>
            <input name="phone" type="text" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">メールアドレス</label>
            <input name="email" type="email" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">締め日（日） <span className="text-red-500">*</span></label>
            <input name="closing_day" type="number" min="1" max="31" required placeholder="末日の場合は31" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">入金サイト（日） <span className="text-red-500">*</span></label>
            <input name="payment_site" type="number" min="0" required placeholder="翌月末なら30" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">消費税の扱い <span className="text-red-500">*</span></label>
            <select name="tax_treatment" required className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white">
              <option value="exclusive">外税</option>
              <option value="inclusive">内税</option>
              <option value="exempt">非課税</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">インボイス登録</label>
            <select name="has_invoice" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white">
              <option value="true">登録あり</option>
              <option value="false">登録なし</option>
            </select>
          </div>
        </div>

        <div className="bg-gray-50 p-4 rounded border border-gray-200 mt-6">
          <h2 className="text-sm font-bold text-gray-800 mb-3">振込先口座情報</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600">銀行名</label>
              <input name="bank_name" type="text" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600">支店名</label>
              <input name="branch_name" type="text" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600">口座種別</label>
              <input name="account_type" type="text" placeholder="普通、当座など" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600">口座番号</label>
              <input name="account_number" type="text" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-600">口座名義（カナ）</label>
              <input name="account_holder" type="text" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-4 pt-4">
          <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition font-medium">
            荷主を登録する
          </button>
        </div>
      </form>
    </div>
  )
}
