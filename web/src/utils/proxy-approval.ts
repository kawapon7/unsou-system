// ── 代理承認（口頭確認による親分の代理承認）の定数と型 ────────────────
//
// ⚠️ このファイルに 'use server' を付けてはならない。
//    `'use server'` ファイルは **async 関数しか export できない**。
//    配列や型を混ぜると `A "use server" file can only export async functions, found object.`
//    が実行時にだけ出る（tsc も vitest も素通りする）ため、定数はここに置いて
//    Server Action 側とクライアント側の両方から import する。

/** 確認方法。DBの approval_history_confirmation_method_check と一致させること */
export const CONFIRMATION_METHODS = ['phone', 'in_person', 'sms', 'email', 'line'] as const
export type ConfirmationMethod = (typeof CONFIRMATION_METHODS)[number]

/** 確認した相手 */
export const CONFIRMED_PARTIES = ['self', 'family_or_staff'] as const
export type ConfirmedParty = (typeof CONFIRMED_PARTIES)[number]

export const CONFIRMATION_METHOD_LABELS: Record<ConfirmationMethod, string> = {
  phone:     '電話',
  in_person: '対面',
  sms:       'SMS',
  email:     'メール',
  line:      'LINE',
}

export const CONFIRMED_PARTY_LABELS: Record<ConfirmedParty, string> = {
  self:            '本人',
  family_or_staff: '家族・事務担当',
}

export type ProxyApprovalParams = {
  noticeId:           string
  confirmationMethod: ConfirmationMethod
  confirmedParty:     ConfirmedParty
  /** いつ・どう確認したかのメモ。必須（無記名の代理承認を作らせない） */
  note:               string
}
