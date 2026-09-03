/**
 * 業務が止まる Server Action。ここに含まれる action_name（と source='cron'）は
 * severity='critical' となり即時メールの対象になる。spec §6。
 * ⚠️ 名前は export された関数名と完全一致させる（captured の第1引数）。
 */
export const CRITICAL_ACTIONS: ReadonlySet<string> = new Set([
  'login',
  'upsertSchedule',
  'bulkUpsertSchedules',
  'submitWorkRecord',
  'generatePaymentNotice',
  'generateAllPaymentNotices',
])
