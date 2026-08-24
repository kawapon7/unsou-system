# 取引先一括インポート（運営者専用）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 運営者（ボス）だけが使える、Excel（3シート: 委託先・請求先・部署）からの取引先一括インポート画面を作る。

**Architecture:** ブラウザ側でSheetJS（既存依存 `xlsx@0.20.3`）が.xlsxをJSON化し、プレビュー後にServer Actionへ構造化データのみ送信。Server Actionが運営者ゲート→全行再検証→重複検査→既存の登録アクション（`createClient_`/`createClientDepartment`/`createContractor`、口座4項目は内部で `encryptBankFields`）経由で投入。1件でも問題があれば全件中止。

**Tech Stack:** Next.js App Router / Server Actions / SheetJS(`xlsx`) / vitest

**Spec:** `docs/superpowers/specs/2026-08-24-partner-import-design.md`

## Global Constraints

- 口座情報（bank_name/bank_branch/account_number/account_holder）を平文でDBに書く経路を作らない。挿入は既存の `createClient_`/`createContractor` を必ず経由する（両者が `encryptBankFields` を通す）。
- クライアントからのDB直接クエリ禁止。すべてServer Actions経由。
- 検証の正本はサーバー側。ブラウザ側の検証はUX目的の複製にすぎない。
- 運営者ゲートは環境変数 `OPERATOR_USER_IDS`（カンマ区切りUUID）。未設定・空なら全員拒否（fail-closed）。
- 色クラスは `web/src/app/admin/nav.tsx` の `CATEGORY_STYLES` 経由のみ。動的クラス生成・直書き禁止。
- コミット前3ステップ厳守: ①`git status` で `.next/`・`.open-next/` が候補に無いこと ②`git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"` が空 ③ファイル明示 add。
- テスト実行はすべて `web/` ディレクトリで `npx vitest run <path>`（Node は mise 管理: Bash では `eval "$(mise activate bash --shims)"` を先に実行）。
- 列挙値の正本は `web/src/app/admin/partners/page.tsx` の定数（TAX_TYPES 等）。値を再定義せず、変換表のコメントに出典行を明記する。

---

### Task 1: 運営者ゲート `utils/operator.ts`

**Files:**
- Create: `web/src/utils/operator.ts`
- Create: `web/src/utils/operator.test.ts`

**Interfaces:**
- Produces: `parseOperatorIds(raw: string | undefined): string[]` / `isOperatorId(userId: string, ids: string[]): boolean` / `requireOperator(): Promise<AuthResult>`（`AuthResult` は `@/utils/auth` の既存型）。Task 3・4 が `requireOperator` を使う。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/utils/operator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseOperatorIds, isOperatorId } from './operator'

describe('parseOperatorIds', () => {
  it('カンマ区切りをtrimして配列にする', () => {
    expect(parseOperatorIds(' abc-1 , def-2 ')).toEqual(['abc-1', 'def-2'])
  })
  it('未設定(undefined)は空配列（fail-closed）', () => {
    expect(parseOperatorIds(undefined)).toEqual([])
  })
  it('空文字列は空配列', () => {
    expect(parseOperatorIds('')).toEqual([])
  })
})

