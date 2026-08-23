# おおば運送様式（請求書・支払明細書）＋運送保険の委託先別 ON/OFF 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** おおば運送の実物見本（`oobaunsou_mihon/`）と同じ見た目の請求書・支払明細書を PDF（ブラウザ印刷）と Excel（.xlsx）で出せるようにし、あわせて運送保険 −1,000 円の控除を委託先ごとに ON/OFF できるようにする。

**Architecture:** 既存の発行基盤（`utils/document-formats.ts` の様式レジストリ、`issued_documents` の `format_key`/`format_version`）に様式キー `ooba` を追加する。データ取得は既存 Server Action（`fetchInvoicePdfData` / `fetchPaymentNoticePdfData`）を最小限拡張して流用し、**見せ方（束ね方・呼び名）は描画側**（`components/pdf/formats/ooba/`）で決める。Excel は雛形ファイルを読まず ExcelJS で**ブラウザ側**に組み立ててダウンロードする（Cloudflare Workers にファイル読み込みと Excel が無いため）。DB の計算は変えない。

**Tech Stack:** Next.js App Router, Supabase (service_role + `getCurrentTenantId`), React（HTML→ブラウザ印刷 PDF）, ExcelJS（新規追加・クライアント側）, vitest（node 環境）

## Global Constraints

- 実データ `oobaunsou_mihon/`（実名・電話・口座を含む）は **コミットしない**・Drive/チャットに再アップしない。検証はダミーデータで行う
- 差引支給額の組み立ては `utils/payment-notice-totals.ts` が正本。迂回しない
- 請求書の書き込みは `utils/invoice-writer.ts` 経由（本計画では書き込みを追加しない）
- 発行済み控えは発行当時の `format_key × format_version` で再描画する。旧版の描画コードは消さない
- クライアントからの DB 直接クエリ禁止。データは Server Action 経由
- マイグレーションは本番未適用のまま計画に含める。本番適用はボスが 1 ファイルずつ
- 色クラスは `nav.tsx` の `CATEGORY_STYLES` 経由（帳票本体は印刷用なので Tailwind の `text-black`/罫線程度に留める）
- コミットメッセージ末尾: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- テスト: `cd web && npx vitest run <file>`、型: `cd web && npx tsc --noEmit`

## 見本から確定した様式仕様（2026-08-23 読み取り）

### 請求書（`請求書 (株)エス.アール.シー2026年6月分.pdf`）
- 表題「請 求 書」、宛名「{荷主名} 御中」、右上に作成日・自社名・〒住所・TEL・登録番号
- 「件名： R{和暦年}．{月}月度 業務委託費」「下記の通り、ご請求申し上げます。」
- 明細表: 摘要 / 数量 / 単価 / 金額。摘要は「{案件名}」、数量は「{月}月度 {日数} 日」または「{本数}本」（個数制）
- 表外に「※人員結果は別紙参照」（作業系案件のとき）
- 小計（税抜）／消費税／合計金額（税込）、お振込先（銀行・支店・種別・口座番号・名義）
- 別紙（人員結果表）は**本計画の対象外**（次版）。文言だけ出す

### 支払明細書（`明細書 坂田 2025年11月.xlsx`・5 シート）
| シート | 内容 |
|---|---|
| 勤務報告書 | 日別: 月/日/作業内容/売上/支払額/立替金内訳/立替金額/作業時間(開始・終了・実働)/走行距離/備考 |
| 支払明細書 | 本票。支払運賃 → 調整 → 10%対象小計① → 消費税② → 相殺額（経過措置2%分・運送保険(非課税)）③ → 立替金④（うち消費税）→ 差引支給額①+②+③+④ → 備考「※送付後10日以内に御連絡が無い場合、確認済とします。」 |
| 作業明細支払書 | 日別: 月/日/作業内容/金額(税抜)/備考 |
| 立替金明細書 | 日別: 月/日/作業内容/立替金内訳/売上/立替金額/備考 |
| 利益表 | 作業日数合計/作業時間合計/売上(10%分) |

既存データで出せないもの: **走行距離**（`work_records` に列なし → 空欄）。それ以外は `PaymentNoticePdfData` の拡張（作業時間・売上）で賄える。

---

## ファイル構成

```
web/src/utils/
  transport-insurance.ts            新規: decideInsuranceDeduction（純関数）
  transport-insurance.test.ts       新規
  document-formats.ts               変更: 'ooba' を登録
  ooba-invoice-lines.ts             新規: 請求書明細の案件別集約（純関数）
  ooba-invoice-lines.test.ts        新規
  ooba-excel.ts                     新規: ExcelJS でワークブックを組む（純関数・ブラウザ/Node 両用）
  ooba-excel.test.ts                新規
web/src/components/pdf/formats/ooba/
  OobaInvoiceDocument.tsx           新規: 請求書 HTML（A4）
  OobaPaymentNoticeDocument.tsx     新規: 支払明細書 HTML（本票＋明細 = 複数ページ）
  fixtures.ts                       新規: ダミーデータ（検証・テスト用）
web/src/components/pdf/
  ExcelDownloadButton.tsx           新規: クライアントで xlsx を生成して保存
  DocumentRenderer.tsx              新規: format_key × version × kind → コンポーネント
  InvoicePdfModal.tsx               変更: DocumentRenderer 経由・Excel ボタン
  PaymentNoticePdfModal.tsx         変更: 同上
  IssuedDocumentModal.tsx           変更: DocumentRenderer 経由
web/src/app/_actions/pdf-actions.ts 変更: formatKey・件名用データ・作業時間・売上を追加
web/src/utils/payment-notice-calc.ts 変更: apply_transport_insurance を見る
web/src/app/admin/partners/page.tsx 変更: チェックボックス
supabase/migrations/20260824000000_contractors_apply_transport_insurance.sql 新規
```

---

### Task 0: 実データの除外と ExcelJS 導入

**Files:**
- Modify: `.gitignore`
- Modify: `web/package.json`

- [ ] **Step 1: `.gitignore` に追加**

`ooba/` の行（42 行目）の直後に追記:
```
oobaunsou_mihon/
```

- [ ] **Step 2: 確認**

Run: `git status --short | grep mihon`
Expected: 何も出ない（未追跡から消える）

- [ ] **Step 3: ExcelJS を追加**

Run: `cd web && npm install exceljs@^4.4.0`
Expected: `package.json` の dependencies に `"exceljs": "^4.4.0"`。`npx tsc --noEmit` が通る（型同梱）。

- [ ] **Step 4: Commit**

```bash
git add .gitignore web/package.json web/package-lock.json
git commit -m "chore: 見本ディレクトリを gitignore、ExcelJS を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: 運送保険の控除判定を純関数に切り出す

**Files:**
- Create: `web/src/utils/transport-insurance.ts`
- Test: `web/src/utils/transport-insurance.test.ts`

**Interfaces:**
- Produces: `decideInsuranceDeduction(input: { hasActivity: boolean; applies: boolean; amount: number }): number`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest'
import { decideInsuranceDeduction } from './transport-insurance'

describe('decideInsuranceDeduction', () => {
  it('稼働あり・適用ありなら設定額を引く', () => {
    expect(decideInsuranceDeduction({ hasActivity: true, applies: true, amount: 1000 })).toBe(1000)
  })
  it('委託先が適用なし（作業系など）なら稼働があっても 0', () => {
    expect(decideInsuranceDeduction({ hasActivity: true, applies: false, amount: 1000 })).toBe(0)
  })
  it('稼働も立替も無い月は適用ありでも 0（マイナス支給を作らない）', () => {
    expect(decideInsuranceDeduction({ hasActivity: false, applies: true, amount: 1000 })).toBe(0)
  })
  it('設定額 0 なら 0', () => {
    expect(decideInsuranceDeduction({ hasActivity: true, applies: true, amount: 0 })).toBe(0)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `cd web && npx vitest run src/utils/transport-insurance.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装**

```ts
// 運送保険（荷物保険）の相殺額を決める。
// ⚠️ 委託先ごとに「適用する/しない」がある（作業系の委託先は荷物を運ばないので保険なし）。
//    金額は自社設定（companies.transport_insurance_amount）で一括。
export function decideInsuranceDeduction(input: {
  /** 稼働または立替がその月にあるか。無い月は保険だけ引いてマイナス支給にしない */
  hasActivity: boolean
  /** contractors.apply_transport_insurance */
  applies: boolean
  /** companies.transport_insurance_amount */
  amount: number
}): number {
  if (!input.hasActivity || !input.applies) return 0
  return Math.max(0, input.amount)
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd web && npx vitest run src/utils/transport-insurance.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add web/src/utils/transport-insurance.ts web/src/utils/transport-insurance.test.ts
git commit -m "feat(payment): 運送保険の控除判定を純関数 decideInsuranceDeduction に分離

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `contractors.apply_transport_insurance` 列と計算への接続

**Files:**
- Create: `supabase/migrations/20260824000000_contractors_apply_transport_insurance.sql`
- Modify: `web/src/types/supabase.ts`（`contractors` の Row/Insert/Update）
- Modify: `web/src/utils/payment-notice-calc.ts:200-210`（select 列）, `:411-418`（判定）
- Test: `web/src/utils/payment-notice-calc.internal.test.ts`（既存ファイルに追記）

**Interfaces:**
- Consumes: `decideInsuranceDeduction`（Task 1）
- Produces: DB 列 `contractors.apply_transport_insurance boolean NOT NULL DEFAULT true`

- [ ] **Step 1: マイグレーションを書く**

```sql
-- 委託先ごとに運送保険（荷物保険）−1,000円の控除を適用するかどうか（2026-08-24）
-- 作業系（デバンニング等）の委託先は荷物を運ばないため保険の控除が無い。
-- 既定 true: 既存委託先は従来どおり全員控除（挙動を変えない）。作業系だけ画面で false にする。
-- 金額自体は companies.transport_insurance_amount（全社一律）のまま。
-- ⚠️ 本番適用後、確定済み payment_notices.insurance_deduction（スナップショット）は変わらない。
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS apply_transport_insurance BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.contractors.apply_transport_insurance IS
  '運送保険（荷物保険）の控除を支払通知書に適用するか。作業系委託先は false';
