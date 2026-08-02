// ── 委託先の「インボイス登録区分」を判定する唯一の正本 ──────────────────
//
// ⚠️ このファイルに 'use server' を付けてはならない（純粋関数を export しているため）。
//
// 背景（2026-08-02）: `contractors.invoice_registration_type` には**5通りの表記**が
// 本番に混在している（`registered` / `適格` / `unregistered` / `exempt` / `免税`）。
// にもかかわらず判定が3通りに分裂しており、画面ごとに答えが食い違っていた:
//
//   - admin/billing/actions.ts   `=== '適格'`     → `registered` の委託先を未登録扱い
//   - admin/sales/actions.ts     `=== 'registered'` → `適格` の委託先を未登録扱い
//   - _actions/pdfActions.ts     両方を見る（唯一正しかった）
//
// 未登録扱いになると経過措置の控除が引かれるため、**これは表示ではなく支払額の誤り**。
// 判定が要るならこのモジュールを使い、`=== 'registered'` のような直書きを増やさないこと。

/** 経過措置の観点では registered 以外はすべて控除対象。exempt と unregistered は表示のみ区別する */
export type InvoiceRegistrationStatus = 'registered' | 'exempt' | 'unregistered'

const REGISTERED_VALUES = ['registered', '適格', '適格請求書発行事業者', '登録済'] as const
const EXEMPT_VALUES     = ['exempt', '免税', '免税事業者', 'non_taxable'] as const

/**
 * 表記ゆれを 3 区分へ正規化する。
 *
 * ⚠️ 未知の値は `unregistered`（＝控除する側）に倒す。これは従来の挙動と同じで、
 *    ここで `registered` に倒すと「未知の値が入った瞬間に控除が消える」という
 *    気づけない金額変動になるため。未知の値は画面ラベルで見えるようにしてある。
 */
export function normalizeInvoiceRegistration(
  raw: string | null | undefined,
): InvoiceRegistrationStatus {
  const v = (raw ?? '').trim()
  if ((REGISTERED_VALUES as readonly string[]).includes(v)) return 'registered'
  if ((EXEMPT_VALUES as readonly string[]).includes(v))     return 'exempt'
  return 'unregistered'
}

/**
 * 適格請求書発行事業者か（＝経過措置の控除対象**外**か）。
 * 金額計算で「登録済かどうか」を見たいときは必ずこれを使う。
 */
export function isQualifiedInvoiceIssuer(raw: string | null | undefined): boolean {
  return normalizeInvoiceRegistration(raw) === 'registered'
}

const LABEL: Record<InvoiceRegistrationStatus, string> = {
  registered:   'インボイス登録済',
  exempt:       '免税事業者（経過措置）',
  unregistered: '未登録（経過措置）',
}

/** 画面表示用のラベル。生値がそのまま出るのを防ぐ */
export function invoiceRegistrationLabel(raw: string | null | undefined): string {
  return LABEL[normalizeInvoiceRegistration(raw)]
}
