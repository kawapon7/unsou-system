'use client'

/**
 * VoiceButton — 音声操作フローティングボタン
 * VOICE仕様書 §2-1〜§2-4 準拠。音声ストリームはサーバーに送信しない。
 * Web Speech API でブラウザ内テキスト化 → Gemini Server Action へテキストのみ送信。
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  parseVoiceIntent,
  saveVoiceExpense,
  type VoiceIntentResult,
} from '@/app/_actions/voice-actions'

// ── Web Speech API 最小型宣言 ────────────────────────────

interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length:  number
  [index: number]:  SpeechRecognitionAlternative
}
interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results:     SpeechRecognitionResultList
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error:   string
  readonly message: string
}
interface SpeechRecognitionLike extends EventTarget {
  lang:           string
  continuous:     boolean
  interimResults: boolean
  maxAlternatives: number
  start():  void
  stop():   void
  abort():  void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onend:    (() => void) | null
  onerror:  ((e: SpeechRecognitionErrorEvent) => void) | null
}
declare global {
  interface Window {
    SpeechRecognition?:       new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}

// ── 定数 ─────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  highway: '高速道路料金',
  parking: '駐車場代',
  fuel:    '燃料費補助',
}

function speakJa(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt  = new SpeechSynthesisUtterance(text)
  utt.lang   = 'ja-JP'
  utt.rate   = 1.05
  window.speechSynthesis.speak(utt)
}

// ── Props ─────────────────────────────────────────────────

interface VoiceButtonProps {
  /** driver コンテキストでのみ設定。設定時のみ経費の確認・保存フローが有効 */
  contractorId?: string
}

// ── フェーズ ──────────────────────────────────────────────

type Phase =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'confirm_expense'
  | 'replied'
  | 'error'

// ── マイクアイコン SVG ────────────────────────────────────

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className ?? 'w-6 h-6 fill-white'}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zm-1 3a1 1 0 0 1 2 0v7a1 1 0 0 1-2 0V5zm8 7a7 7 0 0 1-14 0H3a9 9 0 0 0 8 8.94V22h2v-2.06A9 9 0 0 0 21 12h-2z" />
    </svg>
  )
}

// ── VoiceButton ───────────────────────────────────────────