```

- [ ] **Step 2: 型を追加**

`web/src/types/supabase.ts` の `contractors` テーブル定義で、`Row` に `apply_transport_insurance: boolean`、`Insert`/`Update` に `apply_transport_insurance?: boolean` を、`is_internal` の行の直前に追加する（3 箇所）。

- [ ] **Step 3: 失敗するテストを追記**

`payment-notice-calc.internal.test.ts` の `fakeDb` は contractors 以外を空で返すため、稼働が無く保険判定まで到達しない。そこで select 列の要求だけを固定するテストを追加する（列を忘れると `contractor.apply_transport_insurance` が undefined → 保険が黙って 0 になる事故を防ぐ）:

```ts
describe('computePaymentNoticeAmounts / apply_transport_insurance', () => {
  it('contractors から apply_transport_insurance を読む', async () => {
    let selected = ''
    const db = {
      from: (table: string) => {
        const q: any = {
          select: (cols: string) => { if (table === 'contractors') selected = cols; return q },
          eq: () => q, gte: () => q, lte: () => q, in: () => q, order: () => q,
          single: async () => ({ data: table === 'contractors'
            ? { tax_category: 'exclusive', invoice_registration_type: '免税', has_withholding: false, closing_day: '月末', is_internal: true, apply_transport_insurance: false }
            : null, error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        }
        return q
      },
    }
    await computePaymentNoticeAmounts(db as any, { tenantId: 't', contractorId: 'c', yearMonth: '2026-08' })
    expect(selected).toContain('apply_transport_insurance')
  })
})
```

- [ ] **Step 4: 失敗を確認**

Run: `cd web && npx vitest run src/utils/payment-notice-calc.internal.test.ts`
Expected: 新テストが FAIL（`selected` に列名が無い）

- [ ] **Step 5: 計算側を変更**

`payment-notice-calc.ts:203` の select を
```ts
    .select('tax_category, invoice_registration_type, has_withholding, closing_day, is_internal, apply_transport_insurance')
```
に変更。`:411-418` を次に置き換える（import に `import { decideInsuranceDeduction } from '@/utils/transport-insurance'` を追加）:

```ts
  // 運送保険（委託先負担・非課税）。相殺額合計にだけ積む。
  // ⚠️ fail-closed。取得できなければ止める（相殺し忘れた通知書を出さないため）
  const insuranceRes = await getTransportInsuranceAmount(tenantId)
  if (insuranceRes.error !== null) return { data: null, error: insuranceRes.error }
  // 稼働も立替も無い月は保険だけを相殺してマイナス支給にしない。
  // 委託先ごとの適用有無（作業系は無し）は contractors.apply_transport_insurance。
  // ⚠️ 列が読めていない（undefined）場合は fail-closed で止める。黙って 0 にしない。
  if (typeof contractor.apply_transport_insurance !== 'boolean') {
    return { data: null, error: '委託先の運送保険設定（apply_transport_insurance）が読めません' }
  }
  const hasActivity = laborTaxExcluded > 0 || expenseTaxExcluded > 0
  const insuranceDeduction = decideInsuranceDeduction({
    hasActivity, applies: contractor.apply_transport_insurance, amount: insuranceRes.amount,
  })
```

- [ ] **Step 6: テスト・型**

Run: `cd web && npx vitest run src/utils && npx tsc --noEmit`
Expected: すべて passed、型エラー 0

- [ ] **Step 7: ローカル DB に適用して支払通知書が出ることを確認**

Run（ローカル Supabase を使っている場合）: `supabase db push` または SQL Editor で Step 1 を実行。
その後 `/admin/billing` の支払(OUT)で任意の委託先を生成し、運送保険 1,000 が従来どおり引かれていることを `read_page` で確認。

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260824000000_contractors_apply_transport_insurance.sql web/src/types/supabase.ts web/src/utils/payment-notice-calc.ts web/src/utils/payment-notice-calc.internal.test.ts
git commit -m "feat(payment): 運送保険の控除を委託先ごとに ON/OFF（contractors.apply_transport_insurance）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 委託先フォームに「運送保険を控除する」チェック

**Files:**
- Modify: `web/src/app/admin/partners/page.tsx:112,134,387-395,915,954,1012`

- [ ] **Step 1: フォーム型・初期値に追加**

`:112` 付近の型 `is_internal: boolean` の次行に `apply_transport_insurance: boolean`、`:134` 付近の初期値 `is_internal: false,` の次行に `apply_transport_insurance: true,`。

- [ ] **Step 2: チェックボックスを追加**

`is_internal` の `<Field label="区分">` ブロックの直後に:

```tsx
        <Field label="運送保険">
          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={form.apply_transport_insurance}
              onChange={e => set('apply_transport_insurance', e.target.checked)}
            />
            <span>
              運送保険（荷物保険）を支払明細で控除する
              <span className="block text-xs text-zinc-500">
                作業系（デバンニング等）で荷物を運ばない委託先は外してください。金額は「自社情報」の設定値（既定 1,000 円）です。
              </span>
            </span>
          </label>
        </Field>
```

- [ ] **Step 3: 読み込みと保存に追加**

`:915` 付近（編集時にフォームへ詰める箇所）の `is_internal: Boolean((row as any).is_internal),` の次に
```ts
      apply_transport_insurance: (row as any).apply_transport_insurance !== false,
```
`:954` 付近の payload の `is_internal: form.is_internal,` の次に
```ts
      apply_transport_insurance: form.apply_transport_insurance,
```
一覧（`:1012` 付近の `is_internal` バッジ）の隣に、`false` のとき `<span className="text-xs text-zinc-500">保険なし</span>` を出す。

- [ ] **Step 4: `createContractor` / `updateContractor` が列を通すか確認**

Run: `grep -n "is_internal" web/src/app/admin/partners/actions.ts`
Expected: 何も出ない＝payload をそのまま insert/update している → 追加作業なし。出る場合は同じ箇所に `apply_transport_insurance` を並べる。

- [ ] **Step 5: 画面確認**

`/admin/partners` で委託先を編集 → チェックを外して保存 → 再度開いて外れたままか `read_page` で確認。支払(OUT)でその委託先を生成し、運送保険が 0 になることを確認。

- [ ] **Step 6: Commit**

```bash
git add web/src/app/admin/partners/page.tsx web/src/app/admin/partners/actions.ts
git commit -m "feat(partners): 委託先フォームに運送保険の控除 ON/OFF を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 様式レジストリに `ooba` を登録し、PDF データに様式キーと追加項目を載せる

**Files:**
- Modify: `web/src/utils/document-formats.ts:16-18`
- Modify: `web/src/app/_actions/pdf-actions.ts`（`InvoicePdfData`, `LaborPdfLine`, `PaymentNoticePdfData` と取得処理）
- Test: `web/src/utils/document-formats.test.ts`（既存に追記）

**Interfaces:**
- Produces:
  - `DOCUMENT_FORMATS.ooba = { key: 'ooba', version: 1, label: 'おおば運送様式', kinds: ['invoice','payment_notice'] }`
  - `InvoicePdfData.formatKey: string`（解決済み様式キー）、`InvoicePdfData.yearMonth: string`（`'YYYY-MM'`。引数をそのまま入れる）、`InvoicePdfData.subject: string`（件名。例 `R8．6月度 業務委託費`）、`InvoicePdfData.noteLines: string[]`（備考。作業系案件があれば `※人員結果は別紙参照`）
  - `InvoicePdfLine.pieceCount: number | null`（個数制の本数。日数制は null）
  - `LaborPdfLine.startTime: string | null`, `endTime: string | null`, `breakMinutes: number | null`, `sellingAmount: number`（売上・税抜）
  - `PaymentNoticePdfData.formatKey: string`, `manualAdjustment: number`

- [ ] **Step 1: レジストリのテストを追記**

```ts
it('ooba 様式は請求書・支払通知書の両方に使える', () => {
  expect(resolveDocumentFormat('invoice', { companyKey: 'ooba' }).key).toBe('ooba')
  expect(resolveDocumentFormat('payment_notice', { companyKey: 'ooba' }).key).toBe('ooba')
  expect(listDocumentFormatOptions('invoice').map(o => o.key)).toContain('ooba')
})
```

Run: `cd web && npx vitest run src/utils/document-formats.test.ts` → FAIL

- [ ] **Step 2: レジストリに追加**

```ts
export const DOCUMENT_FORMATS: Record<string, DocumentFormat> = {
  standard: { key: 'standard', version: 1, label: '標準様式', kinds: ['invoice', 'payment_notice'] },
  // おおば運送の実物様式（2026-08-23 見本）。描画は components/pdf/formats/ooba/、Excel は utils/ooba-excel.ts
  ooba:     { key: 'ooba',     version: 1, label: 'おおば運送様式', kinds: ['invoice', 'payment_notice'] },
}
```

Run: 同上 → PASS

- [ ] **Step 3: 請求書データを拡張**

`pdf-actions.ts` の型:
```ts
export type InvoicePdfLine = {
  workDate:    string
  projectName: string
  quantity:    number
  netAmount:   number
  /** 個数制（per_piece）の本数。日数制は null。おおば様式の「○本」表記に使う */
  pieceCount:  number | null
  /** 作業系（デバンニング等）の案件か。おおば様式で「※人員結果は別紙参照」を出す判定 */
  isWorkType:  boolean
}
export type InvoicePdfData = {
  // …既存…
  /** 解決済みの様式キー（荷主指定 → 会社標準 → standard） */
  formatKey:     string
  /** 件名（おおば様式）。例: 'R8．6月度 業務委託費' */
  subject:       string
  /** 欄外の備考行 */
  noteLines:     string[]
}
```

`fetchInvoicePdfData` 内:
- `clients` の select に `document_format_key` を追加、`companies` 側は `getCompanyInfo` が返す `CompanyInfo` に `document_format_key` が無ければ `service.from('companies').select('document_format_key').eq('tenant_id', tenantId).maybeSingle()` を `Promise.all` に追加する
- `projectsRes` の select に `payment_type`（`project_payees` ではなく `projects` に `category` 等があればそれ。無ければ `price_rules` の `payment_type` を `ruleMap` から引く）。**作業系の判定は `projects.name` に「作業」「デバンニング」を含むか**を v1 の規則とし、関数 `isWorkTypeProject(name: string): boolean` を `utils/ooba-invoice-lines.ts`（Task 5）に置く。ここでは `lines` 生成時に `pieceCount: r.piece_count ?? null` と `isWorkType: isWorkTypeProject(projectName)` を入れる
- `yearMonth`（引数 `yearMonth` をそのまま）
- `formatKey: resolveDocumentFormat('invoice', { clientKey: client.document_format_key, companyKey: companyFormatKey }).key`
- `subject`: `utils/ooba-invoice-lines.ts` の `buildOobaSubject(yearMonth)` を使う（Task 5 で定義。`'2026-06'` → `'R8．6月度 業務委託費'`）
- `noteLines`: `lines.some(l => l.isWorkType) ? ['※人員結果は別紙参照'] : []`

- [ ] **Step 4: 支払通知書データを拡張**

```ts
export type LaborPdfLine = {
  workDate:      string
  projectName:   string
  quantity:      number
  netAmount:     number
  /** 勤務報告書シート用。work_records.start_time / end_time / break_minutes */
  startTime:     string | null
  endTime:       string | null
  breakMinutes:  number | null
  /** 荷主への売上（税抜）。calcWorkAmount(r, rule, 'selling') */
  sellingAmount: number
}
export type PaymentNoticePdfData = {
  // …既存…
  formatKey:        string
  /** 手入力調整額だけ（adjustment には自動補正＋手入力が入っている） */
  manualAdjustment: number
}
```
`fetchPaymentNoticePdfData` で `work_records` の select に `start_time, end_time, break_minutes` を追加し、`laborLines` を作る map で上記 4 項目を埋める（`sellingAmount: calcWorkAmount(r, rule, 'selling')`）。`formatKey` は `companies.document_format_key`（支払通知書は会社標準のみ）を `resolveDocumentFormat('payment_notice', { companyKey })` で解決。`manualAdjustment` は `computePaymentNoticeAmounts` の戻り `manualAdjustment` をそのまま。

- [ ] **Step 5: 型チェックと既存テスト**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: 0 errors、既存テスト全 pass（`InvoiceDocument.tsx` / `PaymentNoticeDocument.tsx` は追加項目を無視するので変更不要）。`phantom-columns.test.ts` が新しい select 列（`start_time` 等）を実在列として認めることを確認。

- [ ] **Step 6: Commit**

```bash
git add web/src/utils/document-formats.ts web/src/utils/document-formats.test.ts web/src/app/_actions/pdf-actions.ts
git commit -m "feat(documents): 様式 ooba を登録し PDF データに様式キー・件名・作業時間・売上を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 請求書明細の案件別集約と件名（純関数）

**Files:**
- Create: `web/src/utils/ooba-invoice-lines.ts`
- Test: `web/src/utils/ooba-invoice-lines.test.ts`

**Interfaces:**
- Consumes: `InvoicePdfLine`（Task 4）
- Produces:
  ```ts
  export type OobaInvoiceRow = { no: number; description: string; quantityLabel: string; unitPrice: number; amount: number }
  export function aggregateOobaInvoiceRows(lines: InvoicePdfLine[], yearMonth: string): OobaInvoiceRow[]
  export function buildOobaSubject(yearMonth: string): string   // 'R8．6月度 業務委託費'
  export function toReiwa(year: number): number                  // 2026 → 8
  export function isWorkTypeProject(name: string): boolean
  ```

- [ ] **Step 1: 失敗するテスト**

```ts
import { describe, it, expect } from 'vitest'
import { aggregateOobaInvoiceRows, buildOobaSubject, toReiwa, isWorkTypeProject } from './ooba-invoice-lines'

const line = (p: Partial<import('@/app/_actions/pdf-actions').InvoicePdfLine>) => ({
  workDate: '2026-06-01', projectName: 'X', quantity: 1, netAmount: 0, pieceCount: null, isWorkType: false, ...p,
})

describe('ooba-invoice-lines', () => {
  it('令和変換', () => { expect(toReiwa(2026)).toBe(8); expect(toReiwa(2019)).toBe(1) })
  it('件名', () => { expect(buildOobaSubject('2026-06')).toBe('R8．6月度 業務委託費') })
  it('作業系判定', () => {
    expect(isWorkTypeProject('協和冷蔵デバンニング作業')).toBe(true)
    expect(isWorkTypeProject('フジフィルム 2t配送')).toBe(false)
  })
  it('日数制は案件ごとに日数で束ね、単価は金額÷日数', () => {
    const rows = aggregateOobaInvoiceRows([
      line({ projectName: '(有)好川商通 安佐北区飯室荷役作業', netAmount: 12000 }),
      line({ projectName: '(有)好川商通 安佐北区飯室荷役作業', netAmount: 12000, workDate: '2026-06-02' }),
    ], '2026-06')
    expect(rows).toEqual([{ no: 1, description: '(有)好川商通 安佐北区飯室荷役作業', quantityLabel: '6月度 2 日', unitPrice: 12000, amount: 24000 }])
  })
  it('個数制は本数で束ね、同じ案件でも本数が違えば別行', () => {
    const rows = aggregateOobaInvoiceRows([
      line({ projectName: '協和冷蔵デバンニング作業', pieceCount: 1, quantity: 1, netAmount: 16000 }),
      line({ projectName: '協和冷蔵デバンニング作業', pieceCount: 2, quantity: 2, netAmount: 26000 }),
      line({ projectName: '協和冷蔵デバンニング作業', pieceCount: 2, quantity: 2, netAmount: 26000, workDate: '2026-06-03' }),
    ], '2026-06')
    expect(rows.map(r => [r.description, r.quantityLabel, r.unitPrice, r.amount])).toEqual([
      ['協和冷蔵デバンニング作業 1本', '6月度 1 日', 16000, 16000],
      ['協和冷蔵デバンニング作業 2本', '6月度 2 日', 13000, 52000],
    ])
  })
})
```

Run: `cd web && npx vitest run src/utils/ooba-invoice-lines.test.ts` → FAIL

- [ ] **Step 2: 実装**

```ts
import type { InvoicePdfLine } from '@/app/_actions/pdf-actions'

export type OobaInvoiceRow = {
  no: number
  description: string
  quantityLabel: string
  unitPrice: number
  amount: number
}

export function toReiwa(year: number): number { return year - 2018 }

export function buildOobaSubject(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  return `R${toReiwa(y)}．${m}月度 業務委託費`
}

// v1 の規則: 案件名に作業系の語を含むか。将来は projects にカテゴリ列を持たせて置き換える
const WORK_TYPE_WORDS = ['作業', 'デバンニング', '荷役']
export function isWorkTypeProject(name: string): boolean {
  return WORK_TYPE_WORDS.some(w => name.includes(w))
}

/**
 * おおば様式の請求書明細: 案件（＋本数）ごとに束ね、数量は「○月度 ○日」。
 * ⚠️ 単価は 金額÷日数 の割り戻し（price_rules を直接見ない）。日によって単価が違う案件は
 *    割り切れない単価になる → その場合は Math.round し、amount は実額を保つ（合計が狂わない）。
 */
export function aggregateOobaInvoiceRows(lines: InvoicePdfLine[], yearMonth: string): OobaInvoiceRow[] {
  const month = Number(yearMonth.split('-')[1])
  const groups = new Map<string, { description: string; days: number; amount: number }>()
  for (const l of lines) {
    const suffix = l.pieceCount && l.pieceCount > 0 ? ` ${l.pieceCount}本` : ''
    const description = `${l.projectName}${suffix}`
    const g = groups.get(description) ?? { description, days: 0, amount: 0 }
    g.days += 1
    g.amount += l.netAmount
    groups.set(description, g)
  }
  return [...groups.values()].map((g, i) => ({
    no: i + 1,
    description: g.description,
    quantityLabel: `${month}月度 ${g.days} 日`,
    unitPrice: g.days > 0 ? Math.round(g.amount / g.days) : 0,
    amount: g.amount,
  }))
}
```

Run: 同上 → 5 passed

- [ ] **Step 3: Commit**

```bash
git add web/src/utils/ooba-invoice-lines.ts web/src/utils/ooba-invoice-lines.test.ts
git commit -m "feat(documents): おおば様式の請求書明細集約と件名生成

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: ダミーデータ（fixtures）

**Files:**
- Create: `web/src/components/pdf/formats/ooba/fixtures.ts`

**Interfaces:**
- Produces: `OOBA_INVOICE_FIXTURE: InvoicePdfData`, `OOBA_PAYMENT_NOTICE_FIXTURE: PaymentNoticePdfData`（見本と同じ構成・**架空の名前と数値**）

- [ ] **Step 1: 作成**

```ts
import type { InvoicePdfData, PaymentNoticePdfData } from '@/app/_actions/pdf-actions'
import type { CompanyInfo } from '@/utils/company'

// ⚠️ 検証専用の架空データ。実名・実在の口座・登録番号を入れない。
const COMPANY: CompanyInfo = {
  name: '株式会社テスト運送', invoiceRegNumber: 'T0000000000000', postalCode: '000-0000',
  address: '広島市テスト区1-2-3', phone: '000-0000-0000', email: 'test@example.com',
  bank: { bankName: 'テスト銀行', bankBranch: 'テスト支店', accountType: '普通', accountNumber: '0000000', accountHolder: 'カ）テストウンソウ' },
}

export const OOBA_INVOICE_FIXTURE: InvoicePdfData = {
  invoiceNumber: 'INV-202606-0001', issueDate: '2026-07-06', dueDate: '2026-07-31',
  clientName: '株式会社テスト荷主', contactName: null, invoiceMonth: '2026年06月分',
  yearMonth: '2026-06', formatKey: 'ooba', subject: 'R8．6月度 業務委託費', noteLines: ['※人員結果は別紙参照'],
  lines: [
    ...Array.from({ length: 14 }, (_, i) => ({ workDate: `2026-06-${String(i + 1).padStart(2, '0')}`, projectName: 'Aデバンニング作業', quantity: 1, netAmount: 16000, pieceCount: 1, isWorkType: true })),
    ...Array.from({ length: 4 },  (_, i) => ({ workDate: `2026-06-${String(i + 15).padStart(2, '0')}`, projectName: 'Aデバンニング作業', quantity: 2, netAmount: 26000, pieceCount: 2, isWorkType: true })),
    ...Array.from({ length: 22 }, (_, i) => ({ workDate: `2026-06-${String(i + 1).padStart(2, '0')}`, projectName: 'B荷役作業', quantity: 1, netAmount: 12000, pieceCount: null, isWorkType: true })),
  ],
  netTotal: 14 * 16000 + 4 * 26000 + 22 * 12000, taxAmount: 0, totalAmount: 0, isTaxable: true, company: COMPANY,
}
OOBA_INVOICE_FIXTURE.taxAmount   = Math.round(OOBA_INVOICE_FIXTURE.netTotal * 0.1)
OOBA_INVOICE_FIXTURE.totalAmount = OOBA_INVOICE_FIXTURE.netTotal + OOBA_INVOICE_FIXTURE.taxAmount

export const OOBA_PAYMENT_NOTICE_FIXTURE: PaymentNoticePdfData = {
  contractorName: 'テスト 太郎', invoiceRegistration: 'unregistered', noticeMonth: '2025年11月分', issueDate: '2026-01-15',
  formatKey: 'ooba',
  laborLines: Array.from({ length: 18 }, (_, i) => ({
    workDate: `2025-11-${String(i + 1).padStart(2, '0')}`, projectName: 'C配送 2t', quantity: 1, netAmount: 12728,
    startTime: '08:00', endTime: '17:00', breakMinutes: 60, sellingAmount: 16000,
  })),
  expenseLines: [],
  laborNet: 229104, laborTax: 22910, expenseNet: 0, expenseTax: 0,
  deductionRate: 0.02, deduction: 5040, insuranceDeduction: 1000, adjustment: -13, manualAdjustment: -13,
  totalAmount: 229104 - 13 + 22910 - 5040 - 1000, company: COMPANY,
}
```

- [ ] **Step 2: 型チェック**

Run: `cd web && npx tsc --noEmit` → 0 errors（`CompanyInfo` の必須項目が足りなければ追加）

- [ ] **Step 3: Commit**

```bash
git add web/src/components/pdf/formats/ooba/fixtures.ts
git commit -m "test(documents): おおば様式のダミーデータ

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: おおば様式 請求書 HTML

**Files:**
- Create: `web/src/components/pdf/formats/ooba/OobaInvoiceDocument.tsx`

**Interfaces:**
- Consumes: `InvoicePdfData`（Task 4）, `aggregateOobaInvoiceRows`（Task 5）
- Produces: `export function OobaInvoiceDocument({ data }: { data: InvoicePdfData })`

- [ ] **Step 1: 実装**

既存 `InvoiceDocument.tsx` の A4 ラッパ（`a4-page w-[794px] bg-white`）と `yen` 整形を踏襲する。

```tsx
import type { InvoicePdfData } from '@/app/_actions/pdf-actions'
import { aggregateOobaInvoiceRows } from '@/utils/ooba-invoice-lines'

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
const jpDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${y}年${m}月${d}日` }

/** おおば運送様式 請求書 v1（2026-08-23 見本）。見た目を変えたら document-formats.ts の version を上げ、旧版を残す */
export function OobaInvoiceDocument({ data }: { data: InvoicePdfData }) {
  const rows = aggregateOobaInvoiceRows(data.lines, data.yearMonth)
  const c = data.company
  return (
    <div className="a4-page w-[794px] bg-white p-12 text-[12px] text-black leading-tight">
      <h1 className="text-center text-2xl tracking-[0.5em] mb-6">請 求 書</h1>
      <div className="flex justify-between mb-4">
        <div>
          <p className="text-lg border-b border-black inline-block pr-8">{data.clientName} 御中</p>
          <p className="mt-4">件名： {data.subject}</p>
          <p className="mt-1">下記の通り、ご請求申し上げます。</p>
        </div>
        <div className="text-right">
          <p>作成日 {jpDate(data.issueDate)}</p>
          <p className="mt-2 font-semibold">{c.name}</p>
          <p>〒{c.postalCode}</p>
          <p>{c.address}</p>
          <p>TEL： {c.phone}</p>
          <p>登録番号 {c.invoiceRegNumber}</p>
        </div>
      </div>
      <p className="text-lg mb-3">合計金額 <span className="font-bold underline">{yen(data.totalAmount)}</span> （税込）</p>
      <table className="w-full border-collapse border border-black">
        <thead>
          <tr className="bg-zinc-100">
            <th className="border border-black w-8"></th>
            <th className="border border-black">摘要</th>
            <th className="border border-black w-28">数量</th>
            <th className="border border-black w-20">単価</th>
            <th className="border border-black w-28">金額</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.no}>
              <td className="border border-black text-center">{['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'][r.no - 1] ?? r.no}</td>
              <td className="border border-black px-2">{r.description}</td>
              <td className="border border-black text-center">{r.quantityLabel}</td>
              <td className="border border-black text-right px-2">{r.unitPrice.toLocaleString('ja-JP')}</td>
              <td className="border border-black text-right px-2">{yen(r.amount)}</td>
            </tr>
          ))}
          {Array.from({ length: Math.max(0, 10 - rows.length) }).map((_, i) => (
            <tr key={`e${i}`}><td className="border border-black h-6"></td><td className="border border-black"></td><td className="border border-black"></td><td className="border border-black"></td><td className="border border-black"></td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={4} className="border border-black text-right px-2">小計</td><td className="border border-black text-right px-2">{yen(data.netTotal)}</td></tr>
          <tr><td colSpan={4} className="border border-black text-right px-2">消費税</td><td className="border border-black text-right px-2">{yen(data.taxAmount)}</td></tr>
          <tr><td colSpan={4} className="border border-black text-right px-2 font-bold">合計</td><td className="border border-black text-right px-2 font-bold">{yen(data.totalAmount)}</td></tr>
        </tfoot>
      </table>
      {data.noteLines.map(n => <p key={n} className="mt-2">{n}</p>)}
      <div className="mt-6 border border-black p-2 w-2/3">
        <p className="font-semibold">お振込先</p>
        <p>{c.bank.bankName} {c.bank.bankBranch}　{c.bank.accountType}　{c.bank.accountNumber}</p>
        <p>{c.bank.accountHolder}</p>
      </div>
      <div className="mt-4"><p>備考</p></div>
    </div>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `cd web && npx tsc --noEmit` → 0

- [ ] **Step 3: Commit**

```bash
git add web/src/components/pdf/formats/ooba/OobaInvoiceDocument.tsx
git commit -m "feat(documents): おおば様式 請求書 HTML v1

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: おおば様式 支払明細書 HTML（本票＋勤務報告書＋作業明細＋立替金明細）

**Files:**
- Create: `web/src/components/pdf/formats/ooba/OobaPaymentNoticeDocument.tsx`

**Interfaces:**
- Consumes: `PaymentNoticePdfData`（Task 4）
- Produces: `export function OobaPaymentNoticeDocument({ data }: { data: PaymentNoticePdfData })` — 4 ページ（見本の「利益表」は社内用なので PDF に含めず Excel のみ）

- [ ] **Step 1: 実装**

```tsx
import type { PaymentNoticePdfData, LaborPdfLine } from '@/app/_actions/pdf-actions'

const yen = (n: number) => n.toLocaleString('ja-JP')
const md = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return { m, d } }
const workMinutes = (l: LaborPdfLine) => {
  if (!l.startTime || !l.endTime) return null
  const [sh, sm] = l.startTime.split(':').map(Number); const [eh, em] = l.endTime.split(':').map(Number)
  return Math.max(0, eh * 60 + em - (sh * 60 + sm) - (l.breakMinutes ?? 0))
}
const hhmm = (min: number | null) => min === null ? '' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`

const Page = ({ children }: { children: React.ReactNode }) => (
  <div className="a4-page w-[794px] bg-white p-10 text-[11px] text-black leading-tight" style={{ pageBreakAfter: 'always' }}>{children}</div>
)
const Th = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => <th className={`border border-black px-1 bg-zinc-100 ${className}`}>{children}</th>
const Td = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => <td className={`border border-black px-1 ${className}`}>{children}</td>

/** おおば運送様式 支払明細書 v1（2026-08-23 見本）。本票の項目番号①〜④と差引式は見本どおり */
export function OobaPaymentNoticeDocument({ data }: { data: PaymentNoticePdfData }) {
  const c = data.company
  const subtotal10 = data.laborNet + data.adjustment            // 10%対象小計【①】（調整込み）
  const tax10      = data.laborTax                               // 消費税額【②】
  const offsetTotal = -(data.deduction + data.insuranceDeduction) // 相殺額合計【③】
  const expenseTotal = data.expenseNet + data.expenseTax         // 立替金合計【④】
  const monthLabel = data.noticeMonth.replace(/^(\d{4})年0?(\d+)月分$/, '$2月度')
  const sellingTotal = data.laborLines.reduce((s, l) => s + l.sellingAmount, 0)

  return (
    <>
      {/* ── 支払明細書（本票） ── */}
      <Page>
        <h1 className="text-xl mb-4">支払明細書</h1>
        <div className="flex justify-between">
          <div>
            <p className="text-base">　{data.contractorName}　様</p>
            <p className="mt-3">（{data.noticeMonth}）</p>
          </div>
          <div className="text-right">
            <p>{data.issueDate.replace(/-/g, '/')}</p>
            <p>〒{c.postalCode}</p><p>{c.address}</p><p className="font-semibold">{c.name}</p><p>℡{c.phone}</p>
            <p>登録番号 {c.invoiceRegNumber}</p>
          </div>
        </div>
        <table className="w-full border-collapse mt-4">
          <thead><tr><Th className="w-24"></Th><Th></Th><Th className="w-32">金額</Th></tr></thead>
          <tbody>
            <tr><Td>支払額</Td><Td>支払運賃</Td><Td className="text-right">{yen(data.laborNet)}</Td></tr>
            <tr><Td></Td><Td>調整</Td><Td className="text-right">{data.adjustment === 0 ? '' : yen(data.adjustment)}</Td></tr>
            <tr><Td></Td><Td>10%対象小計【①】</Td><Td className="text-right">{yen(subtotal10)}</Td></tr>
            <tr><Td></Td><Td>消費税額（10％）【②】</Td><Td className="text-right">{yen(tax10)}</Td></tr>
            <tr><Td>相殺額</Td><Td>{Math.round(data.deductionRate * 100)}%分</Td><Td className="text-right">{data.deduction === 0 ? '' : yen(-data.deduction)}</Td></tr>
            <tr><Td></Td><Td>運送保険 (非課税）</Td><Td className="text-right">{data.insuranceDeduction === 0 ? '' : yen(-data.insuranceDeduction)}</Td></tr>
            <tr><Td></Td><Td>相殺額合計【③】</Td><Td className="text-right">{yen(offsetTotal)}</Td></tr>
            <tr><Td colSpan={2}>立替金（高速料金、駐車場代　他　）</Td><Td className="text-right">{yen(data.expenseNet)}</Td></tr>
            <tr><Td colSpan={2}>うち消費税額（10％）</Td><Td className="text-right">{yen(data.expenseTax)}</Td></tr>
            <tr><Td colSpan={2}>立替金合計【④】</Td><Td className="text-right">{yen(expenseTotal)}</Td></tr>
            <tr><Td colSpan={2} className="font-bold">差引支給額【①+②+③+④】（税込）</Td><Td className="text-right font-bold">{yen(data.totalAmount)}</Td></tr>
          </tbody>
        </table>
        <p className="mt-3">備考　※送付後10日以内に御連絡が無い場合、確認済とします。</p>
      </Page>

      {/* ── 勤務報告書 ── */}
      <Page>
        <h1 className="text-lg mb-2">{monthLabel}勤務報告書（{data.contractorName}）</h1>
        <table className="w-full border-collapse">
          <thead>
            <tr><Th>月</Th><Th>日</Th><Th>作業内容</Th><Th>売上</Th><Th>支払額</Th><Th>立替金内訳</Th><Th>立替金額</Th><Th>開始</Th><Th>終了</Th><Th>実働時間</Th><Th>走行距離</Th><Th>備考</Th></tr>
          </thead>
          <tbody>
            {data.laborLines.map((l, i) => { const { m, d } = md(l.workDate); return (
              <tr key={i}><Td>{m}</Td><Td>{d}</Td><Td>{l.projectName}</Td><Td className="text-right">{yen(l.sellingAmount)}</Td><Td className="text-right">{yen(l.netAmount)}</Td><Td></Td><Td></Td><Td>{l.startTime ?? ''}</Td><Td>{l.endTime ?? ''}</Td><Td>{hhmm(workMinutes(l))}</Td><Td></Td><Td></Td></tr>
            )})}
            {data.expenseLines.map((e, i) => { const { m, d } = md(e.expenseDate); return (
              <tr key={`x${i}`}><Td>{m}</Td><Td>{d}</Td><Td></Td><Td></Td><Td></Td><Td>{e.expenseType}</Td><Td className="text-right">{yen(e.netAmount + e.taxAmount)}</Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td></tr>
            )})}
            <tr className="font-bold"><Td colSpan={3}>合計</Td><Td className="text-right">{yen(sellingTotal)}</Td><Td className="text-right">{yen(data.laborNet)}</Td><Td></Td><Td className="text-right">{yen(data.expenseNet + data.expenseTax)}</Td><Td colSpan={5}></Td></tr>
          </tbody>
        </table>
      </Page>

      {/* ── 作業明細支払書 ── */}
      <Page>
        <h1 className="text-lg mb-2">作業明細支払書</h1>
        <table className="w-full border-collapse">
          <thead><tr><Th>月</Th><Th>日</Th><Th>作業内容</Th><Th>金額（税抜）</Th><Th>備考</Th></tr></thead>
          <tbody>
            {data.laborLines.map((l, i) => { const { m, d } = md(l.workDate); return (
              <tr key={i}><Td>{m}</Td><Td>{d}</Td><Td>{l.projectName}</Td><Td className="text-right">{yen(l.netAmount)}</Td><Td></Td></tr>
            )})}
            <tr className="font-bold"><Td colSpan={3}>合計</Td><Td className="text-right">{yen(data.laborNet)}</Td><Td></Td></tr>
          </tbody>
        </table>
      </Page>

      {/* ── 立替金明細書 ── */}
      <Page>
        <h1 className="text-lg mb-2">立替金明細書</h1>
        <table className="w-full border-collapse">
          <thead><tr><Th>月</Th><Th>日</Th><Th>作業内容</Th><Th>立替金内訳</Th><Th>売上</Th><Th>立替金額</Th><Th>備考</Th></tr></thead>
          <tbody>
            {data.expenseLines.map((e, i) => { const { m, d } = md(e.expenseDate); return (
              <tr key={i}><Td>{m}</Td><Td>{d}</Td><Td></Td><Td>{e.expenseType}</Td><Td></Td><Td className="text-right">{yen(e.netAmount + e.taxAmount)}</Td><Td></Td></tr>
            )})}
            <tr className="font-bold"><Td colSpan={5}>合計</Td><Td className="text-right">{yen(data.expenseNet + data.expenseTax)}</Td><Td></Td></tr>
          </tbody>
        </table>
      </Page>
    </>
  )
}
```

⚠️ 本票の①は見本では「支払運賃＋調整」。`data.laborNet` が税抜労務合計、`data.adjustment` が調整（自動＋手入力）。`totalAmount` は `payment-notice-totals.ts` の値をそのまま印字し、**ここで再計算して上書きしない**（見本の式と一致することは Task 10 の突合で確認）。

- [ ] **Step 2: 型チェック**

Run: `cd web && npx tsc --noEmit` → 0

- [ ] **Step 3: Commit**

```bash
git add web/src/components/pdf/formats/ooba/OobaPaymentNoticeDocument.tsx
git commit -m "feat(documents): おおば様式 支払明細書 HTML v1（本票・勤務報告書・作業明細・立替金明細）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 様式ルーターと各モーダルの接続（発行控えの再表示を含む）

**Files:**
- Create: `web/src/components/pdf/DocumentRenderer.tsx`
- Modify: `web/src/components/pdf/InvoicePdfModal.tsx`, `PaymentNoticePdfModal.tsx`, `IssuedDocumentModal.tsx:14-25`

**Interfaces:**
- Produces: `export function DocumentRenderer(props: { kind: 'invoice'; formatKey: string; formatVersion: number; data: InvoicePdfData } | { kind: 'payment_notice'; formatKey: string; formatVersion: number; data: PaymentNoticePdfData })`

- [ ] **Step 1: ルーターを作る**

```tsx
'use client'
import { InvoiceDocument } from './InvoiceDocument'
import { PaymentNoticeDocument } from './PaymentNoticeDocument'
import { OobaInvoiceDocument } from './formats/ooba/OobaInvoiceDocument'
import { OobaPaymentNoticeDocument } from './formats/ooba/OobaPaymentNoticeDocument'
import type { InvoicePdfData, PaymentNoticePdfData } from '@/app/_actions/pdf-actions'

type Props =
  | { kind: 'invoice';        formatKey: string; formatVersion: number; data: InvoicePdfData }
  | { kind: 'payment_notice'; formatKey: string; formatVersion: number; data: PaymentNoticePdfData }

/**
 * format_key × format_version × kind で描画コンポーネントを選ぶ唯一の場所。
 * ⚠️ 様式の版を上げたら旧版の分岐を消さない（発行済み控えはその版で再表示する）。
 */
export function DocumentRenderer(p: Props) {
  const id = `${p.formatKey}@${p.formatVersion}`
  if (id === 'standard@1') return p.kind === 'invoice' ? <InvoiceDocument data={p.data} /> : <PaymentNoticeDocument data={p.data} />
  if (id === 'ooba@1')     return p.kind === 'invoice' ? <OobaInvoiceDocument data={p.data} /> : <OobaPaymentNoticeDocument data={p.data} />
  return (
    <div className="a4-page w-[794px] bg-white p-12 flex items-center justify-center">
      <p className="text-red-600 text-sm">未対応の様式です: {p.formatKey} v{p.formatVersion}</p>
    </div>
  )
}
```

- [ ] **Step 2: プレビューモーダルを接続**

`InvoicePdfModal.tsx` で `<InvoiceDocument data={data} />` を
```tsx
<DocumentRenderer kind="invoice" formatKey={data.formatKey} formatVersion={DOCUMENT_FORMATS[data.formatKey]?.version ?? 1} data={data} />
```
に置換（`import { DOCUMENT_FORMATS } from '@/utils/document-formats'`）。`PaymentNoticePdfModal.tsx` も同様に `kind="payment_notice"`。

- [ ] **Step 3: 発行控えを接続**

`IssuedDocumentModal.tsx` の `renderSnapshot` を:
```tsx
function renderSnapshot(d: IssuedDocumentDetail) {
  return d.kind === 'invoice'
    ? <DocumentRenderer kind="invoice"        formatKey={d.formatKey} formatVersion={d.formatVersion} data={d.snapshot as InvoicePdfData} />
    : <DocumentRenderer kind="payment_notice" formatKey={d.formatKey} formatVersion={d.formatVersion} data={d.snapshot as PaymentNoticePdfData} />
}
```
`InvoiceDocument`/`PaymentNoticeDocument` の import を削除。

⚠️ `issued_documents.format_key` は発行時に `document-actions.ts:108` で解決して保存している。プレビュー側の `data.formatKey` と同じ規則（荷主指定 → 会社標準）なので一致する。

- [ ] **Step 4: 画面確認**

1. `/admin/settings/company` で「標準の請求書様式」を「おおば運送様式」にして保存
2. `/admin/sales` → 請求書プレビュー → `read_page` で「請 求 書」「件名： R」「お振込先」が出る
3. `/admin/billing` → 支払通知書プレビュー → `read_page` で「支払明細書」「差引支給額【①+②+③+④】」「勤務報告書」が出る
4. 確定発行 → `/admin/documents` で控えを開き、同じ様式で出る（`format_key = 'ooba'`）
5. 様式を「標準様式」に戻し、**既に発行した控えは ooba のまま**表示されることを確認
6. レイアウト確認はスクリーンショット **各 1 枚まで**（請求書・支払明細書）

- [ ] **Step 5: Commit**

```bash
git add web/src/components/pdf/DocumentRenderer.tsx web/src/components/pdf/InvoicePdfModal.tsx web/src/components/pdf/PaymentNoticePdfModal.tsx web/src/components/pdf/IssuedDocumentModal.tsx
git commit -m "feat(documents): 様式ルーター DocumentRenderer を導入し、プレビュー・発行控えを様式キーで描画

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Excel 生成（ExcelJS・純関数）

**Files:**
- Create: `web/src/utils/ooba-excel.ts`
- Test: `web/src/utils/ooba-excel.test.ts`

**Interfaces:**
- Consumes: `InvoicePdfData`, `PaymentNoticePdfData`, `aggregateOobaInvoiceRows`
- Produces:
  ```ts
  export function buildOobaInvoiceWorkbook(data: InvoicePdfData): ExcelJS.Workbook
  export function buildOobaPaymentNoticeWorkbook(data: PaymentNoticePdfData): ExcelJS.Workbook
  ```
  （ブラウザでは `await wb.xlsx.writeBuffer()` → Blob、テストでは `wb.getWorksheet(...)` でセルを検査）

- [ ] **Step 1: 失敗するテスト**

```ts
import { describe, it, expect } from 'vitest'
import { buildOobaInvoiceWorkbook, buildOobaPaymentNoticeWorkbook } from './ooba-excel'
import { OOBA_INVOICE_FIXTURE, OOBA_PAYMENT_NOTICE_FIXTURE } from '@/components/pdf/formats/ooba/fixtures'

describe('ooba-excel', () => {
  it('請求書: 件名・明細・合計が所定セルに入る', () => {
    const wb = buildOobaInvoiceWorkbook(OOBA_INVOICE_FIXTURE)
    const ws = wb.getWorksheet('請求書')!
    expect(ws.getCell('A1').value).toBe('請 求 書')
    expect(ws.getCell('A5').value).toBe('件名： R8．6月度 業務委託費')
    expect(ws.getCell('B9').value).toBe('Aデバンニング作業 1本')
    expect(ws.getCell('C9').value).toBe('6月度 14 日')
    expect(ws.getCell('D9').value).toBe(16000)
    expect(ws.getCell('E9').value).toBe(224000)
    const total = OOBA_INVOICE_FIXTURE.totalAmount
    expect(ws.getCell('E21').value).toBe(total)
  })
  it('支払明細書: 5 シートがあり差引支給額が入る', () => {
    const wb = buildOobaPaymentNoticeWorkbook(OOBA_PAYMENT_NOTICE_FIXTURE)
    expect(wb.worksheets.map(w => w.name)).toEqual(['支払明細書', '勤務報告書', '作業明細支払書', '立替金明細書', '利益表'])
    const ws = wb.getWorksheet('支払明細書')!
    expect(ws.getCell('G32').value).toBe(OOBA_PAYMENT_NOTICE_FIXTURE.totalAmount)
    expect(ws.getCell('G24').value).toBe(-1000)
    const rep = wb.getWorksheet('勤務報告書')!
    expect(rep.getCell('D5').value).toBe('C配送 2t')
    expect(rep.getCell('N5').value).toBe('8:00')   // 実働 9h − 休憩 1h
  })
  it('数式を一切使わない（HIBIKI の計算値だけを入れる）', () => {
    const wb = buildOobaPaymentNoticeWorkbook(OOBA_PAYMENT_NOTICE_FIXTURE)
    for (const ws of wb.worksheets) ws.eachRow(r => r.eachCell(c => expect(typeof c.value === 'object' && c.value && 'formula' in c.value).toBe(false)))
  })
})
```

Run: `cd web && npx vitest run src/utils/ooba-excel.test.ts` → FAIL

- [ ] **Step 2: 実装**

セル配置は見本 xlsx の座標に合わせる（支払明細書: 表題 A3、日付 G5、宛名 B7、〒 G6、住所 G7、社名 G8、℡ G9、期間 B10、登録番号 G10、金額見出し G11、支払運賃 G12、調整 G17、小計① G18、消費税② G19、2%分 G21、運送保険 G24、相殺合計③ G27、立替金 G28、うち消費税 G29、立替合計④ G31、差引 G32、備考 B33。勤務報告書: 見出し 3〜4 行目、明細 5 行目から B:月 C:日 D:作業内容 H:売上 I:支払額 J:立替内訳 K:立替額 L:開始 M:終了 N:実働 O:距離 P:備考。作業明細支払書: 4 行目から B,C,D,H,I。立替金明細書: 4 行目から B,C,D,F,G,H,I。利益表: B3〜D3 見出し、4 行目に値）。

```ts
import ExcelJS from 'exceljs'
import type { InvoicePdfData, PaymentNoticePdfData, LaborPdfLine } from '@/app/_actions/pdf-actions'
import { aggregateOobaInvoiceRows } from './ooba-invoice-lines'

const YEN = '#,##0;[Red]-#,##0'
const box = (ws: ExcelJS.Worksheet, ref: string) => { const c = ws.getCell(ref); c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }; return c }
const money = (ws: ExcelJS.Worksheet, ref: string, v: number) => { const c = box(ws, ref); c.value = v; c.numFmt = YEN; c.alignment = { horizontal: 'right' } }
const text  = (ws: ExcelJS.Worksheet, ref: string, v: string | number | null) => { const c = box(ws, ref); c.value = v ?? ''; return c }
const md = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return { m, d } }
const workMinutes = (l: LaborPdfLine) => {
  if (!l.startTime || !l.endTime) return null
  const [sh, sm] = l.startTime.split(':').map(Number); const [eh, em] = l.endTime.split(':').map(Number)
  return Math.max(0, eh * 60 + em - (sh * 60 + sm) - (l.breakMinutes ?? 0))
}
const hhmm = (min: number | null) => min === null ? '' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`

// ⚠️ 数式は入れない。HIBIKI の計算値と Excel の再計算がずれる余地を作らない（要件 §3）
export function buildOobaInvoiceWorkbook(data: InvoicePdfData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('請求書', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true } })
  ws.columns = [{ width: 4 }, { width: 40 }, { width: 16 }, { width: 12 }, { width: 16 }]
  const c = data.company
  ws.getCell('A1').value = '請 求 書'; ws.getCell('A1').font = { size: 18, bold: true }; ws.mergeCells('A1:E1'); ws.getCell('A1').alignment = { horizontal: 'center' }
  ws.getCell('A3').value = `${data.clientName} 御中`; ws.getCell('A3').font = { size: 14, underline: true }
  ws.getCell('D3').value = `作成日 ${data.issueDate.replace(/-(\d+)-(\d+)/, (_, m, d) => `年${Number(m)}月${Number(d)}日`)}`
  ws.getCell('D4').value = c.name; ws.getCell('D5').value = `〒${c.postalCode}`; ws.getCell('D6').value = c.address
  ws.getCell('D7').value = `TEL： ${c.phone}`; ws.getCell('D8').value = `登録番号 ${c.invoiceRegNumber}`
  ws.getCell('A5').value = `件名： ${data.subject}`
  ws.getCell('A6').value = '下記の通り、ご請求申し上げます。'
  ws.getCell('A7').value = `合計金額 ¥${data.totalAmount.toLocaleString('ja-JP')} （税込）`; ws.getCell('A7').font = { size: 13, bold: true }
  ;['', '摘要', '数量', '単価', '金額'].forEach((h, i) => { const cell = text(ws, `${'ABCDE'[i]}8`, h); cell.alignment = { horizontal: 'center' }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } } })
  const rows = aggregateOobaInvoiceRows(data.lines, data.yearMonth)
  const MARK = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩']
  for (let i = 0; i < 10; i++) {
    const r = 9 + i; const row = rows[i]
    text(ws, `A${r}`, row ? (MARK[i] ?? i + 1) : ''); text(ws, `B${r}`, row?.description ?? ''); text(ws, `C${r}`, row?.quantityLabel ?? '')
    if (row) { money(ws, `D${r}`, row.unitPrice); money(ws, `E${r}`, row.amount) } else { box(ws, `D${r}`); box(ws, `E${r}`) }
  }
  text(ws, 'D19', '小計');   money(ws, 'E19', data.netTotal)
  text(ws, 'D20', '消費税'); money(ws, 'E20', data.taxAmount)
  text(ws, 'D21', '合計');   money(ws, 'E21', data.totalAmount); ws.getCell('E21').font = { bold: true }
  data.noteLines.forEach((n, i) => { ws.getCell(`A${22 + i}`).value = n })
  const b = 24 + data.noteLines.length
  ws.getCell(`A${b}`).value = 'お振込先'; ws.getCell(`A${b}`).font = { bold: true }
  ws.getCell(`A${b + 1}`).value = `${c.bank.bankName} ${c.bank.bankBranch}　${c.bank.accountType}　${c.bank.accountNumber}`
  ws.getCell(`A${b + 2}`).value = c.bank.accountHolder
  ws.getCell(`A${b + 4}`).value = '備考'
  return wb
}

export function buildOobaPaymentNoticeWorkbook(data: PaymentNoticePdfData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const c = data.company
  const monthLabel = data.noticeMonth.replace(/^(\d{4})年0?(\d+)月分$/, '$2月度')
  const subtotal10 = data.laborNet + data.adjustment
  const offsetTotal = -(data.deduction + data.insuranceDeduction)
  const expenseTotal = data.expenseNet + data.expenseTax

  // ── 支払明細書（本票）: 見本のセル座標に合わせる ──
  const m = wb.addWorksheet('支払明細書', { pageSetup: { paperSize: 9, fitToPage: true } })
  m.columns = [{ width: 2 }, { width: 14 }, { width: 30 }, { width: 4 }, { width: 4 }, { width: 4 }, { width: 16 }]
  m.getCell('A3').value = '支払明細書'; m.getCell('A3').font = { size: 16, bold: true }
  m.getCell('G5').value = data.issueDate.replace(/-/g, '/'); m.getCell('G6').value = `〒${c.postalCode}`
  m.getCell('B7').value = `　${data.contractorName}　`; m.getCell('D7').value = '様'; m.getCell('G7').value = c.address
  m.getCell('G8').value = c.name; m.getCell('G9').value = `℡${c.phone}`
  m.getCell('B10').value = `（${data.noticeMonth})`; m.getCell('G10').value = `登録番号 ${c.invoiceRegNumber}`
  text(m, 'G11', '金額').alignment = { horizontal: 'center' }
  text(m, 'B12', '支払額'); text(m, 'C12', '支払運賃'); money(m, 'G12', data.laborNet)
  text(m, 'C17', '調整'); money(m, 'G17', data.adjustment)
  text(m, 'C18', '10%対象小計【①】'); money(m, 'G18', subtotal10)
  text(m, 'C19', '消費税額（10％）【②】'); money(m, 'G19', data.laborTax)
  text(m, 'B20', '相殺額')
  text(m, 'C21', `${Math.round(data.deductionRate * 100)}%分`); money(m, 'G21', -data.deduction)
  text(m, 'C24', '運送保険 (非課税）'); money(m, 'G24', -data.insuranceDeduction)
  text(m, 'C27', '相殺額合計【③】'); money(m, 'G27', offsetTotal)
  text(m, 'B28', '立替金（高速料金、駐車場代　他　）'); money(m, 'G28', data.expenseNet)
  text(m, 'B29', 'うち消費税額（10％）'); money(m, 'G29', data.expenseTax)
  text(m, 'B31', '立替金合計【④】'); money(m, 'G31', expenseTotal)
  text(m, 'B32', '差引支給額【①+②+③+④】（税込）').font = { bold: true }; money(m, 'G32', data.totalAmount); m.getCell('G32').font = { bold: true }
  m.getCell('B33').value = '備考          ※送付後10日以内に御連絡が無い場合、確認済とします。'

  // ── 勤務報告書 ──
  const r = wb.addWorksheet('勤務報告書', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true } })
  r.getCell('A1').value = `　${monthLabel}勤務報告書（${data.contractorName}）`; r.getCell('A1').font = { size: 14, bold: true }
  const H3: Record<string, string> = { B: '月', C: '日', D: '作業内容', H: '売上', I: '支払額', J: '立替金内訳', K: '立替金額', L: '作業時間', O: '走行距離', P: '備考' }
  for (const [col, h] of Object.entries(H3)) text(r, `${col}3`, h)
  text(r, 'L4', '開始'); text(r, 'M4', '終了'); text(r, 'N4', '実働時間')
  let row = 5
  for (const l of data.laborLines) {
    const { m: mm, d } = md(l.workDate)
    text(r, `B${row}`, mm); text(r, `C${row}`, d); text(r, `D${row}`, l.projectName)
    money(r, `H${row}`, l.sellingAmount); money(r, `I${row}`, l.netAmount)
    text(r, `L${row}`, l.startTime); text(r, `M${row}`, l.endTime); text(r, `N${row}`, hhmm(workMinutes(l)))
    row++
  }
  for (const e of data.expenseLines) {
    const { m: mm, d } = md(e.expenseDate)
    text(r, `B${row}`, mm); text(r, `C${row}`, d); text(r, `J${row}`, e.expenseType); money(r, `K${row}`, e.netAmount + e.taxAmount)
    row++
  }
  text(r, `D${row}`, '合計'); money(r, `H${row}`, data.laborLines.reduce((s, l) => s + l.sellingAmount, 0)); money(r, `I${row}`, data.laborNet); money(r, `K${row}`, expenseTotal)

  // ── 作業明細支払書 ──
  const w = wb.addWorksheet('作業明細支払書', { pageSetup: { paperSize: 9, fitToPage: true } })
  w.getCell('A1').value = '作業明細支払書'; w.getCell('A1').font = { size: 14, bold: true }
  ;[['B', '月'], ['C', '日'], ['D', '作業内容'], ['H', '金額（税抜）'], ['I', '備考']].forEach(([col, h]) => text(w, `${col}3`, h))
  row = 4
  for (const l of data.laborLines) { const { m: mm, d } = md(l.workDate); text(w, `B${row}`, mm); text(w, `C${row}`, d); text(w, `D${row}`, l.projectName); money(w, `H${row}`, l.netAmount); row++ }
  text(w, `D${row}`, '合計'); money(w, `H${row}`, data.laborNet)

  // ── 立替金明細書 ──
  const x = wb.addWorksheet('立替金明細書', { pageSetup: { paperSize: 9, fitToPage: true } })
  x.getCell('A1').value = '立替金明細書'; x.getCell('A1').font = { size: 14, bold: true }
  ;[['B', '月'], ['C', '日'], ['D', '作業内容'], ['F', '立替金内訳'], ['G', '売上'], ['H', '立替金額'], ['I', '備考']].forEach(([col, h]) => text(x, `${col}3`, h))
  row = 4
  for (const e of data.expenseLines) { const { m: mm, d } = md(e.expenseDate); text(x, `B${row}`, mm); text(x, `C${row}`, d); text(x, `F${row}`, e.expenseType); money(x, `H${row}`, e.netAmount + e.taxAmount); row++ }
  text(x, `F${row}`, '合計'); money(x, `H${row}`, expenseTotal)

  // ── 利益表（社内用） ──
  const p = wb.addWorksheet('利益表')
  p.getCell('A1').value = '利益表'
  text(p, 'B3', '作業日数合計'); text(p, 'C3', '作業時間合計'); text(p, 'D3', '売上（１０％分）')
  const minutes = data.laborLines.reduce((s, l) => s + (workMinutes(l) ?? 0), 0)
  text(p, 'B4', data.laborLines.length); text(p, 'C4', hhmm(minutes))
  money(p, 'D4', Math.round(data.laborLines.reduce((s, l) => s + l.sellingAmount, 0) * 0.1))
  return wb
}
```

