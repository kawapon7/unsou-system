# ドライバーアプリ機能拡充 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ドライバーが「今月いくらか」「何をやったか」「過去いくら支払われたか」を自分で確認できるようにし、料金をいただける水準にする。

**Architecture:** 既存の4タブ化（ホーム新設）。金額は例外なく `computePaymentNoticeAmounts`（正本）を通す。集計・整形は純関数に切り出して vitest で検証し、Server Action は薄いガワにする。

**Tech Stack:** Next.js App Router / Supabase (service_role + Server Actions) / Tailwind / vitest

設計書: `docs/superpowers/specs/2026-08-17-driver-app-redesign-design.md`

## Global Constraints

- 金額の算出は `utils/payment-notice-calc.ts` の `computePaymentNoticeAmounts` のみを使う。ドライバー画面用の独自計算を書かない
- 委託先IDの解決は `utils/auth.ts` の `resolveContractorId`（正本）のみを使う
- DBアクセスは Server Actions 経由のみ。クライアントからの直接クエリ禁止
- `notification_logs` / `approval_history` へ UPDATE / DELETE を書かない（INSERTのみ）
- 金額の取得失敗時に 0 円を表示しない。「取得できませんでした」と出す
- 「見込み」と「確定」を必ず文字で区別する
- スマホ視認性: 本文16px下限・金額28〜32px太字・1行1情報・タップ領域44px以上・色に依存しない
- 本番DBへのマイグレーション適用はボスの承認を得てから1本ずつ実行する
- 各タスクの完了条件: `npx tsc --noEmit` 0件 / `npx vitest run` 全passed / `npm run build` 成功

---

### Task 0: 4箇所目の委託先ID解決を正本へ寄せる

`scheduleActions.ts` が独自の解決を持っており、しかも一次ソースが `contractors.user_id`。**この列は本番16件中0件で完全に死んでいる**（実測）。そのため常に email フォールバックに落ち、`users.contractor_id` が設定済みのアカウントでもそれを無視する。

**Files:**
- Modify: `web/src/app/_actions/scheduleActions.ts:16-35`

**Interfaces:**
- Consumes: `resolveContractorId(service, usersContractorId, email)` from `@/utils/auth`
- Produces: なし（内部ヘルパーの差し替えのみ）

- [ ] **Step 1: 既存ヘルパーを正本呼び出しに置き換える**

```ts
import {
  resolveContractorId as sharedResolveContractorId,
  type ContractorLookupClient,
} from '@/utils/auth'

// ⚠️ 解決ロジックの正本は utils/auth.ts。独自実装に戻さないこと。
//    旧実装は contractors.user_id を一次ソースにしていたが、この列は
//    本番で1件も設定されておらず（実測 16件中0件）、users.contractor_id を
//    無視する原因になっていた。
async function resolveContractorId(userId: string, email?: string): Promise<string | null> {
  const service = createServiceClient()
  const { data: userRow } = await service
    .from('users').select('contractor_id').eq('id', userId).maybeSingle()
  return sharedResolveContractorId(
    service as unknown as ContractorLookupClient,
    userRow?.contractor_id,
    email ?? null,
  )
}
```

- [ ] **Step 2: 検証**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 0件 / 全passed

- [ ] **Step 3: コミット**

```bash
git add web/src/app/_actions/scheduleActions.ts
git commit -m "refactor(auth): 4箇所目の委託先ID解決を正本へ寄せる"
```

---

### Task 1: 単価内訳の純関数

実績行をタップしたとき「380個 × ¥85 = ¥32,300」と根拠を出すための計算。`calcWorkAmount` は金額しか返さないため、内訳を返す関数を隣に足す。

**Files:**
- Modify: `web/src/utils/work-amount.ts`
- Test: `web/src/utils/work-amount.test.ts`（既存に追記）

