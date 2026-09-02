'use client'
import ErrorFallback from '@/components/ErrorFallback'
// ⚠️ global-error は root layout を置き換えるため <html><body> を自前で持つ必要がある
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body>
        <ErrorFallback {...props} segment="root" />
      </body>
    </html>
  )
}