- [ ] **Step 3: テスト**

Run: `cd web && npx vitest run src/utils/ooba-excel.test.ts` → 3 passed（セル座標の期待値が実装とずれたら**テスト側ではなく実装を見本座標に合わせる**）

- [ ] **Step 4: Commit**

```bash
git add web/src/utils/ooba-excel.ts web/src/utils/ooba-excel.test.ts
git commit -m "feat(documents): おおば様式の請求書・支払明細書を ExcelJS で生成（数式なし・値のみ）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Excel ダウンロードボタン（ブラウザ生成）

**Files:**
- Create: `web/src/components/pdf/ExcelDownloadButton.tsx`
- Modify: `web/src/components/pdf/InvoicePdfModal.tsx`, `PaymentNoticePdfModal.tsx`, `IssuedDocumentModal.tsx`（`actions` にボタン追加）

**Interfaces:**
- Produces: `export function ExcelDownloadButton({ build, fileName }: { build: () => Promise<ExcelJS.Workbook>; fileName: string })`

- [ ] **Step 1: 実装**

```tsx
'use client'
import { useState } from 'react'
import type ExcelJS from 'exceljs'

/**
 * ブラウザ側で xlsx を組んで保存する。サーバーにファイルを持たない（Workers にファイル I/O が無い）。
 * ⚠️ ExcelJS はバンドルが大きいので動的 import（build は呼び出し側が遅延解決する）
 */