describe('isOperatorId', () => {
  it('一致すればtrue', () => {
    expect(isOperatorId('abc-1', ['abc-1'])).toBe(true)
  })
  it('リストが空なら常にfalse', () => {
    expect(isOperatorId('abc-1', [])).toBe(false)
  })
  it('部分一致はfalse', () => {
    expect(isOperatorId('abc', ['abc-1'])).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd web && eval "$(mise activate bash --shims)" && npx vitest run src/utils/operator.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装**

`web/src/utils/operator.ts`:

```ts
import { requireOwner, type AuthResult } from '@/utils/auth'

/** OPERATOR_USER_IDS（カンマ区切りUUID）をパースする。未設定・空は空配列＝全員拒否（fail-closed）。 */
export function parseOperatorIds(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

export function isOperatorId(userId: string, ids: string[]): boolean {
  return ids.includes(userId)
}

/**
 * 運営者（HIBIKI側）専用ガード。owner であることに加え、
 * OPERATOR_USER_IDS に userId が含まれることを要求する。
 * ⚠️ B社前のRLS見直しで正式ロール `operator` に昇格予定。ゲート判定はこの関数に集約しておくこと。
 */
export async function requireOperator(): Promise<AuthResult> {
  const res = await requireOwner()
  if (!res.ok) return res
  const ids = parseOperatorIds(process.env.OPERATOR_USER_IDS)
  if (!isOperatorId(res.ctx.userId, ids)) {
    return { ok: false, error: '権限がありません（運営者専用の操作です）。' }
  }
  return res
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd web && npx vitest run src/utils/operator.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: 開発用の環境変数を追記**

`web/.env.local` に追記（値はdevバイパス用の合成ID。auth.ts の `DEV_BYPASS_USER_ID` と同じ文字列）:

```
OPERATOR_USER_IDS=dev-bypass
```

⚠️ `.env.local` はgit管理外であることを `git status` で確認すること。本番の値（ボスの実UUID）はデプロイ時にCloudflare側のsecretで設定する（Task 5に手順）。

- [ ] **Step 6: コミット（コミット前3ステップを通す）**

```bash
git status
git add web/src/utils/operator.ts web/src/utils/operator.test.ts
git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"
git commit -m "feat: 運営者ゲート requireOperator を追加（OPERATOR_USER_IDS・fail-closed）"
```

---

### Task 2: 検証・変換の純関数 `utils/partner-import.ts`

**Files:**
- Create: `web/src/utils/partner-import.ts`
- Create: `web/src/utils/partner-import.test.ts`

**Interfaces:**
- Produces（Task 3・4 が使用）:

```ts
export type RawRow = Record<string, string>          // ヘッダ名→セル値（すべてString化済み）
export type ImportFile = { contractors: RawRow[]; clients: RawRow[]; departments: RawRow[] }
export type RowError = { sheet: string; row: number; column: string; reason: string }  // rowはExcel行番号(データ1行目=3)
export type ExistingSets = {
  clientNames: string[]; contractorNames: string[]; contractorEmails: string[]
}
export type ConvertedImport = {
  clients: Array<Record<string, unknown>>       // createClient_ に渡す payload（tenant_id なし）
  departments: Array<{ clientName: string; payload: Record<string, unknown> }>  // client_id は後で解決
  contractors: Array<Record<string, unknown>>   // createContractor に渡す payload
}
export function validateAndConvert(file: ImportFile, existing: ExistingSets):
  { data: ConvertedImport | null; errors: RowError[] }
export const SHEET_NAMES: { contractors: '委託先'; clients: '請求先'; departments: '部署' }
export const TEMPLATE_HEADERS: { contractors: string[]; clients: string[]; departments: string[] }
```

**変換仕様（正本: `web/src/app/admin/partners/page.tsx` の既存submit処理）:**

| テンプレ列（日本語） | 変換先 | 変換規則（page.tsx の出典行） |
|---|---|---|
| 請求先: 締め日 | `closing_day`(int) | 月末→99、それ以外→Number（651行） |
| 請求先: 支払月+支払日 | `payment_site`(int) | offset×30 + (月末→30/それ以外Number)（645,652行） |
| 請求先: 税区分 | `tax_type` | 外税→exclusive/内税→inclusive/非課税→exempt（TAX_TYPES 32-36行） |
| 請求先: インボイス登録 | `invoice_registered`+`is_invoice_registered`+`has_invoice` | あり→true/なし→false の3列同値（654-656行） |
| 請求先: 部署を使う | `use_departments` | あり→true/なし→false（662行） |
| 委託先: 支払方法 | `payment_type` | 振込→bank_transfer/現金→現金（959行） |
| 委託先: 支払月+支払日 | `payment_site`(int) | offset×30 + (月末→30/それ以外Number)（954,960行） |
| 委託先: 締め日 | `closing_day`(text) | 月末 or "1"〜"28" をそのまま文字列で |
| 委託先: 税区分 | `tax_category` | TAX_TYPES と同じ写像（961行） |
| 委託先: インボイス区分 | `invoice_registration_type` | 適格/免税 をそのまま（INVOICE_REG_TYPES 48-51行） |
| 委託先: 固定値 | — | `contractor_type:'individual'`・`has_withholding:false`・`show_detail_switch:true`（970-972行） |
| 両方: 口座種別 | `account_type` | 普通/当座 をそのまま（ACCOUNT_TYPES 38-41行） |
| 両方: 空欄の任意項目 | — | `null`（`|| null` に合わせる） |
| 部署: sort_order | `sort_order`(int) | 同一請求先内の出現順で 0 から自動採番（テンプレに列は設けない） |

**検証ルール:** 必須欄の空検出／列挙値不一致／メール形式（`/.+@.+\..+/` 程度）／登録番号 `^T[0-9]{13}$`（インボイス区分=適格のときのみ任意入力可、免税で入力があればエラー）／締め日・支払日は「月末」or 1〜28／ファイル内重複（委託先: 名前・メール、請求先: 会社名）／既存DB重複（ExistingSets との照合、同値なら全件中止）／部署の請求先名が「請求先」シートにも existing.clientNames にも無ければエラー／先頭セルが「例）」で始まる行はスキップ。エラーは全件収集して返す（1件で打ち切らない）。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/utils/partner-import.test.ts`（代表ケース。実装時にこのまま書く）:

```ts
import { describe, it, expect } from 'vitest'
import { validateAndConvert, TEMPLATE_HEADERS } from './partner-import'

const noExisting = { clientNames: [], contractorNames: [], contractorEmails: [] }

const validContractor = {
  '名前': '山田運送', 'メール': 'yamada@example.com', '電話': '090-1111-2222',
  '締め日': '月末', '支払月': '翌月', '支払日': '15', '支払方法': '振込',
  '税区分': '外税', 'インボイス区分': '適格', '登録番号': 'T1234567890123',
  '銀行名': 'テスト銀行', '支店名': '本店', '口座種別': '普通',
  '口座番号': '1234567', '口座名義': 'ヤマダウンソウ',
}
const validClient = {
  '会社名': 'テスト商事', '担当者名': '佐藤', 'メール': 'sato@example.com', '電話': '',
  '締め日': '月末', '支払月': '翌々月', '支払日': '月末', '税区分': '外税',
  'インボイス登録': 'あり', '部署を使う': 'あり',
  '銀行名': '', '支店名': '', '口座種別': '', '口座番号': '', '口座名義': '',
}
const validDept = { '請求先名': 'テスト商事', '部署名': '物流部', '担当者名': '', 'メール': '', '電話': '' }

describe('validateAndConvert 正常系', () => {
  it('正しい3シートが変換され errors は空', () => {
    const r = validateAndConvert(
      { contractors: [validContractor], clients: [validClient], departments: [validDept] },
      noExisting,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.contractors[0]).toMatchObject({
      name: '山田運送',
      payment_type: 'bank_transfer',
      payment_site: 45,            // 翌月(1)×30 + 15
      tax_category: 'exclusive',
      invoice_registration_type: '適格',
      contractor_type: 'individual',
      has_withholding: false,
      show_detail_switch: true,
      closing_day: '月末',
    })
    expect(r.data!.clients[0]).toMatchObject({
      company_name: 'テスト商事',
      closing_day: 99,             // 月末→99
      payment_site: 90,            // 翌々月(2)×30 + 月末(30)
      tax_type: 'exclusive',
      invoice_registered: true, is_invoice_registered: true, has_invoice: true,
      use_departments: true,
      phone: null,                 // 空欄→null
    })
    expect(r.data!.departments[0]).toMatchObject({ clientName: 'テスト商事' })
  })
  it('先頭セルが「例）」の行はスキップされる', () => {
    const example = { ...validContractor, '名前': '例）山田運送' }
    const r = validateAndConvert(
      { contractors: [example, validContractor], clients: [], departments: [] },
      noExisting,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.contractors).toHaveLength(1)
  })
})

describe('validateAndConvert エラー系（すべて全件中止 data:null）', () => {
  it('必須欄の空はエラー（行番号・列名つき）', () => {
    const r = validateAndConvert(
      { contractors: [{ ...validContractor, '名前': '' }], clients: [], departments: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
    expect(r.errors[0]).toMatchObject({ sheet: '委託先', column: '名前' })
  })
  it('列挙値のゆれはエラー', () => {
    const r = validateAndConvert(
      { contractors: [{ ...validContractor, '支払月': 'よく月' }], clients: [], departments: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
    expect(r.errors[0].column).toBe('支払月')
  })
  it('登録番号の形式違反はエラー', () => {
    const r = validateAndConvert(
      { contractors: [{ ...validContractor, '登録番号': 'T123' }], clients: [], departments: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
  })
  it('免税なのに登録番号があればエラー', () => {
    const r = validateAndConvert(
      { contractors: [{ ...validContractor, 'インボイス区分': '免税' }], clients: [], departments: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
  })
  it('ファイル内の同名重複はエラー', () => {
    const r = validateAndConvert(
      { contractors: [validContractor, { ...validContractor, 'メール': 'other@example.com' }], clients: [], departments: [] },
      noExisting,
    )
    expect(r.data).toBeNull()
  })
  it('既存DBとの同名重複はエラー', () => {
    const r = validateAndConvert(
      { contractors: [validContractor], clients: [], departments: [] },
      { ...noExisting, contractorNames: ['山田運送'] },
    )
    expect(r.data).toBeNull()
  })
  it('部署の請求先名が未解決ならエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [{ ...validDept, '請求先名': '存在しない社' }] },
      noExisting,
    )
    expect(r.data).toBeNull()
    expect(r.errors[0]).toMatchObject({ sheet: '部署', column: '請求先名' })
  })
  it('部署の請求先名が既存DB側にあれば通る', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [validDept] },
      { ...noExisting, clientNames: ['テスト商事'] },
    )
    expect(r.errors).toEqual([])
  })
  it('エラーは全件収集される（1件で打ち切らない）', () => {
    const r = validateAndConvert(
      { contractors: [{ ...validContractor, '名前': '', 'メール': 'bad' }], clients: [], departments: [] },
      noExisting,
    )
    expect(r.errors.length).toBeGreaterThanOrEqual(2)
  })
})

describe('TEMPLATE_HEADERS', () => {
  it('3シート分のヘッダが定義されている', () => {
    expect(TEMPLATE_HEADERS.contractors).toContain('名前')
    expect(TEMPLATE_HEADERS.clients).toContain('会社名')
    expect(TEMPLATE_HEADERS.departments).toContain('請求先名')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd web && npx vitest run src/utils/partner-import.test.ts`
Expected: FAIL（モジュール未実装）

- [ ] **Step 3: 実装**

`web/src/utils/partner-import.ts` を上記 Interfaces・変換仕様・検証ルールどおりに実装する。構造の指針:

```ts
// 内部ヘルパー（exportしない）
const MONTH_OFFSETS: Record<string, number> = { '当月': 0, '翌月': 1, '翌々月': 2, '3ヶ月後': 3 }
const TAX_MAP: Record<string, string> = { '外税': 'exclusive', '内税': 'inclusive', '非課税': 'exempt' }
// dayValue('月末' | '1'..'28') → 検証つき数値化。payment_site = MONTH_OFFSETS[支払月] * 30 + (支払日==='月末' ? 30 : Number)
// pushError(errors, sheet, index, column, reason) — row は index + 3（1=ヘッダ, 2=記入例のため）
// 行ループ: 先頭ヘッダのセルが「例）」で始まる行は continue
// 最後に errors.length > 0 なら { data: null, errors }、ゼロなら { data, errors: [] }
```

⚠️ 実装前に `web/src/app/admin/partners/page.tsx` の 640-676行（請求先submit）・942-989行（委託先submit）を必ず読み、payloadのキーと値の写像を一致させること。閾値・列挙はこの計画の表を信じず原本と突合する。

- [ ] **Step 4: テストが通ることを確認**

Run: `cd web && npx vitest run src/utils/partner-import.test.ts`
Expected: PASS（全ケース）

- [ ] **Step 5: 既存テストも壊れていないことを確認**

Run: `cd web && npx vitest run`
Expected: 既存含め全件PASS

- [ ] **Step 6: コミット（コミット前3ステップを通す）**

```bash
git status
git add web/src/utils/partner-import.ts web/src/utils/partner-import.test.ts
git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"
git commit -m "feat: 取引先インポートの検証・変換純関数（全件中止・エラー全件収集）"
```

---

### Task 3: Server Action `_actions/partnerImportActions.ts`

**Files:**
- Create: `web/src/app/_actions/partnerImportActions.ts`

**Interfaces:**
- Consumes: `requireOperator()`（Task 1）／`validateAndConvert`, `ImportFile`, `RowError`（Task 2）／既存 `createClient_`, `createClientDepartment`, `createContractor`, `fetchClients`, `fetchContractors`（`@/app/admin/partners/actions`）
- Produces（Task 4 が使用）:

```ts
export type ImportResult =
  | { ok: true; inserted: { clients: number; departments: number; contractors: number } }
  | { ok: false; errors: RowError[]; fatal?: string }
export async function importPartners(file: ImportFile): Promise<ImportResult>
```

- [ ] **Step 1: 実装**

`web/src/app/_actions/partnerImportActions.ts`:

```ts
'use server'

import { requireOperator } from '@/utils/operator'
import {
  validateAndConvert,
  type ImportFile,
  type RowError,
} from '@/utils/partner-import'
import {
  createClient_,
  createClientDepartment,
  createContractor,
  fetchClients,
  fetchContractors,
} from '@/app/admin/partners/actions'

export type ImportResult =
  | { ok: true; inserted: { clients: number; departments: number; contractors: number } }
  | { ok: false; errors: RowError[]; fatal?: string }

/**
 * 取引先一括インポート（運営者専用・初期投入用）。
 * 全行の検証が通ってから挿入を開始する。挿入は既存アクション経由のみ
 * （口座4項目の暗号化・tenant_id付与はそちらが行う。ここでDB直挿入しないこと）。
 */
export async function importPartners(file: ImportFile): Promise<ImportResult> {
  const auth = await requireOperator()
  if (!auth.ok) return { ok: false, errors: [], fatal: auth.error }

  // 既存データとの重複検査用セット（復号は不要なので名前・メールのみ使う）
  const [clientsRes, contractorsRes] = await Promise.all([fetchClients(), fetchContractors()])
  if (clientsRes.error) return { ok: false, errors: [], fatal: clientsRes.error }
  if (contractorsRes.error) return { ok: false, errors: [], fatal: contractorsRes.error }

  const validated = validateAndConvert(file, {
    clientNames: (clientsRes.data ?? []).map(c => c.company_name),
    contractorNames: (contractorsRes.data ?? []).map(c => c.name),
    contractorEmails: (contractorsRes.data ?? []).map(c => c.email),
  })
  if (!validated.data) return { ok: false, errors: validated.errors }

  const { clients, departments, contractors } = validated.data
  const inserted = { clients: 0, departments: 0, contractors: 0 }

  // ⚠️ Supabase Server Action 経由ではトランザクション不可。
  //    途中失敗時は何件目まで入ったかを返し、再実行は重複検査が防波堤になる（設計書参照）。
  const clientIdByName = new Map<string, string>()
  for (const c of clientsRes.data ?? []) clientIdByName.set(c.company_name, c.id)

  for (const payload of clients) {
    const r = await createClient_(payload as never)
    if (r.error) return partialFailure('請求先', inserted, r.error)
    clientIdByName.set(r.data!.company_name, r.data!.id)
    inserted.clients++
  }
  for (const d of departments) {
    const clientId = clientIdByName.get(d.clientName)
    if (!clientId) return partialFailure('部署', inserted, `請求先「${d.clientName}」の解決に失敗しました`)
    const r = await createClientDepartment({ ...(d.payload as object), client_id: clientId } as never)
    if (r.error) return partialFailure('部署', inserted, r.error)
    inserted.departments++
  }
  for (const payload of contractors) {
    const r = await createContractor(payload as never)
    if (r.error) return partialFailure('委託先', inserted, r.error)
    inserted.contractors++
  }

  return { ok: true, inserted }
}

function partialFailure(
  sheet: string,
  inserted: { clients: number; departments: number; contractors: number },
  message: string,
): ImportResult {
  return {
    ok: false,
    errors: [],
    fatal:
      `${sheet}の挿入中にエラー: ${message}\n` +
      `ここまでの登録: 請求先${inserted.clients}件・部署${inserted.departments}件・委託先${inserted.contractors}件。` +
      `登録済み分は重複検査で弾かれるため、残りだけのファイルを作り再実行してください。`,
  }
}
```

⚠️ `as never` は既存アクションの Insert 型に合わせるための最小限のキャスト。型エラーが出る場合はキャストを外して `ClientInsert` / `ContractorInsert` / `ClientDepartmentInsert` を `@/types/supabase` から import し、Task 2 の Draft 型をそれに合わせて厳密化する（そのほうが望ましい）。

- [ ] **Step 2: ビルドが通ることを確認**

Run: `cd web && npx tsc --noEmit`
Expected: エラーなし（既存エラーが元からある場合は新規エラーが増えていないこと）

- [ ] **Step 3: ゲートの動作をユニットで担保（Task 1 のテストで既にカバー済みであることを確認）**

Run: `cd web && npx vitest run src/utils/operator.test.ts src/utils/partner-import.test.ts`
Expected: PASS

- [ ] **Step 4: コミット（コミット前3ステップを通す）**

```bash
git status
git add web/src/app/_actions/partnerImportActions.ts
git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"
git commit -m "feat: 取引先一括インポートServer Action（運営者ゲート・全件中止・既存経路で暗号化）"
```

---

### Task 4: インポート画面 `/admin/ops/import`

**Files:**
- Create: `web/src/app/admin/ops/import/page.tsx`（Server Component: 運営者ゲート）
- Create: `web/src/app/admin/ops/import/ImportClient.tsx`（Client Component: 解析・プレビュー・投入・テンプレDL）
- Modify: `web/src/app/admin/nav.tsx`（運営者のみにリンク表示）

**Interfaces:**
- Consumes: `requireOperator`（Task 1）／`TEMPLATE_HEADERS`, `SHEET_NAMES`, `validateAndConvert`, `ImportFile`（Task 2）／`importPartners`, `ImportResult`（Task 3）／SheetJS: `import * as XLSX from 'xlsx'`

- [ ] **Step 1: page.tsx（サーバー側ゲート）**

```tsx
import { notFound } from 'next/navigation'
import { requireOperator } from '@/utils/operator'
import ImportClient from './ImportClient'

export default async function OpsImportPage() {
  const auth = await requireOperator()
  // 運営者以外には存在自体を見せない（403ではなく404相当）
  if (!auth.ok) notFound()
  return <ImportClient />
}
```

- [ ] **Step 2: ImportClient.tsx**

構成（既存の管理画面のスタイル・`'use client'` パターンに従う。参考実装: `web/src/app/admin/sales/EmergencyImportTab.tsx`）:

1. **テンプレDLボタン**: `XLSX.utils.book_new()` に `TEMPLATE_HEADERS` から3シート（`SHEET_NAMES` の名前）を作成。各シート1行目=ヘッダ、2行目=「例）」で始まる記入例（委託先例: `例）山田運送 / yamada@example.com / 090-xxxx-xxxx / 月末 / 翌月 / 15 / 振込 / 外税 / 適格 / T1234567890123 / …`）。`XLSX.writeFile(wb, 'HIBIKI_取引先インポート.xlsx')`
2. **ファイル選択**: `<input type="file" accept=".xlsx">` → `XLSX.read(await file.arrayBuffer())` → 3シートを `XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })` で読み、**全セルを `String(v).trim()` で文字列化**して `ImportFile` を作る。シート名が `SHEET_NAMES` と一致しない場合はその場でエラー表示
3. **プレビュー**: `validateAndConvert(file, { clientNames: [], contractorNames: [], contractorEmails: [] })` をブラウザ側でも実行（UX目的。既存DB重複はサーバーでしか分からない旨を注記表示）。シートごとの表で、エラー行は行番号・列名・理由を赤系スタイルで一覧
4. **投入ボタン**: ブラウザ側エラー0のときのみ活性。`importPartners(file)` を呼び、`ok:true` なら「請求先n件・部署n件・委託先n件を登録しました」、`ok:false` なら `errors`（表）または `fatal`（そのまま表示。部分投入時の案内文を含む）
5. 色は `CATEGORY_STYLES` 経由。動的クラス生成禁止

- [ ] **Step 3: nav.tsx に運営者のみのリンクを追加**

`web/src/app/admin/nav.tsx` を読み、既存のメニュー構造に従って「取引先インポート」(`/admin/ops/import`) を追加する。表示条件: nav がサーバー側で組まれているなら `requireOperator()` の成否で出し分け。クライアント側で組まれているなら、layout など上位のServer Componentで判定した boolean を props で渡す（**クライアントに OPERATOR_USER_IDS の値そのものを渡さない**）。どちらの構造かは実装時に nav.tsx / layout.tsx を読んで判断し、既存パターンを踏襲する。

- [ ] **Step 4: ビルド確認**

Run: `cd web && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: 型エラーなし・ビルド成功

- [ ] **Step 5: コミット（コミット前3ステップを通す）**

```bash
git status   # .next/ が候補に無いこと
git add web/src/app/admin/ops/import/page.tsx web/src/app/admin/ops/import/ImportClient.tsx web/src/app/admin/nav.tsx
git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"
git commit -m "feat: 取引先一括インポート画面（運営者専用・テンプレDL・プレビュー・全件中止）"
```

---

### Task 5: 結合確認（テスト環境）と引き継ぎ更新

**Files:**
- Modify: `docs/HANDOVER_MASTER.md`（結果の追記）

- [ ] **Step 1: dev サーバーで画面確認**

`.claude/launch.json` の既存設定で preview を起動（port 3000 は別アプリ shift-app-1t-van が使う場合があるため起動前に確認）。`/admin/ops/import` を `read_page` で確認:
- `OPERATOR_USER_IDS=dev-bypass` の状態でページが表示されること
- `.env.local` から一時的に `OPERATOR_USER_IDS` を消す→ 404 になること（fail-closed）→ 戻す

- [ ] **Step 2: テンプレDL→記入→投入の一連を実行**

テンプレをDLし、委託先2件・請求先1件・部署1件を記入して投入。確認項目:
- プレビューにエラーなし表示→投入成功メッセージ
- わざと必須欄を空にした行・列挙値ゆれの行でエラー一覧が出て投入ボタンが無効のこと
- 同じファイルをもう一度投入→既存DB重複で全件中止になること

- [ ] **Step 3: DB上の暗号化を照合（テスト環境DB hbpnhbsm）**

MCP `execute_sql` で:

```sql
select count(*) filter (where account_number !~* '^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$'
                        and account_number is not null and account_number <> '') as plaintext_leak
from contractors;
```

Expected: `plaintext_leak = 0`（画面側では復号されて表示されることも `read_page` で確認）

- [ ] **Step 4: テスト全件＋HANDOVER追記**

Run: `cd web && npx vitest run`
`docs/HANDOVER_MASTER.md` の残タスク表に1行追記: 実装完了・本番で使う前に Cloudflare secret `OPERATOR_USER_IDS` にボスの本番UUID（`0573b242-…` で始まる管理者アカウント）を設定する必要がある旨（🙋ボス作業 or デプロイ時作業）。

- [ ] **Step 5: コミット（コミット前3ステップを通す）**

```bash
git status
git add docs/HANDOVER_MASTER.md
git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"
git commit -m "docs: 取引先インポートの結合確認結果と本番設定の残作業をHANDOVERに記録"
```

---

## デプロイ（本計画のスコープ外・実施は都度ボス確認）

- Cloudflare 側 secret に `OPERATOR_USER_IDS=<ボスの本番UUID>` を設定してからデプロイする。未設定のままデプロイしてもインポート画面は全員404（fail-closed）で安全側に倒れる。
- デプロイ手順自体は既存の手順書に従い、1コマンドずつ確認を取る。
