'use client'
import ErrorFallback from '@/components/ErrorFallback'
export default function DriverError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorFallback {...props} segment="driver" />
}
