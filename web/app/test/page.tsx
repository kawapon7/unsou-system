import { createClient } from '../../utils/supabase/server'

export const revalidate = 0 

export default async function TestPage() {
  // ⚠️注意: createClientが非同期になったため await を付与
  const supabase = await createClient()
  
  const { data, error } = await supabase.from('users').select('*')

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-red-500 text-xl font-bold">Supabase 接続エラー</h1>
        <pre className="bg-gray-100 p-4 rounded mt-2">{JSON.stringify(error, null, 2)}</pre>
      </div>
    )
  }

  return (
    <div className="p-6">
      <h1 className="text-green-500 text-xl font-bold">Supabase 疎通成功！</h1>
      <p className="mt-2">取得データ数: {data?.length ?? 0} 件</p>
      <pre className="bg-gray-100 p-4 rounded mt-2">{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}
