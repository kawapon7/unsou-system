'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'

export function PrintModal({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen:   boolean
  onClose:  () => void
  title:    string
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!isOpen || !mounted) return null

  return createPortal(
    <div id="pdf-print-area">
      {/* 背景オーバーレイ・操作バー - 印刷時は .no-print で非表示 */}
      <div className="no-print">
        <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
        <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-4 bg-zinc-900/95 px-6 py-3 backdrop-blur">
          <h2 className="text-sm font-medium text-white truncate max-w-lg">{title}</h2>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium text-white transition"
            >
              📄 印刷・PDF保存
            </button>
            <button
              onClick={onClose}
              className="rounded-lg bg-white/10 hover:bg-white/20 px-4 py-2 text-sm font-medium text-white transition"
            >
              ✕ 閉じる
            </button>
          </div>
        </div>
      </div>

      {/* ドキュメント表示エリア - 印刷時は print:static で自然フロー */}
      <div className="fixed inset-0 z-45 overflow-y-auto pt-14 print:static print:pt-0 print:overflow-visible">
        <div className="my-8 mx-auto w-fit print:m-0 print:w-full">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
