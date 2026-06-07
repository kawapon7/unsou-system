import { createContractorMaster } from '../actions'

export default async function NewContractorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const resolvedParams = await searchParams

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded shadow-md my-8 text-black">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">委託先マスタ 新規登録</h1>
      
      {resolvedParams.error && (
        <p className="text-red-500 mb-4 font-medium">{resolvedParams.error}</p>
      )}

      <form action={createContractorMaster} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">氏名（または法人名） <span className="text-red-500">*</span></label>
            <input name="name" type="text" required className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">メールアドレス（ログインID） <span className="text-red-500">*</span></label>
            <input name="email" type="email" required className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">電話番号</label>
            <input name="phone" type="text" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">区分（contractor_type）</label>
            <select name="contractor_type" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white">
              <option value="sole_proprietor">個人事業主</option>
              <option value="corporate">法人</option>
              <option value="employed">雇用</option>
            </select>
          </div>
        </div>

        <hr className="border-gray-200 my-4" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">支払方式 <span className="text-red-500">*</span></label>
            <input name="payment_method" type="text" required placeholder="銀行振込など" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">支払サイト（日） <span className="text-red-500">*</span></label>
            <input name="payment_site" type="number" min="0" required placeholder="翌月末なら30" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">消費税区分 <span className="text-red-500">*</span></label>
            <select name="tax_type" required className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white">
              <option value="taxable">課税</option>
              <option value="exempt">非課税</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">インボイス登録区分 <span className="text-red-500">*</span></label>
            <select name="invoice_status" required className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white">
              <option value="registered">登録あり</option>
              <option value="unregistered">未登録</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">インボイス登録番号</label>
            <input name="invoice_number" type="text" placeholder="T1234567890123" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">源泉徴収（凍結中）</label>
            <select name="has_withholding" className="mt-1 block w-full rounded border border-gray-300 p-2 text-black bg-white">
              <option value="false">なし</option>
              <option value="true">あり</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-blue-50 p-3 rounded border border-blue-200">
          <input type="checkbox" id="show_detail_switch" name="show_detail_switch" value="true" className="w-4 h-4 text-blue-600 border-gray-300 rounded" />
          <label htmlFor="show_detail_switch" className="text-sm font-medium text-blue-900 select-none">
            詳細入力切り替えスイッチ（個人Y用フラグ）を有効にする
          </label>
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
            委託先を登録する
          </button>
        </div>
      </form>
    </div>
  )
}
