'use client'

import { useState, useEffect, useCallback } from 'react'

// ── 定数 ─────────────────────────────────────────────────

const STORAGE_KEY  = 'hibiki_oyabun_favorites'
const CHANGE_EVENT = 'hibiki:favorites-change'

// ── 型 ───────────────────────────────────────────────────

export interface Favorite {
  id:    string  // URL pathname をキーとして使用（例: "/oyabun/sales"）
  label: string  // サイドバー表示名
  url:   string  // 遷移先 URL
}

// ── localStorage ヘルパー ────────────────────────────────

function readStorage(): Favorite[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Favorite[]
  } catch {
    return []
  }
}

function writeStorage(favs: Favorite[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favs))
  // 同一タブ内のすべての useFavorites インスタンスに変更を通知
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

// ── フック ────────────────────────────────────────────────

/**
 * 親分アプリのお気に入り（ショートカット）を管理するフック。
 * SSRセーフ: localStorage へのアクセスは必ず useEffect 内で行う。
 */
export function useFavorites() {
  // 初期値は空配列（SSR と一致させてハイドレーションエラーを防ぐ）
  const [favorites, setFavorites] = useState<Favorite[]>([])

  useEffect(() => {
    // マウント後に localStorage から読み込み
    setFavorites(readStorage())

    // 同一タブ内での変更イベントを購読
    const handler = () => setFavorites(readStorage())
    window.addEventListener(CHANGE_EVENT, handler)
    return () => window.removeEventListener(CHANGE_EVENT, handler)
  }, [])

  /** お気に入り追加・削除のトグル */
  const toggle = useCallback((fav: Favorite) => {
    const current = readStorage()
    const exists  = current.some(f => f.id === fav.id)
    writeStorage(exists ? current.filter(f => f.id !== fav.id) : [...current, fav])
  }, [])

  /** ID 指定でお気に入りを削除 */
  const remove = useCallback((id: string) => {
    writeStorage(readStorage().filter(f => f.id !== id))
  }, [])

  /** 指定 ID がお気に入り済みかどうか */
  const isFav = useCallback(
    (id: string) => favorites.some(f => f.id === id),
    [favorites],
  )

  return { favorites, toggle, remove, isFav }
}