**Interfaces:**
- Consumes: `RawWorkRecord`, `PriceRuleRecord`, `calcWorkAmount` from `@/utils/work-amount`
- Produces:
```ts
export type AmountBreakdown = {
  /** 画面にそのまま出す式（例: '380個 × ¥85'） */
  formula: string
  amount:  number
}
export function describeWorkAmount(
  r: RawWorkRecord,
  rule: PriceRuleRecord | undefined,
  side: 'selling' | 'buying',
): AmountBreakdown
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe('describeWorkAmount', () => {
  const piece: PriceRuleRecord = { project_id: 'p1', calculation_type: 'piece', selling_price: 100, buying_price: 85, margin_fixed: null }

  it('個数建の内訳を式で返す', () => {
    const r = { project_id: 'p1', piece_count: 380, start_time: null, end_time: null, break_minutes: null }
    expect(describeWorkAmount(r, piece, 'buying')).toEqual({ formula: '380個 × ¥85', amount: 32300 })
  })

  it('固定建は単価そのものを出す', () => {
    const fixed: PriceRuleRecord = { project_id: 'p1', calculation_type: 'fixed', selling_price: null, buying_price: 12000, margin_fixed: null }
    const r = { project_id: 'p1', piece_count: null, start_time: null, end_time: null, break_minutes: null }
    expect(describeWorkAmount(r, fixed, 'buying')).toEqual({ formula: '固定 ¥12,000', amount: 12000 })
  })

  it('時間建は稼働時間を出す', () => {
    const hourly: PriceRuleRecord = { project_id: 'p1', calculation_type: 'hourly', selling_price: null, buying_price: 2000, margin_fixed: null }
    const r = { project_id: 'p1', piece_count: null, start_time: '2026-07-01T09:00:00Z', end_time: '2026-07-01T18:00:00Z', break_minutes: 60 }
    expect(describeWorkAmount(r, hourly, 'buying')).toEqual({ formula: '8時間 × ¥2,000', amount: 16000 })
  })

  it('単価ルールが無い場合は理由を出す（0円と黙って言わない）', () => {
    const r = { project_id: null, piece_count: 10, start_time: null, end_time: null, break_minutes: null }
    expect(describeWorkAmount(r, undefined, 'buying')).toEqual({ formula: '単価未設定', amount: 0 })
  })
})
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/utils/work-amount.test.ts` / Expected: FAIL（describeWorkAmount is not a function）

- [ ] **Step 3: 実装**

```ts
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

/**
 * calcWorkAmount と同じ計算の「根拠」を人が読める式にして返す。
 * ⚠️ 金額そのものは calcWorkAmount に委譲する。ここで再計算しないこと
 *    （式と金額が食い違うと、根拠として見せる意味が無くなる）。
 */
export function describeWorkAmount(
  r: RawWorkRecord,
  rule: PriceRuleRecord | undefined,
  side: 'selling' | 'buying',
): AmountBreakdown {
  const amount = calcWorkAmount(r, rule, side)
  if (!rule) return { formula: '単価未設定', amount }

  const price = side === 'selling' ? Number(rule.selling_price ?? 0) : Number(rule.buying_price ?? 0)

  switch (rule.calculation_type) {
    case 'piece':
      return { formula: `${r.piece_count ?? 0}個 × ${yen(price)}`, amount }
    case 'hourly': {
      if (!r.start_time || !r.end_time) return { formula: '時間未入力', amount }
      const ms    = new Date(r.end_time).getTime() - new Date(r.start_time).getTime()
      const hours = ms / 3_600_000 - (r.break_minutes ?? 0) / 60
      const shown = Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
      return { formula: `${shown}時間 × ${yen(price)}`, amount }
    }
    case 'fixed':
      return { formula: `固定 ${yen(price)}`, amount }
    case 'hybrid':
      return { formula: `固定 ${yen(price)} + ${r.piece_count ?? 0}個 × ${yen(Number(rule.margin_fixed ?? 0))}`, amount }
    default:
      return { formula: '単価未設定', amount }
  }
}
```

- [ ] **Step 4: 通過を確認** — Run: `npx vitest run src/utils/work-amount.test.ts` / Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add web/src/utils/work-amount.ts web/src/utils/work-amount.test.ts
git commit -m "feat(driver): 単価の内訳を式で返す describeWorkAmount を追加"
```

---

### Task 2: 年間サマリーの集計（純関数）

確定申告用。月別の支払通知書行を受け取り、年計を出す。

**Files:**
- Create: `web/src/utils/driver-summary.ts`
- Test: `web/src/utils/driver-summary.test.ts`

**Interfaces:**
- Produces:
```ts
export type PaymentHistoryRow = {
  noticeMonth:    string   // 'YYYY-MM-DD'
  laborNet:       number
  expenseNet:     number
  totalTax:       number
  deduction:      number   // 経過措置
  insurance:      number   // 運送保険
  totalAmount:    number
  approvalStatus: string
}
export type AnnualSummary = {
  year:            number
  laborNetTotal:   number
  expenseNetTotal: number
  taxTotal:        number
  deductionTotal:  number
  insuranceTotal:  number
  paidTotal:       number
  monthCount:      number
}
export function summarizeAnnual(year: number, rows: readonly PaymentHistoryRow[]): AnnualSummary
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest'
import { summarizeAnnual, type PaymentHistoryRow } from './driver-summary'

