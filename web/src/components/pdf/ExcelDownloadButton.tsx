'use client'

import { useState } from 'react'
import type ExcelJS from 'exceljs'

/**
 * ブラウザ側で xlsx を組んで保存する。サーバーにファイルを持たない（Workers にファイル I/O が無い）。
 * ⚠️ ExcelJS はバンドルが大きいので動的 import（build は呼び出し側が遅延解決する）
 */
export function ExcelDownloadButton({ build, fileName }: { build: () => Promise<ExcelJS.Workbook>; fileName: string }) {
  const [busy, setBusy] = useState(false)
  const onClick = async () => {
    setBusy(true)
    try {
      const wb = await build()
      const buf = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = fileName; a.click()
      URL.revokeObjectURL(url)
    } finally { setBusy(false) }
  }
  return (
    <button type="button" onClick={onClick} disabled={busy} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50 print:hidden">
      {busy ? '作成中…' : 'Excel'}
    </button>
  )
}
