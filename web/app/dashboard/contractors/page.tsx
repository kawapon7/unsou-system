import { createClient } from '@/utils/supabase/server'
import { decryptText } from '@/utils/crypto'
import { redirect } from 'next/navigation'
import Link from 'next/link'

function safeDecrypt(value: string | null | undefined): string {
  if (!value) return ''
  // 注意：暗号化形式でないデータや復号失敗時は、安全のためプレーンテキストのまま返すか空文字にする制御を入れ、画面クラッシュを防ぎます。
  if (!value.includes(':')) return value
  try {
    return decryptText(value)
  } catch {
    return ''
  }
}

export default async function ContractorsPage() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: contractors, error } = await supabase
    .from('contractors')
    .select('id, name, email, phone, contractor_type, invoice_status, bank_name, branch_name, account_type, account_number, account_holder')
    .order('created_at', { ascending: false })

  if (error) {
    return <div className="p-8 text-red-500">データの取得に失敗しました。</div>
  }

  const decrypted = (contractors ?? []).map((c) => ({
    ...c,
    bank_name: safeDecrypt(c.bank_name),
    branch_name: safeDecrypt(c.branch_name),
    account_type: safeDecrypt(c.account_type),
    account_number: safeDecrypt(c.account_number),
    account_holder: safeDecrypt(c.account_holder),
  }))

  return (
    <div className="p-6 text-black">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">委託先マスタ 一覧</h1>
        <Link href="/dashboard/contractors/new" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition text-sm font-medium">
          新規登録
        </Link>
      </div>

      {decrypted.length === 0 ? (
        <p className="text-gray-500">委託先が登録されていません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse bg-white rounded shadow-sm">
            <thead>
              <tr className="bg-gray-100 text-left text-xs text-gray-600">
                <th className="p-3 border-b">氏名/法人名</th>
                <th className="p-3 border-b">メール</th>
                <th className="p-3 border-b">区分</th>
                <th className="p-3 border-b">インボイス</th>
                <th className="p-3 border-b">銀行名</th>
                <th className="p-3 border-b">支店名</th>
                <th className="p-3 border-b">口座種別</th>
                <th className="p-3 border-b">口座番号</th>
                <th className="p-3 border-b">口座名義</th>
              </tr>
            </thead>
            <tbody>
              {decrypted.map((c) => (
                <tr key={c.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3 text-gray-600">{c.email}</td>
                  <td className="p-3">{c.contractor_type}</td>
                  <td className="p-3">{c.invoice_status}</td>
                  <td className="p-3">{c.bank_name}</td>
                  <td className="p-3">{c.branch_name}</td>
                  <td className="p-3">{c.account_type}</td>
                  <td className="p-3">{c.account_number}</td>
                  <td className="p-3">{c.account_holder}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