const row = (m: string, over: Partial<PaymentHistoryRow> = {}): PaymentHistoryRow => ({
  noticeMonth: m, laborNet: 100000, expenseNet: 5000, totalTax: 10500,
  deduction: 231, insurance: 1000, totalAmount: 114269, approvalStatus: 'approved', ...over,
})

describe('summarizeAnnual', () => {
  it('その年の行だけを合算する', () => {
    const s = summarizeAnnual(2026, [row('2026-01-01'), row('2026-02-01'), row('2025-12-01')])
    expect(s.monthCount).toBe(2)
    expect(s.laborNetTotal).toBe(200000)
    expect(s.paidTotal).toBe(228538)
  })

  it('行が無い年は全て0を返す（例外にしない）', () => {
    expect(summarizeAnnual(2024, [])).toEqual({
      year: 2024, laborNetTotal: 0, expenseNetTotal: 0, taxTotal: 0,
      deductionTotal: 0, insuranceTotal: 0, paidTotal: 0, monthCount: 0,
    })
  })

  it('未承認の月も年計に含める（支払予定として見せるため）', () => {
    const s = summarizeAnnual(2026, [row('2026-03-01', { approvalStatus: 'pending' })])
    expect(s.monthCount).toBe(1)
    expect(s.paidTotal).toBe(114269)
  })
})
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/utils/driver-summary.test.ts` / Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装**

```ts
/**
 * ドライバー向けの年間サマリー。確定申告での使用を想定する。
 * ⚠️ 年の区切りは暦年（1〜12月）。締め日ベースにしない（申告が暦年のため）。
 * ⚠️ 未承認の月も含める。「まだ承認していないから年計に出ない」と、
 *    ドライバーは自分の年収を過少に見積もることになる。
 */
export function summarizeAnnual(year: number, rows: readonly PaymentHistoryRow[]): AnnualSummary {
  const target = rows.filter(r => Number(r.noticeMonth.slice(0, 4)) === year)
  const sum = (pick: (r: PaymentHistoryRow) => number) => target.reduce((s, r) => s + pick(r), 0)
  return {
    year,
    laborNetTotal:   sum(r => r.laborNet),
    expenseNetTotal: sum(r => r.expenseNet),
    taxTotal:        sum(r => r.totalTax),
    deductionTotal:  sum(r => r.deduction),
    insuranceTotal:  sum(r => r.insurance),
    paidTotal:       sum(r => r.totalAmount),
    monthCount:      target.length,
  }
}
```

- [ ] **Step 4: 通過を確認** — Run: `npx vitest run src/utils/driver-summary.test.ts` / Expected: PASS
- [ ] **Step 5: コミット**

```bash
git add web/src/utils/driver-summary.ts web/src/utils/driver-summary.test.ts
git commit -m "feat(driver): 確定申告用の年間サマリー集計を追加"
```

---

### Task 3: 読み取り系 Server Action を driver-actions.ts に集約・新設

**Files:**
- Modify: `web/src/app/_actions/driver-actions.ts`

**Interfaces:**
- Consumes: `resolveContractorId`（Task 0 の正本）/ `computePaymentNoticeAmounts` / `describeWorkAmount`（Task 1）/ `summarizeAnnual`（Task 2）
- Produces:
```ts
export type MonthSummary = {
  yearMonth: string; workDays: number; pieceTotal: number
  estimatedAmount: number | null   // null = 取得失敗。0 と区別する
  isConfirmed: boolean             // true = 確定通知書あり
}
export async function fetchMyMonthSummary(yearMonth: string): Promise<ActionResult<MonthSummary>>

export type MyWorkRecordRow = {
  id: string; workDate: string; projectName: string
  pieceCount: number; amount: number; formula: string
}
export async function fetchMyWorkRecords(yearMonth: string): Promise<ActionResult<MyWorkRecordRow[]>>

export type UpcomingSchedule = { date: string; projectName: string; status: string }
export async function fetchMyUpcomingSchedules(limit?: number): Promise<ActionResult<UpcomingSchedule[]>>