export function ExcelDownloadButton({ build, fileName }: { build: () => Promise<ExcelJS.Workbook>; fileName: string }) {
  const [busy, setBusy] = useState(false)
  const onClick = async () => {
    setBusy(true)
    try {
      const wb = await build()
      const buf = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = fileName; a.click()
      URL.revokeObjectURL(url)
    } finally { setBusy(false) }
  }
  return (
    <button type="button" onClick={onClick} disabled={busy} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50 print:hidden">
      {busy ? '作成中…' : 'Excel'}
    </button>
  )
}
```

- [ ] **Step 2: モーダルに接続**

`InvoicePdfModal.tsx` の `actions` に、`data.formatKey === 'ooba'` のとき:
```tsx
<ExcelDownloadButton
  fileName={`請求書_${clientName}_${yearMonth}.xlsx`}
  build={async () => (await import('@/utils/ooba-excel')).buildOobaInvoiceWorkbook(data)}
/>
```
`PaymentNoticePdfModal.tsx` も `buildOobaPaymentNoticeWorkbook`、ファイル名 `支払明細書_${contractorName}_${yearMonth}.xlsx`。`IssuedDocumentModal.tsx` は `doc.formatKey === 'ooba'` のとき `doc.snapshot` を渡し、ファイル名に `doc.documentNumber` を使う。標準様式のときは表示しない（標準様式の Excel は本計画の対象外）。

- [ ] **Step 3: 画面確認**

1. 請求書プレビューで「Excel」を押す → ダウンロードされた xlsx を `python3 -c "import openpyxl; wb=openpyxl.load_workbook('<path>'); print([ws.title for ws in wb]); print(wb['請求書']['E21'].value)"` で検査
2. 支払明細書も同様に 5 シートと `G32` を確認
3. `read_console_messages` にエラーが無いこと

- [ ] **Step 4: Commit**

```bash
git add web/src/components/pdf/ExcelDownloadButton.tsx web/src/components/pdf/InvoicePdfModal.tsx web/src/components/pdf/PaymentNoticePdfModal.tsx web/src/components/pdf/IssuedDocumentModal.tsx
git commit -m "feat(documents): おおば様式の Excel ダウンロード（ブラウザ生成）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: 見本との突合・ドキュメント更新

