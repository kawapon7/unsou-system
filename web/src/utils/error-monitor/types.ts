export type Source   = 'action' | 'route' | 'cron' | 'boundary'
export type Severity = 'critical' | 'normal'

/** 整形後（マスク済み）のイベント。sink に渡す直前の形 */
export type ErrorEvent = {
  fingerprint:  string
  source:       Source
  actionName:   string
  severity:     Severity
  message:      string        // マスク後・2,000字以内
  stack:        string | null // マスク後・4,000字以内
  path:         string | null
  tenantId:     string | null
  userId:       string | null
  contractorId: string | null
}

export type ErrorRecordResult = {
  id:         string
  count:      number
  notifiedAt: string | null   // ISO
}

/** 記録先の抽象。第1実装は SupabaseSink。将来 SentrySink 等を足す */
export interface ErrorSink {
  record(event: ErrorEvent): Promise<ErrorRecordResult>
  markNotified(id: string): Promise<void>
}

/** captured() に呼び出し元が任意で渡す文脈（getAuthContext を呼び直さない） */
export type CaptureContext = {
  tenantId?:     string | null
  userId?:       string | null
  contractorId?: string | null
  path?:         string | null
}
