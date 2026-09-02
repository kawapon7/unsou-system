'use client'
import ErrorFallback from '@/components/ErrorFallback'
export default function AdminError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorFallback {...props} segment="admin" />
}