**Files:**
- Modify: `docs/HANDOVER_MASTER.md`（§5 の該当行）, `docs/superpowers/plans/2026-08-23-client-format-documents-handover.md`

- [ ] **Step 1: 見本の数値で突合（ローカルのみ・結果は数値だけ記録）**

`OOBA_PAYMENT_NOTICE_FIXTURE` の金額は見本（坂田 2025-11）と同じ構成にしてある。`assemblePaymentTotals` の結果が見本の差引支給額 **245,960**（229,091 + 22,909 − 6,040 + 0。見本は小数を持つが HIBIKI は整数）と一致するか vitest で確認:

```ts
// web/src/utils/payment-notice-totals.test.ts に追記
it('おおば見本 2025-11 の構成で差引支給額が一致する', () => {
  const t = assemblePaymentTotals({ laborTaxExcluded: 229104, laborTax: 22909, expenseTaxExcluded: 0, expenseTax: 0, deduction: 5040, adjustment: -13, insuranceDeduction: 1000 })
  expect(t.totalAmount).toBe(245960)
})
```
Run: `cd web && npx vitest run src/utils/payment-notice-totals.test.ts`
期待どおりでなければ**本票の①〜④の並べ方（Task 8/10）を見本に合わせる**。`payment-notice-totals.ts` は変えない（正本）。

