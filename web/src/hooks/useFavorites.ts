'use client'

import { useSyncExternalStore, useCallback } from 'react'

const STORAGE_KEY  = 'hibiki_admin_favorites'
const CHANGE_EVENT = 'hibiki:favorites-change'

export interface Favorite {
  id:    string
  label: string
  url:   string
}

// ── ストア（localStorage バッキング） ─────────────────────

let _lastRaw    = ''
let _lastParsed: Favorite[] = []

function getSnapshot(): Favorite[] {
  const raw = localStorage.getItem(STORAGE_KEY) ?? '[]'
  if (raw !== _lastRaw) {
    _lastRaw = raw
    try { _lastParsed = JSON.parse(raw) as Favorite[] }
    catch { _lastParsed = [] }
  }
  return _lastParsed
}

const EMPTY: Favorite[] = []
const getServerSnapshot = (): Favorite[] => EMPTY

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback)
  return () => window.removeEventListener(CHANGE_EVENT, callback)
}

function write(favs: Favorite[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favs))
  _lastRaw = ''
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

// ── フック ────────────────────────────────────────────────

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggle = useCallback((fav: Favorite) => {
    const cur    = getSnapshot()
    const exists = cur.some(f => f.id === fav.id)
    write(exists ? cur.filter(f => f.id !== fav.id) : [...cur, fav])
  }, [])

  const remove = useCallback((id: string) => {
    write(getSnapshot().filter(f => f.id !== id))
  }, [])

  const isFav = useCallback(
    (id: string) => favorites.some(f => f.id === id),
    [favorites],
  )

  return { favorites, toggle, remove, isFav }
}