export async function fetchMyPaymentHistory(year: number): Promise<ActionResult<{ rows: PaymentHistoryRow[]; summary: AnnualSummary }>>
export async function fetchMyAvailableYears(): Promise<ActionResult<number[]>>
```

- [ ] **Step 1: `fetchMyPaymentNotices` の `limit(12)` を外す**

現在 `.limit(12)` で直近12件に切っている。確定申告で過去を遡れないため撤廃する。年フィルタは `fetchMyPaymentHistory` 側で行う。

- [ ] **Step 2: 5つのアクションを実装する**

金額は `computePaymentNoticeAmounts` に委譲すること。失敗時は `estimatedAmount: null` を返し、画面で「取得できませんでした」と出す（0円を出さない）。

- [ ] **Step 3: 検証** — Run: `npx tsc --noEmit && npx vitest run && npm run build`
- [ ] **Step 4: コミット**

---

### Task 4: ホーム画面と4タブ化

**Files:**
- Create: `web/src/app/driver/home/page.tsx`
- Modify: `web/src/app/driver/shell.tsx`（BOTTOM_NAV に ホーム / マイページ を追加。現在マイページはリンクの無い飾り）
- Modify: `web/src/middleware.ts:70,77`（ドライバーのログイン後遷移先を `/driver/schedule` → `/driver/home` へ）

- [ ] **Step 1: `shell.tsx` の BOTTOM_NAV を4件にする**（ホーム・予定・実績・支払・マイページ）
- [ ] **Step 2: ホーム画面を作る**（見込み金額32px太字・「※確定前の見込みです」・稼働日数/個数・未承認警告・直近予定3件）
- [ ] **Step 3: middleware のリダイレクト先を変更**
- [ ] **Step 4: 検証** — tsc / vitest / build / `read_page` で `/driver/home` を確認
- [ ] **Step 5: コミット**

---

### Task 5: 予定リスト・実績リスト

**Files:**
- Modify: `web/src/app/driver/schedule/page.tsx`（上部にセグメント切替を足す。既存カレンダーの実装は変更しない）

- [ ] **Step 1: セグメント切替 `[カレンダー][予定][実績]` を足す**
- [ ] **Step 2: 予定リスト（今日以降・日付順）**
- [ ] **Step 3: 実績リスト（月切替・行タップで単価内訳を展開・月合計）**
- [ ] **Step 4: 検証・コミット**

---

### Task 6: 支払タブの年別履歴と年間サマリー

**Files:**
- Modify: `web/src/app/driver/billing/page.tsx`

- [ ] **Step 1: 年セレクタを足す**（`fetchMyAvailableYears` の結果だけを選択肢にする）
- [ ] **Step 2: 年間サマリーカード**（報酬合計・立替経費・経過措置控除・運送保険・差引支給合計）
- [ ] **Step 3: 「対象月」ラベルを「立替金の対象月」に改める**（画面全体のフィルタに見えて誤解を招いていた）
- [ ] **Step 4: PDFモーダルに「確定申告用に保存してください」を追記**
- [ ] **Step 5: 検証・コミット**

---

### Task 7: マイページ

**Files:**
- Create: `web/src/app/driver/profile/page.tsx`

氏名・メール・インボイス区分（登録/免税）・ログアウト。

⚠️ 口座情報は**表示しない**。復号してブラウザへ送る必要が生じ、暗号化保存の意味を薄める。

- [ ] **Step 1: 画面を作る** / **Step 2: 検証・コミット**

---

### Task 8: アプリ内お知らせ（マイグレーション含む・本番適用は承認後）

**Files:**
- Create: `supabase/migrations/<timestamp>_notification_reads.sql`
- Modify: `web/src/app/_actions/driver-actions.ts`
- Modify: `web/src/app/driver/shell.tsx`（未読バッジ）

⚠️ `notification_logs` は不変ログのため既読フラグを持てない。`notification_reads` を新設する。

- [ ] **Step 1: マイグレーションSQLを書く**（設計書 5-3 の DDL）
- [ ] **Step 2: `fetchMyNotifications` / `markNotificationRead` を実装**
- [ ] **Step 3: 未読バッジ**
- [ ] **Step 4: 検証**（⚠️ 本番適用前はローカルで列が無いため fail-closed になることを確認）
- [ ] **Step 5: ボスに適用承認を求める。承認後に SQL Editor で1本実行し `supabase_migrations.schema_migrations` へ記録**

---

## 実行順序

Task 0 → 1 → 2 → 3 → (4, 5, 6, 7 は並行可) → 8

Task 8 だけは本番DB適用の承認待ちが入るため最後に置く。
