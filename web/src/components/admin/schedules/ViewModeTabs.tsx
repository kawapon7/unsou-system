'use client'

import { VIEW_MODES } from './constants'
import type { ViewMode } from './types'

type ViewModeTabsProps = {
  viewMode: ViewMode
  onChange: (mode: ViewMode) => void
}

export function ViewModeTabs({ viewMode, onChange }: ViewModeTabsProps) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5">
      {VIEW_MODES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            viewMode === id
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
