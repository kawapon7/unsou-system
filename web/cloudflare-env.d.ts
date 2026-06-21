/**
 * Cloudflare Pages 環境変数の型定義
 *
 * Cloudflare Pages ダッシュボード → Settings → Environment Variables で設定する。
 * Edge Runtime では `process.env` ではなく `context.env` 経由でアクセスされるが、
 * @cloudflare/next-on-pages が Next.js の process.env へブリッジするため、
 * コード側は process.env のままでよい。
 *
 * ⚠️ SUPABASE_SERVICE_ROLE_KEY / ENCRYPTION_KEY / RESEND_API_KEY は
 *    "Production" 環境変数として設定し、絶対に NEXT_PUBLIC_ プレフィックスを付けないこと。
 *    クライアントバンドルに漏洩するとセキュリティインシデントになる。
 */

interface CloudflareEnv {
  // ── Supabase ────────────────────────────────────────────────────
  /** Supabase プロジェクト URL（公開可） */
  NEXT_PUBLIC_SUPABASE_URL: string

  /** Supabase anon key（公開可・RLS で保護） */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string

  /**
   * Supabase service_role key
   * ⚠️ RLS を完全バイパスする。絶対に公開しないこと。
   */
  SUPABASE_SERVICE_ROLE_KEY: string

  // ── メール送信 ──────────────────────────────────────────────────
  /** Resend API キー */
  RESEND_API_KEY: string

  /** 送信元メールアドレス（例: noreply@hibiki.app） */
  RESEND_FROM_EMAIL: string

  /** アラート通知先メールアドレス */
  ADMIN_ALERT_EMAIL: string

  // ── 暗号化 ─────────────────────────────────────────────────────
  /**
   * AES-256-GCM 用暗号化キー（32バイト, hex 64文字）
   * ⚠️ 本番用キーはローカル `.env.local` とは別の値を使うこと。
   */
  ENCRYPTION_KEY: string

  // ── AI ─────────────────────────────────────────────────────────
  /** Gemini API キー */
  GEMINI_API_KEY: string
}

// Next.js の ProcessEnv を拡張して補完を有効化
declare namespace NodeJS {
  interface ProcessEnv extends CloudflareEnv {
    NODE_ENV: 'development' | 'production' | 'test'
  }
}