- [ ] **Step 2: 全テスト・型・ビルド**

Run: `cd web && npx vitest run && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: all passed / 0 errors / build 成功

- [ ] **Step 3: 引き継ぎを更新**

`HANDOVER_MASTER.md` §5 の「導入先ごとの帳票様式」行を「✅ 様式② 実装済み（ブランチ、本番未適用）」に更新し、次を記す: 本番適用 SQL は `20260824000000_contractors_apply_transport_insurance.sql`、作業系委託先は委託先マスタで「運送保険」のチェックを外す、おおばテナントは自社情報で様式を「おおば運送様式」にする、人員結果表（別紙）は次版。`client-format-documents-handover.md` のステータスも同様に。

- [ ] **Step 4: Commit**

```bash
git add docs/HANDOVER_MASTER.md docs/superpowers/plans/2026-08-23-client-format-documents-handover.md web/src/utils/payment-notice-totals.test.ts
git commit -m "docs: おおば様式②の実装完了と本番適用手順を記録

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 次版（本計画の対象外・要件メモ）

- **人員結果表（協和冷蔵 xlsx）の自動生成**: ドライバーアカウントを持つ委託先のカレンダー予定と実績（`work_records`）から月次の人員結果表を生成し、請求書の別紙として添付。対象は作業系（デバンニング等）の一部カテゴリの案件のみ。`isWorkTypeProject` の名前判定を `projects` のカテゴリ列に置き換えるのが前提
- 走行距離（`work_records` に列追加＋ドライバー入力）
- 印影・ロゴ画像（Storage）、荷主別端数設定（計画③）
