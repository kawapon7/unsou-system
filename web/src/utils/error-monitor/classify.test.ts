import { describe, it, expect } from 'vitest'
import { isSystemError, severityFor } from './classify'

describe('isSystemError', () => {
  it.each([
    'PGRST301: JWT expired',
    'duplicate key value violates unique constraint "schedules_pkey"',
    'new row violates row-level security policy',
    'connection refused',
    'ECONNRESET',
    'Request timed out',
    'fetch failed',
    'Failed to fetch',
    'permission denied for table users',
    'relation "public.foo" does not exist',
    'column "bar" does not exist',
    'invalid token',
    'Internal Server Error',
    '502 Bad Gateway',
  ])('system: %s', (m) => expect(isSystemError(m)).toBe(true))

  it.each([
    '委託先が見つかりません',
    '未ログインです',
    'メールアドレスまたはパスワードが正しくありません',
    'clientId と month は必須です',
    '',
  ])('business: %s', (m) => expect(isSystemError(m)).toBe(false))
})

describe('severityFor', () => {
  it('critical action', () => expect(severityFor('action', 'upsertSchedule')).toBe('critical'))
  it('cron is always critical', () => expect(severityFor('cron', 'anything')).toBe('critical'))
  it('other action normal', () => expect(severityFor('action', 'listUsers')).toBe('normal'))
  it('boundary normal', () => expect(severityFor('boundary', 'admin')).toBe('normal'))
})
