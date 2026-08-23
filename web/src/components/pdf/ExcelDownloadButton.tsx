'use client'

import { useState } from 'react'
import type ExcelJS from 'exceljs'

const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_')

/**
 * ブラウザ側で xlsx を組んで保存する。サーバーにファイルを持たない（Workers にファイル I/O が無い）。
 * ⚠️ ExcelJS はバンドルが大きいので動的 import（build は呼び出し側が遅延解決する）
 */
export function ExcelDownloadButton({ build, fileName }: { build: () => Promise<ExcelJS.Workbook>; fileName: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onClick = async () => {
    setBusy(true)
    setError(null)
    try {
      const wb = await build()
      const buf = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = safeFileName(fileName); a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      // ⚠️ ここで握りつぶすと、顧客に渡す書類の生成に失敗してもボタンが黙って止まるだけになる。
      //    利用者が気づけるよう、必ずエラーメッセージを画面に出す。
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" onClick={onClick} disabled={busy} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50">
        {busy ? '作成中…' : 'Excel'}
      </button>
      {error && (
        <p className="text-xs text-red-600 print:hidden">Excel の作成に失敗しました: {error}</p>
      )}
    </span>
  )
}
