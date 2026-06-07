export const metadata = {
  title: '運送システム',
  description: 'Next.js + Supabase 業務効率化ツール',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