export function VoiceButton({ contractorId }: VoiceButtonProps) {
  const router = useRouter()

  const [supported,  setSupported]  = useState(false)
  const [phase,      setPhase]      = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [result,     setResult]     = useState<VoiceIntentResult | null>(null)
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null)
  const [saving,     setSaving]     = useState(false)

  const recogRef      = useRef<SpeechRecognitionLike | null>(null)
  const transcriptRef = useRef('')

  // ブラウザサポートチェック（SSRセーフ）
  useEffect(() => {
    setSupported(
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
    )
  }, [])

  // アンマウント時クリーンアップ
  useEffect(() => () => {
    recogRef.current?.abort()
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
  }, [])

  // ── dismiss ────────────────────────────────────────────

  const dismiss = useCallback(() => {
    recogRef.current?.abort()
    recogRef.current      = null
    transcriptRef.current = ''
    setPhase('idle')
    setTranscript('')
    setResult(null)
    setErrorMsg(null)
  }, [])

  // ── 音声認識開始 ───────────────────────────────────────

  const startListening = useCallback(() => {
    const SpeechRec = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SpeechRec) return

    transcriptRef.current = ''
    setTranscript('')
    setResult(null)
    setErrorMsg(null)
    setPhase('listening')

    const recog = new SpeechRec()
    recog.lang           = 'ja-JP'
    recog.continuous     = false
    recog.interimResults = true
    recog.maxAlternatives = 1

    recog.onresult = (e) => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript
      }
      transcriptRef.current = text
      setTranscript(text)
    }

    recog.onend = () => {
      const final = transcriptRef.current.trim()
      transcriptRef.current = ''
      recogRef.current      = null

      if (!final) { setPhase('idle'); return }

      void (async () => {
        setPhase('processing')
        const r = await parseVoiceIntent(final)
        setResult(r)

        // 画面遷移
        if (r.intent === 'navigate' && r.targetUrl) {
          setPhase('replied')
          speakJa(r.replyMessage)
          setTimeout(() => { router.push(r.targetUrl!); setPhase('idle') }, 1800)
          return
        }

        // 経費確認（driver のみ contractorId が設定されている）
        if (r.intent === 'add_expense' && r.expenseData && contractorId) {
          setPhase('confirm_expense')
          speakJa(r.replyMessage)
          return
        }

        // unknown または経費（親分コンテキスト）
        setPhase('replied')
        speakJa(r.replyMessage)
        setTimeout(() => setPhase('idle'), 3500)
      })()
    }

    recog.onerror = (e) => {
      recogRef.current = null
      if (e.error === 'no-speech' || e.error === 'aborted') {
        setPhase('idle')
        return
      }
      setPhase('error')
      setErrorMsg(
        e.error === 'not-allowed'
          ? 'マイクへのアクセスを許可してください。ブラウザの設定を確認してください。'
          : `音声認識エラーが発生しました（${e.error}）`,
      )
    }

    recogRef.current = recog
    recog.start()
  }, [contractorId, router])

  // ── ボタンクリック ─────────────────────────────────────

  const handleMicClick = useCallback(() => {
    if (phase === 'listening') {
      recogRef.current?.stop()  // → onend 経由で processing へ遷移
      return
    }
    if (phase === 'idle' || phase === 'replied' || phase === 'error') {
      startListening()
    }
  }, [phase, startListening])

  // ── 経費保存 ───────────────────────────────────────────

  const handleConfirmExpense = useCallback(async () => {
    if (!result?.expenseData || !contractorId) return
    setSaving(true)
    const r = await saveVoiceExpense({
      contractorId,
      category: result.expenseData.category,
      amount:   result.expenseData.amount,
      date:     new Date().toISOString().slice(0, 10),
    })
    setSaving(false)
    if (r.error) {
      setPhase('error')
      setErrorMsg(r.error)
      return
    }
    speakJa('登録が完了しました！')
    setResult({ intent: 'unknown', replyMessage: '✅ 経費の登録が完了しました！' })
    setPhase('replied')
    setTimeout(() => setPhase('idle'), 2500)
  }, [result, contractorId])

  // ── Web Speech 非対応環境では非表示 ───────────────────

  if (!supported) return null

  // ── パネルヘッダーのスタイル ───────────────────────────

  const panelHeaderBg = {
    listening:       'bg-red-50   border-red-100',
    processing:      'bg-zinc-50  border-zinc-100',
    confirm_expense: 'bg-amber-50 border-amber-100',
    replied:         'bg-green-50 border-green-100',
    error:           'bg-red-50   border-red-100',
    idle:            'bg-zinc-50  border-zinc-100',
  }[phase]

  const panelHeaderIcon = {
    listening:       '🎙️',
    processing:      '⚙️',
    confirm_expense: '📝',
    replied:         '✅',
    error:           '⚠️',
    idle:            '',
  }[phase]

  const panelHeaderLabel = {
    listening:       '聞いています...',
    processing:      'AIが解析中...',
    confirm_expense: '経費を確認',
    replied:         '完了',
    error:           'エラー',
    idle:            '',
  }[phase]

  const micBtnCls = [
    'w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
    phase === 'listening'
      ? 'bg-red-500 hover:bg-red-600 scale-110 ring-4 ring-red-200 animate-pulse focus-visible:ring-red-400'
      : phase === 'processing' || phase === 'confirm_expense'
      ? 'bg-zinc-400 cursor-not-allowed'
      : 'bg-zinc-900 hover:bg-zinc-700 hover:scale-105 focus-visible:ring-zinc-700',
  ].join(' ')

  const isPanelOpen = phase !== 'idle'

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">

      {/* ── オーバーレイパネル ─────────────────────────── */}
      {isPanelOpen && (
        <div className="w-72 rounded-2xl bg-white border border-zinc-200 shadow-2xl overflow-hidden">

          {/* パネルヘッダー */}
          <div className={`px-4 py-3 border-b flex items-center justify-between ${panelHeaderBg}`}>
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">{panelHeaderIcon}</span>
              <span className="text-xs font-semibold text-zinc-700">{panelHeaderLabel}</span>
            </div>
            <button
              onClick={dismiss}
              aria-label="閉じる"
              className="text-zinc-400 hover:text-zinc-600 text-sm leading-none"
            >
              ✕
            </button>
          </div>

          <div className="px-4 py-4 space-y-3">

            {/* 認識テキスト */}
            {(phase === 'listening' || phase === 'processing') && transcript && (
              <p className="text-sm text-zinc-600 leading-relaxed">
                「{transcript}」
              </p>
            )}

            {/* 処理中スピナー */}
            {phase === 'processing' && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full border-2 border-zinc-200 border-t-zinc-700 animate-spin" />
                <span className="text-xs text-zinc-500">Gemini が解析中...</span>
              </div>
            )}

            {/* 経費確認カード */}
            {phase === 'confirm_expense' && result?.expenseData && (
              <>
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 space-y-1">
                  <p className="text-xs font-semibold text-amber-700">
                    {CATEGORY_LABEL[result.expenseData.category] ?? '立替経費'}
                  </p>
                  <p className="text-2xl font-bold text-zinc-900 tabular-nums">
                    ¥{result.expenseData.amount.toLocaleString('ja-JP')}
                  </p>
                  <p className="text-xs text-zinc-500">
                    本日 {new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleConfirmExpense}
                    disabled={saving}
                    className="py-2.5 rounded-xl bg-zinc-900 text-white text-xs font-bold disabled:opacity-50 hover:bg-zinc-700 transition"
                  >
                    {saving ? '保存中...' : '登録する'}
                  </button>
                  <button
                    onClick={dismiss}
                    disabled={saving}
                    className="py-2.5 rounded-xl border border-zinc-300 text-zinc-600 text-xs font-medium hover:bg-zinc-50 transition"
                  >
                    キャンセル
                  </button>
                </div>
              </>
            )}

            {/* 応答メッセージ */}
            {phase === 'replied' && result && (
              <p className="text-sm text-zinc-700 leading-relaxed">
                {result.replyMessage}
              </p>
            )}

            {/* エラー */}
            {phase === 'error' && (
              <p className="text-sm text-red-600 leading-relaxed">
                {errorMsg ?? 'エラーが発生しました'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── マイクボタン ──────────────────────────────── */}
      <button
        onClick={handleMicClick}
        disabled={phase === 'processing' || phase === 'confirm_expense'}
        aria-label={phase === 'listening' ? '音声認識を停止' : '音声操作を開始（マイク）'}
        className={micBtnCls}
      >
        {phase === 'processing' ? (
          <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        ) : (
          <MicIcon />
        )}
      </button>

    </div>
  )
}
