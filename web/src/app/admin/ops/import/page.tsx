import { notFound } from 'next/navigation'
import { requireOperator } from '@/utils/operator'
import ImportClient from './ImportClient'

// 取引先一括インポート（運営者専用・初期投入用）。
// 運営者以外には画面の存在自体を見せない（404）。
export default async function OpsImportPage() {
  const auth = await requireOperator()
  if (!auth.ok) notFound()
  return <ImportClient />
}
