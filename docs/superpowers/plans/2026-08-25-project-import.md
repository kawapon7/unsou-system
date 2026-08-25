# 案件一括インポート＋案件カテゴリ列 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Excelから案件を一括登録できるようにし、あわせて帳票の「作業系」判定を案件名の文字列マッチから `projects.category` 列に置き換える。

**Architecture:** 既存の取引先一括インポート（`/admin/ops/import`）に4枚目のシート「案件」を足す。検証・変換は純関数 `web/src/utils/partner-import.ts` に集約し、登録は既存 Server Action `importPartners` に案件ループを追加する。案件の同一性はUUIDが担保するため、`project_code` は `P0001` 形式の自動採番（人が読むラベル）。

**Tech Stack:** Next.js (App Router) / TypeScript / Supabase (Postgres) / vitest / xlsx (SheetJS)

**設計書:** `docs/superpowers/specs/2026-08-25-project-import-design.md`

## Global Constraints

- テスト実行は `cd web && npx vitest run`、型チェックは `cd web && npx tsc --noEmit`。Node は mise 管理のため、Bash から叩くときは `/Users/atsushikawasaki/.local/share/mise/shims/npx` を使う
- DBアクセスは必ず Server Actions 経由。クライアントからの直接クエリ禁止
- 口座情報の平文保存は禁止（本計画では口座に触れないが、既存アクション経由の原則を崩さない）
- `approval_history` / `notification_logs` への UPDATE / DELETE 禁止
- コミット前に `git status` で `.next/` `.open-next/` が含まれないことを確認し、`git add` はファイルを明示する
- 案件の挿入は `createProject`（`web/src/app/admin/projects/actions.ts`）経由。`tenant_id` 付与をそちらに委ねる
- カテゴリ列の値は `'transport'`（輸送系）/ `'work'`（作業系）の2値のみ
- テンプレの区分列の表記は `輸送系` / `作業系`
- 本番へのマイグレーション適用とデプロイはボスの承認を得てから、**マイグレーション適用 → デプロイ** の順で行う

---

### Task 1: NUL文字の解消（git差分を復活させる）

`web/src/utils/partner-import.ts` の `departmentKey` にリテラルのNUL文字が埋まっており、gitがこのファイルをバイナリ扱いにしている。以降のタスクで同じファイルを大きく編集するため、最初に直す。

**Files:**
- Modify: `web/src/utils/partner-import.ts`（`departmentKey` 関数）
- Test: `web/src/utils/partner-import.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `departmentKey(clientName: string, deptName: string): string` — 戻り値の仕様は変更なし（区切りはNUL文字1個）

- [ ] **Step 1: 現状がバイナリ扱いであることを確認**

```bash
file web/src/utils/partner-import.ts
```

Expected: `web/src/utils/partner-import.ts: data`（テキストとして認識されていない）

- [ ] **Step 2: 失敗するテストを書く**

`web/src/utils/partner-import.test.ts` の末尾に追加する。

```typescript
describe('departmentKey', () => {
  it('NUL文字区切りのキーを返す', () => {
    expect(departmentKey('テスト商事', '物流部')).toBe('テスト商事\u0000物流部')
  })

  it('会社名に区切りらしき文字が含まれても衝突しない', () => {
    expect(departmentKey('A 社', 'B')).not.toBe(departmentKey('A', ' 社B'))
  })
})
```

- [ ] **Step 3: テストを実行して通ることを確認**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run partner-import`
Expected: PASS（現在の実装もNUL区切りのため、このテストは現時点で通る。これは「置き換え後も同じ値」を保証するための固定テスト）

- [ ] **Step 4: リテラルNUL文字をエスケープ表記に置き換える**

`departmentKey` の本体を書き換える。区切り文字はソース上 `\u0000` と書く（実行時の値は同じ）。

```typescript
// 部署の重複検査キー。区切りに通常の文字列が使わないNUL文字を使い、
// 会社名・部署名それぞれに区切り文字が含まれていても衝突しないようにする。
// ⚠️ ソース上は必ずエスケープ表記 \u0000 で書くこと。リテラルのNUL文字を埋め込むと
//    ファイルがバイナリ扱いになり、git diff が出ずレビューもシークレット走査もできなくなる。
export function departmentKey(clientName: string, deptName: string): string {
  return `${clientName}\u0000${deptName}`
}
```

- [ ] **Step 5: テキストファイルに戻ったことを確認**

```bash
file web/src/utils/partner-import.ts && git diff --stat web/src/utils/partner-import.ts
```

Expected: `Unicode text, UTF-8 text` と表示され、`git diff --stat` が `Bin` ではなく行数（`| 4 ++--` のような表示）を返す

- [ ] **Step 6: テストと型チェック**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run && /Users/atsushikawasaki/.local/share/mise/shims/npx tsc --noEmit`
Expected: 全テストPASS、型エラーなし

- [ ] **Step 7: Commit**

```bash
git add web/src/utils/partner-import.ts web/src/utils/partner-import.test.ts
git commit -m "fix: partner-import.tsのリテラルNUL文字をエスケープ表記に置換（git差分とシークレット走査を復活）"
```

---

### Task 2: マイグレーション（projects.category）

**Files:**
- Create: `supabase/migrations/20260825000000_projects_category.sql`
- Modify: `web/src/types/supabase.ts`（型の再生成）

**Interfaces:**
- Consumes: なし
- Produces: `projects.category`（`text NOT NULL DEFAULT 'transport'`、`check (category in ('transport','work'))`）。TypeScript の `Database['public']['Tables']['projects']['Row']` に `category: string` が現れる

- [ ] **Step 1: マイグレーションを作成**

`supabase/migrations/20260825000000_projects_category.sql`:

```sql
-- 案件の区分（2026-08-25）
-- 従来 web/src/utils/ooba-invoice-lines.ts が案件名に「作業」「デバンニング」「荷役」を
-- 含むかで作業系を判定していた。案件名を変えただけで帳票の並び順と
-- 「※人員結果は別紙参照」の出し分けが変わる状態を解消するための列。
-- 既定 'transport': 未設定の案件は輸送系として扱う（従来の判定で false だった側と一致）。
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'transport';

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_category_check;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_category_check CHECK (category IN ('transport', 'work'));

-- 既存行を従来ルールと同じ基準でバックフィルし、移行前後で帳票の出力を変えない
UPDATE public.projects
SET category = 'work'
WHERE category = 'transport'
  AND (project_name LIKE '%作業%'
    OR project_name LIKE '%デバンニング%'
    OR project_name LIKE '%荷役%');

COMMENT ON COLUMN public.projects.category IS
  '案件の区分。transport=輸送系 / work=作業系（デバンニング・荷役等）。帳票の並び順と別紙注記の判定に使う';
```

- [ ] **Step 2: テスト環境（hbpnhbsmsuhjyrohpluu）に適用**

Supabase MCP の `apply_migration` を使う。name は `projects_category`、query は Step 1 のSQL全文。

⚠️ 本番（`lsgvnxiuidvwefihjbcu`）にはこの段階で適用しない。本番適用はボスの承認を得て、デプロイ直前に行う。

- [ ] **Step 3: 列とバックフィルを確認**

Supabase MCP の `execute_sql`（project_id: `hbpnhbsmsuhjyrohpluu`）で実行:

```sql
select category, count(*) from projects group by category order by category;
```

Expected: `transport` と（デモデータに作業系の案件名があれば）`work` が返り、合計が案件総数と一致する

- [ ] **Step 4: 型を再生成**

Supabase MCP の `generate_typescript_types`（project_id: `hbpnhbsmsuhjyrohpluu`）を実行し、出力で `web/src/types/supabase.ts` を置き換える。

- [ ] **Step 5: 型チェック**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx tsc --noEmit`
Expected: 型エラーなし（この時点では `category` を読むコードがまだ無いため通る）

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260825000000_projects_category.sql web/src/types/supabase.ts
git commit -m "feat: projects.category（輸送系/作業系）を追加し既存行をバックフィル"
```

---

### Task 3: 帳票の判定をカテゴリ列に切り替える

**Files:**
- Modify: `web/src/utils/ooba-invoice-lines.ts:43-49`（`WORK_TYPE_WORDS` と `isWorkTypeProject` を削除し `isWorkCategory` を追加）
- Modify: `web/src/app/_actions/pdf-actions.ts:21,84,100,144-155`
- Test: `web/src/utils/ooba-invoice-lines.test.ts:12-13`

**Interfaces:**
- Consumes: Task 2 の `projects.category`
- Produces: `isWorkCategory(category: string | null | undefined): boolean` — `'work'` のときだけ true

- [ ] **Step 1: 失敗するテストを書く**

`web/src/utils/ooba-invoice-lines.test.ts` の既存の `isWorkTypeProject` を使うケース（12〜13行目付近）を、次の内容に**置き換える**。

```typescript
  it('カテゴリが work の案件だけ作業系として扱う', () => {
    expect(isWorkCategory('work')).toBe(true)
    expect(isWorkCategory('transport')).toBe(false)
  })

  it('カテゴリ未設定（案件なしの記録など）は作業系として扱わない', () => {
    expect(isWorkCategory(null)).toBe(false)
    expect(isWorkCategory(undefined)).toBe(false)
  })

  it('案件名に「作業」を含んでもカテゴリが transport なら作業系ではない', () => {
    // 文字列依存が切れたことの確認。名前は判定に一切使わない
    expect(isWorkCategory('transport')).toBe(false)
  })
```

同ファイル冒頭のimportから `isWorkTypeProject` を外し、`isWorkCategory` を加える。

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run ooba-invoice-lines`
Expected: FAIL（`isWorkCategory` が export されていない）

- [ ] **Step 3: 実装する**

`web/src/utils/ooba-invoice-lines.ts` の `WORK_TYPE_WORDS` と `isWorkTypeProject` を削除し、次に置き換える。

```typescript
/** 案件が作業系（デバンニング等）か。おおば様式で「※人員結果は別紙参照」を出す判定に使う。
 *  判定材料は projects.category のみ。案件名の文字列は見ない（名前は表示専用）。 */
export function isWorkCategory(category: string | null | undefined): boolean {
  return category === 'work'
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run ooba-invoice-lines`
Expected: PASS

- [ ] **Step 5: 呼び出し元（pdf-actions.ts）を切り替える**

21行目のimportを差し替える。

```typescript
import { buildOobaSubject, isWorkCategory } from '@/utils/ooba-invoice-lines'
```

84行目のselectに `category` を足す。

```typescript
    service.from('projects').select('id, project_name, category').eq('client_id', clientId),
```

100行目のマップを、案件名だけでなく行全体を持つ形にする。

```typescript
  const projMap  = new Map(projects.map(p => [p.id, p as { id: string; project_name: string; category: string | null }]))
```

144〜155行目の明細組み立てを次のようにする。

```typescript
  const lines: InvoicePdfLine[] = rawRows.map(r => {
    const proj         = r.project_id ? projMap.get(r.project_id) : undefined
    const projectName  = proj?.project_name ?? '（案件なし）'
    const rule         = r.project_id ? ruleMap.get(r.project_id) : undefined
    // 個数制（piece/hybrid）以外は日数制扱い。calculation_type を見ずに piece_count を
    // そのまま出すと、日数制の案件でも「○本」と誤表記されるため rule で判定する。
    const isPieceBased = rule?.calculation_type === 'piece' || rule?.calculation_type === 'hybrid'
    return {
      workDate:    r.work_date,
      projectName,
      quantity:    r.piece_count ?? 0,
      netAmount:   calcWorkAmount(r, rule, 'selling'),
      pieceCount:  isPieceBased ? (r.piece_count ?? null) : null,
      // 案件が紐づかない記録（突発・マスタ外）は輸送系扱い。従来も '（案件なし）' は false だった
      isWorkType:  isWorkCategory(proj?.category),
      contractorName: r.contractor_id ? (contractorNameMap.get(r.contractor_id) ?? null) : null,
    }
  })
```

⚠️ 306行目の `service.from('projects').select('id, project_name')` は支払通知書側の別処理で `isWorkType` を使っていないため、変更しない。

- [ ] **Step 6: 全テストと型チェック**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run && /Users/atsushikawasaki/.local/share/mise/shims/npx tsc --noEmit`
Expected: 全テストPASS、型エラーなし。`isWorkTypeProject` への参照が残っていれば型エラーで検出される

- [ ] **Step 7: 参照が消えたことを確認**

```bash
grep -rn "isWorkTypeProject\|WORK_TYPE_WORDS" web/src | cat
```

Expected: 出力なし

- [ ] **Step 8: Commit**

```bash
git add web/src/utils/ooba-invoice-lines.ts web/src/utils/ooba-invoice-lines.test.ts web/src/app/_actions/pdf-actions.ts
git commit -m "refactor: 帳票の作業系判定を案件名の文字列マッチからcategory列へ移行"
```

---

### Task 4: 案件シートの型・ヘッダ・正規化関数

**Files:**
- Modify: `web/src/utils/partner-import.ts`（型定義・`SHEET_NAMES`・`TEMPLATE_HEADERS`・正規化関数）
- Test: `web/src/utils/partner-import.test.ts`

**Interfaces:**
- Consumes: Task 1 の `departmentKey`
- Produces:
  - `SHEET_NAMES.projects = '案件'`
  - `TEMPLATE_HEADERS.projects = ['荷主','部署','案件名','区分','委託先','売上単価','仕入単価']`
  - `ImportFile` に `projects: RawRow[]` が加わる
  - `ExistingSets` に `clientUseDepartments?: Record<string, boolean>` と `projectKeys?: string[]` が加わる（省略可。既存の呼び出しを壊さない）
  - `ConvertedImport` に `projects: Array<{ clientName: string; departmentName: string | null; contractorName: string | null; payload: Record<string, unknown> }>` が加わる
  - `normalizeName(s: string): string`
  - `projectKey(clientName: string, deptName: string | null, projectName: string): string`

- [ ] **Step 1: 失敗するテストを書く**

`web/src/utils/partner-import.test.ts` に追加する。

```typescript
describe('normalizeName / projectKey', () => {
  it('全角英数字・空白・大文字小文字の違いを吸収する', () => {
    expect(normalizeName('ＡＢＣ 便')).toBe(normalizeName('abc便'))
    expect(normalizeName('広島　便')).toBe(normalizeName('広島便'))
    expect(normalizeName(' 定期便 ')).toBe('定期便')
  })

  it('projectKey は荷主・部署・正規化した案件名で構成される', () => {
    expect(projectKey('テスト商事', '物流部', '広島　便'))
      .toBe('テスト商事\u0000物流部\u0000広島便')
  })

  it('部署なしは空文字として扱い、部署ありと区別される', () => {
    expect(projectKey('テスト商事', null, '定期便'))
      .not.toBe(projectKey('テスト商事', '物流部', '定期便'))
  })
})
```

同ファイル冒頭のimportに `normalizeName` と `projectKey` を加える。

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run partner-import`
Expected: FAIL（`normalizeName` が export されていない）

- [ ] **Step 3: 型と定数を追加**

`web/src/utils/partner-import.ts` の該当箇所を書き換える。

```typescript
export type ImportFile = {
  contractors: RawRow[]
  clients: RawRow[]
  departments: RawRow[]
  projects: RawRow[]
}

export type ExistingSets = {
  clientNames: string[]
  contractorNames: string[]
  contractorEmails: string[]
  departmentKeys: string[]
  // ここから案件インポート用。省略時は空として扱い、既存の呼び出しを壊さない
  clientUseDepartments?: Record<string, boolean>
  projectKeys?: string[]
}

export type ConvertedImport = {
  clients: Array<Record<string, unknown>>
  departments: Array<{ clientName: string; payload: Record<string, unknown> }>
  contractors: Array<Record<string, unknown>>
  projects: Array<{
    clientName: string
    departmentName: string | null
    contractorName: string | null
    payload: Record<string, unknown>
  }>
}

export const SHEET_NAMES = {
  contractors: '委託先',
  clients: '請求先',
  departments: '部署',
  projects: '案件',
} as const
```

`TEMPLATE_HEADERS` に案件を追加する。

```typescript
  projects: [
    '荷主', '部署', '案件名', '区分', '委託先', '売上単価', '仕入単価',
  ],
```

- [ ] **Step 4: 正規化関数を追加**

`departmentKey` の下に追加する。

```typescript
/** 比較専用の正規化。NFKCで全角英数字を半角化 → 空白を全除去 → 小文字化。
 *  ⚠️ 保存する値には使わない。表示名はExcelに書かれたままにする。 */
export function normalizeName(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/** 案件の重複検査キー。荷主・部署は完全一致で照合済みの値をそのまま使い、
 *  案件名だけ表記ゆれを吸収して比較する。部署なしは空文字。 */
export function projectKey(clientName: string, deptName: string | null, projectName: string): string {
  return `${clientName}\u0000${deptName ?? ''}\u0000${normalizeName(projectName)}`
}
```

- [ ] **Step 5: テストを実行して通ることを確認**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run partner-import`
Expected: 新規テストはPASS。既存テストは `ImportFile` に `projects` が必須になったことで**型エラー**になる（次のStepで直す）

- [ ] **Step 6: 既存テストの ImportFile リテラルに projects を足す**

既存テスト内の `validateAndConvert({ contractors: [...], clients: [...], departments: [...] }, ...)` の呼び出しすべてに `projects: []` を追加する。

- [ ] **Step 7: テストと型チェック**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run && /Users/atsushikawasaki/.local/share/mise/shims/npx tsc --noEmit`
Expected: 全テストPASS、型エラーなし

- [ ] **Step 8: Commit**

```bash
git add web/src/utils/partner-import.ts web/src/utils/partner-import.test.ts
git commit -m "feat: 案件シートの型・ヘッダ定義と表記ゆれ正規化関数を追加"
```

---

### Task 5: 案件行の検証・変換（必須・区分・数値）

**Files:**
- Modify: `web/src/utils/partner-import.ts`（`validateAndConvertProjects` を新設し `validateAndConvert` から呼ぶ）
- Test: `web/src/utils/partner-import.test.ts`

**Interfaces:**
- Consumes: Task 4 の型・`normalizeName`・`projectKey`
- Produces: `validateAndConvert` の戻り値 `data.projects` に、`payload` が `{ project_name, category, sale_amount, buy_amount, unit_type, status, driver_visible }` を持つ要素が入る（`project_code` と各IDは登録時に付与するためここには含めない）

- [ ] **Step 1: 失敗するテストを書く**

`web/src/utils/partner-import.test.ts` に追加する。テスト用の共通データも定義する。

```typescript
const validProject = {
  '荷主': 'テスト商事', '部署': '物流部', '案件名': '広島定期便', '区分': '輸送系',
  '委託先': '山田運送', '売上単価': '15000', '仕入単価': '12000',
}
const existingWithClient = {
  ...noExisting,
  clientNames: ['テスト商事'],
  clientUseDepartments: { 'テスト商事': true },
  departmentKeys: [departmentKey('テスト商事', '物流部')],
  contractorNames: ['山田運送'],
}

describe('案件シート 正常系', () => {
  it('案件行が変換される', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [validProject] },
      existingWithClient,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects).toHaveLength(1)
    expect(r.data!.projects[0]).toMatchObject({
      clientName: 'テスト商事',
      departmentName: '物流部',
      contractorName: '山田運送',
    })
    expect(r.data!.projects[0].payload).toMatchObject({
      project_name: '広島定期便',
      category: 'transport',
      sale_amount: 15000,
      buy_amount: 12000,
      unit_type: 'quantity',
      status: 'accepted',
      driver_visible: true,
    })
  })

  it('区分「作業系」は category=work になる', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '区分': '作業系' }] },
      existingWithClient,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects[0].payload).toMatchObject({ category: 'work' })
  })

  it('委託先と仕入単価は空欄でよい', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '委託先': '', '仕入単価': '' }] },
      existingWithClient,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects[0].contractorName).toBeNull()
    expect(r.data!.projects[0].payload).toMatchObject({ buy_amount: null })
  })

  it('全角数字とカンマ区切りを受け入れる', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '売上単価': '１５，０００', '仕入単価': '12,000' }] },
      existingWithClient,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects[0].payload).toMatchObject({ sale_amount: 15000, buy_amount: 12000 })
  })
})

describe('案件シート エラー系', () => {
  it('荷主・案件名・区分・売上単価の空欄はエラー', () => {
    const r = validateAndConvert(
      {
        contractors: [], clients: [], departments: [],
        projects: [{ ...validProject, '荷主': '', '案件名': '', '区分': '', '売上単価': '' }],
      },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    const cols = r.errors.map(e => e.column)
    expect(cols).toEqual(expect.arrayContaining(['荷主', '案件名', '区分', '売上単価']))
  })

  it('区分が列挙値以外ならエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '区分': '配送' }] },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    expect(r.errors[0]).toMatchObject({ sheet: '案件', column: '区分' })
  })

  it('単価が負数や文字混じりならエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '売上単価': '-100', '仕入単価': '1万円' }] },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    expect(r.errors.map(e => e.column)).toEqual(expect.arrayContaining(['売上単価', '仕入単価']))
  })

  it('ガイド行と記入例行はスキップされる', () => {
    const r = validateAndConvert(
      {
        contractors: [], clients: [], departments: [],
        projects: [
          { ...validProject, '荷主': '※必須' },
          { ...validProject, '荷主': '例）株式会社サンプル商事' },
          validProject,
        ],
      },
      existingWithClient,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects).toHaveLength(1)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run partner-import`
Expected: FAIL（`data.projects` が undefined、または案件シートが処理されない）

- [ ] **Step 3: 定数とヘルパーを追加**

`web/src/utils/partner-import.ts` の内部定数の並びに追加する。

```typescript
const CATEGORY_MAP: Record<string, string> = { '輸送系': 'transport', '作業系': 'work' }

/** '15,000' '１５０００' を 15000 にする。0以上の整数として解釈できなければ null。 */
function parseAmount(v: string): number | null {
  const s = v.normalize('NFKC').replace(/,/g, '').trim()
  if (!/^\d+$/.test(s)) return null
  return Number(s)
}
```

- [ ] **Step 4: 案件の検証・変換関数を実装**

`validateAndConvertDepartments` の下に追加する。この Step では必須・区分・数値のみ扱い、参照解決と重複は Task 6 で足す。

```typescript
function validateAndConvertProjects(
  rows: RawRow[],
  errors: RowError[],
): ConvertedImport['projects'] {
  const sheet = SHEET_NAMES.projects
  const results: ConvertedImport['projects'] = []

  rows.forEach((row, index) => {
    if (isExampleRow(row)) return
    if (isBlankRow(row)) return

    const clientName = row['荷主'] ?? ''
    if (!clientName) pushError(errors, sheet, index, '荷主', '必須項目です')

    const projectName = row['案件名'] ?? ''
    if (!projectName) pushError(errors, sheet, index, '案件名', '必須項目です')

    const categoryLabel = row['区分'] ?? ''
    if (!categoryLabel) {
      pushError(errors, sheet, index, '区分', '必須項目です')
    } else if (!(categoryLabel in CATEGORY_MAP)) {
      pushError(errors, sheet, index, '区分', `「${Object.keys(CATEGORY_MAP).join('」「')}」のいずれかで入力してください`)
    }

    const saleRaw = row['売上単価'] ?? ''
    const sale = saleRaw === '' ? null : parseAmount(saleRaw)
    if (saleRaw === '') {
      pushError(errors, sheet, index, '売上単価', '必須項目です')
    } else if (sale === null) {
      pushError(errors, sheet, index, '売上単価', '0以上の整数で入力してください')
    }

    const buyRaw = row['仕入単価'] ?? ''
    const buy = buyRaw === '' ? null : parseAmount(buyRaw)
    if (buyRaw !== '' && buy === null) {
      pushError(errors, sheet, index, '仕入単価', '0以上の整数で入力してください')
    }

    const deptName = row['部署'] ?? ''
    const contractorName = row['委託先'] ?? ''

    results.push({
      clientName,
      departmentName: deptName === '' ? null : deptName,
      contractorName: contractorName === '' ? null : contractorName,
      payload: {
        project_name: projectName,
        category: CATEGORY_MAP[categoryLabel] ?? categoryLabel,
        sale_amount: sale ?? 0,
        buy_amount: buy,
        unit_type: 'quantity',
        status: 'accepted',
        driver_visible: true,
      },
    })
  })

  return results
}
```

- [ ] **Step 5: エントリポイントから呼ぶ**

`validateAndConvert` を書き換える。

```typescript
export function validateAndConvert(
  file: ImportFile,
  existing: ExistingSets,
): { data: ConvertedImport | null; errors: RowError[] } {
  const errors: RowError[] = []

  const clients = validateAndConvertClients(file.clients, errors, existing)
  const contractors = validateAndConvertContractors(file.contractors, errors, existing)

  const fileClientNames = new Set(
    file.clients.filter(r => !isExampleRow(r)).map(r => r['会社名']).filter(Boolean),
  )
  const departments = validateAndConvertDepartments(file.departments, errors, fileClientNames, existing)
  const projects = validateAndConvertProjects(file.projects, errors)

  if (errors.length > 0) {
    return { data: null, errors }
  }

  return { data: { clients, contractors, departments, projects }, errors: [] }
}
```

- [ ] **Step 6: テストを実行して通ることを確認**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run partner-import`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/utils/partner-import.ts web/src/utils/partner-import.test.ts
git commit -m "feat: 案件行の検証・変換（必須項目・区分・単価）を追加"
```

---

### Task 6: 案件の参照解決・部署要否・重複検査

**Files:**
- Modify: `web/src/utils/partner-import.ts`（`validateAndConvertProjects` の引数と本体）
- Test: `web/src/utils/partner-import.test.ts`

**Interfaces:**
- Consumes: Task 5 の `validateAndConvertProjects`、Task 4 の `projectKey` / `ExistingSets`
- Produces: 同関数のシグネチャが `(rows, errors, fileClientNames, fileUseDepartments: Map<string, boolean>, fileDeptKeys: Set<string>, fileContractorNames: Set<string>, existing: ExistingSets)` になる

- [ ] **Step 1: 失敗するテストを書く**

```typescript
describe('案件シート 参照解決と重複', () => {
  it('同一ファイル内の請求先・部署・委託先で解決できる', () => {
    const r = validateAndConvert(
      {
        clients: [validClient],                       // テスト商事・部署を使う=あり
        departments: [validDept],                     // テスト商事・物流部
        contractors: [validContractor],               // 山田運送
        projects: [{ ...validProject, '委託先': '山田運送' }],
      },
      noExisting,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects).toHaveLength(1)
  })

  it('どちらにも無い荷主はエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '荷主': '知らない会社' }] },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    expect(r.errors.some(e => e.column === '荷主')).toBe(true)
  })

  it('どちらにも無い委託先はエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '委託先': '知らない運送' }] },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    expect(r.errors.some(e => e.column === '委託先')).toBe(true)
  })

  it('部署を使う荷主で部署が空欄ならエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '部署': '' }] },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    expect(r.errors.some(e => e.column === '部署')).toBe(true)
  })

  it('部署を使わない荷主に部署が書かれていたらエラー', () => {
    const existing = {
      ...existingWithClient,
      clientUseDepartments: { 'テスト商事': false },
      departmentKeys: [],
    }
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [validProject] },
      existing,
    )
    expect(r.data).toBeNull()
    expect(r.errors.some(e => e.column === '部署' && e.reason.includes('部署を使わない'))).toBe(true)
  })

  it('存在しない部署名はエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [{ ...validProject, '部署': '経理部' }] },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    expect(r.errors.some(e => e.column === '部署')).toBe(true)
  })

  it('ファイル内で荷主・部署・案件名が重複したらエラー', () => {
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [validProject, validProject] },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    expect(r.errors.some(e => e.column === '案件名')).toBe(true)
  })

  it('表記ゆれ（全角空白・全角英数字）も重複として検出する', () => {
    const r = validateAndConvert(
      {
        contractors: [], clients: [], departments: [],
        projects: [validProject, { ...validProject, '案件名': '広島　定期便' }],
      },
      existingWithClient,
    )
    expect(r.data).toBeNull()
    expect(r.errors.some(e => e.column === '案件名')).toBe(true)
  })

  it('既存DBと重複したらエラー', () => {
    const existing = {
      ...existingWithClient,
      projectKeys: [projectKey('テスト商事', '物流部', '広島定期便')],
    }
    const r = validateAndConvert(
      { contractors: [], clients: [], departments: [], projects: [validProject] },
      existing,
    )
    expect(r.data).toBeNull()
    expect(r.errors.some(e => e.reason.includes('既に登録されている'))).toBe(true)
  })

  it('部署が違えば同じ案件名でも通る', () => {
    const existing = {
      ...existingWithClient,
      departmentKeys: [departmentKey('テスト商事', '物流部'), departmentKey('テスト商事', '第二物流部')],
    }
    const r = validateAndConvert(
      {
        contractors: [], clients: [], departments: [],
        projects: [validProject, { ...validProject, '部署': '第二物流部' }],
      },
      existing,
    )
    expect(r.errors).toEqual([])
    expect(r.data!.projects).toHaveLength(2)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run partner-import`
Expected: FAIL（参照解決・重複検査が未実装のため、エラーが出るべきケースで `errors` が空）

- [ ] **Step 3: 検証本体に参照解決と重複を実装**

`validateAndConvertProjects` を次の内容で**丸ごと置き換える**（前半は Task 5 と同じ検証、後半が今回の追加分）。

```typescript
function validateAndConvertProjects(
  rows: RawRow[],
  errors: RowError[],
  fileClientNames: Set<string>,
  fileUseDepartments: Map<string, boolean>,
  fileDeptKeys: Set<string>,
  fileContractorNames: Set<string>,
  existing: ExistingSets,
): ConvertedImport['projects'] {
  const sheet = SHEET_NAMES.projects
  const results: ConvertedImport['projects'] = []
  const seenKeys = new Set<string>()
  const existingProjectKeys = existing.projectKeys ?? []

  rows.forEach((row, index) => {
    if (isExampleRow(row)) return
    if (isBlankRow(row)) return

    const clientName = row['荷主'] ?? ''
    if (!clientName) pushError(errors, sheet, index, '荷主', '必須項目です')

    const projectName = row['案件名'] ?? ''
    if (!projectName) pushError(errors, sheet, index, '案件名', '必須項目です')

    const categoryLabel = row['区分'] ?? ''
    if (!categoryLabel) {
      pushError(errors, sheet, index, '区分', '必須項目です')
    } else if (!(categoryLabel in CATEGORY_MAP)) {
      pushError(errors, sheet, index, '区分', `「${Object.keys(CATEGORY_MAP).join('」「')}」のいずれかで入力してください`)
    }

    const saleRaw = row['売上単価'] ?? ''
    const sale = saleRaw === '' ? null : parseAmount(saleRaw)
    if (saleRaw === '') {
      pushError(errors, sheet, index, '売上単価', '必須項目です')
    } else if (sale === null) {
      pushError(errors, sheet, index, '売上単価', '0以上の整数で入力してください')
    }

    const buyRaw = row['仕入単価'] ?? ''
    const buy = buyRaw === '' ? null : parseAmount(buyRaw)
    if (buyRaw !== '' && buy === null) {
      pushError(errors, sheet, index, '仕入単価', '0以上の整数で入力してください')
    }

    const deptName = row['部署'] ?? ''
    const contractorName = row['委託先'] ?? ''

    // 荷主の存在確認（ファイル内 or 既存DB）
    const clientKnown = fileClientNames.has(clientName) || existing.clientNames.includes(clientName)
    if (clientName && !clientKnown) {
      pushError(errors, sheet, index, '荷主', '請求先シートにも既存データにも見つかりません')
    }

    // 部署の要否。ファイル内の請求先シートを優先し、無ければ既存DBの設定を見る
    const usesDept = fileUseDepartments.get(clientName) ?? existing.clientUseDepartments?.[clientName]
    if (clientName && clientKnown && usesDept !== undefined) {
      if (usesDept && !deptName) {
        pushError(errors, sheet, index, '部署', 'この荷主は部署を使う設定です。部署名を入力してください')
      }
      if (!usesDept && deptName) {
        pushError(errors, sheet, index, '部署', 'この荷主は部署を使わない設定です。部署は空欄にしてください')
      }
    }

    // 部署の存在確認
    if (clientName && deptName) {
      const key = departmentKey(clientName, deptName)
      if (!fileDeptKeys.has(key) && !existing.departmentKeys.includes(key)) {
        pushError(errors, sheet, index, '部署', '部署シートにも既存データにも見つかりません')
      }
    }

    // 委託先の存在確認（任意項目。書かれていれば照合する）
    if (contractorName
      && !fileContractorNames.has(contractorName)
      && !existing.contractorNames.includes(contractorName)) {
      pushError(errors, sheet, index, '委託先', '委託先シートにも既存データにも見つかりません')
    }

    // 重複検査（案件名の表記ゆれは projectKey 側で吸収）
    if (clientName && projectName) {
      const key = projectKey(clientName, deptName === '' ? null : deptName, projectName)
      if (seenKeys.has(key)) {
        pushError(errors, sheet, index, '案件名', 'ファイル内で荷主+部署+案件名が重複しています')
      }
      seenKeys.add(key)
      if (existingProjectKeys.includes(key)) {
        pushError(errors, sheet, index, '案件名', '既に登録されている案件です')
      }
    }

    results.push({
      clientName,
      departmentName: deptName === '' ? null : deptName,
      contractorName: contractorName === '' ? null : contractorName,
      payload: {
        project_name: projectName,
        category: CATEGORY_MAP[categoryLabel] ?? categoryLabel,
        sale_amount: sale ?? 0,
        buy_amount: buy,
        unit_type: 'quantity',
        status: 'accepted',
        driver_visible: true,
      },
    })
  })

  return results
}
```

- [ ] **Step 4: エントリポイントから必要な集合を渡す**

`validateAndConvert` を書き換える。

```typescript
  const fileUseDepartments = new Map<string, boolean>()
  for (const r of file.clients) {
    if (isExampleRow(r) || isBlankRow(r)) continue
    const name = r['会社名'] ?? ''
    if (name) fileUseDepartments.set(name, (r['部署を使う'] ?? '') === 'あり')
  }

  const fileDeptKeys = new Set(
    file.departments
      .filter(r => !isExampleRow(r) && !isBlankRow(r))
      .map(r => departmentKey(r['請求先名'] ?? '', r['部署名'] ?? '')),
  )

  const fileContractorNames = new Set(
    file.contractors
      .filter(r => !isExampleRow(r) && !isBlankRow(r))
      .map(r => r['名前'] ?? '')
      .filter(Boolean),
  )

  const projects = validateAndConvertProjects(
    file.projects, errors, fileClientNames, fileUseDepartments, fileDeptKeys, fileContractorNames, existing,
  )
```

- [ ] **Step 5: テストと型チェック**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run && /Users/atsushikawasaki/.local/share/mise/shims/npx tsc --noEmit`
Expected: 全テストPASS、型エラーなし

- [ ] **Step 6: Commit**

```bash
git add web/src/utils/partner-import.ts web/src/utils/partner-import.test.ts
git commit -m "feat: 案件の参照解決・部署要否・重複検査（表記ゆれ吸収）を追加"
```

---

### Task 7: 案件コードの採番

**Files:**
- Modify: `web/src/utils/partner-import.ts`
- Test: `web/src/utils/partner-import.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `buildProjectCodes(existingCodes: (string | null)[], count: number): string[]`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
describe('buildProjectCodes', () => {
  it('既存が無ければ P0001 から始まる', () => {
    expect(buildProjectCodes([], 3)).toEqual(['P0001', 'P0002', 'P0003'])
  })

  it('既存の最大値の次から続ける', () => {
    expect(buildProjectCodes(['P0001', 'P0007', 'P0003'], 2)).toEqual(['P0008', 'P0009'])
  })

  it('P形式でないコード（突発案件のSP-…）や null は無視する', () => {
    expect(buildProjectCodes(['SP-20260824-AB12X', null, 'P0002'], 1)).toEqual(['P0003'])
  })

  it('4桁を超えたら桁が増える', () => {
    expect(buildProjectCodes(['P9999'], 1)).toEqual(['P10000'])
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run partner-import`
Expected: FAIL（`buildProjectCodes` が export されていない）

- [ ] **Step 3: 実装する**

```typescript
/** 案件コードを連番で採番する。既存の `P` + 数字 形式の最大値の次から始める。
 *  突発案件が生成する `SP-YYYYMMDD-XXXXX` 形式（project-actions.ts）は接頭辞が違うため衝突しない。 */
export function buildProjectCodes(existingCodes: (string | null)[], count: number): string[] {
  let max = 0
  for (const code of existingCodes) {
    const m = /^P(\d+)$/.exec(code ?? '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return Array.from({ length: count }, (_, i) => `P${String(max + 1 + i).padStart(4, '0')}`)
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run partner-import`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/utils/partner-import.ts web/src/utils/partner-import.test.ts
git commit -m "feat: 案件コードの自動採番（P0001形式）を追加"
```

---

### Task 8: Server Action に案件登録を追加

**Files:**
- Modify: `web/src/app/_actions/partnerImportActions.ts`
- Modify: `web/src/app/admin/projects/actions.ts`（`fetchProjectsForImport` を追加）

**Interfaces:**
- Consumes: Task 4〜7 の `validateAndConvert` / `projectKey` / `buildProjectCodes`、既存の `createProject`
- Produces: `ImportResult` の `inserted` に `projects: number` が加わる

- [ ] **Step 1: 既存案件を引く関数を追加**

`web/src/app/admin/projects/actions.ts` の末尾に追加する。`fetchProjects` は price_rules や稼働件数まで引いて重いため、インポートの重複検査用に軽い関数を分ける。

```typescript
/** インポートの重複検査・採番用。案件コードと (荷主名・部署名・案件名) だけを引く軽量版。 */
export async function fetchProjectsForImport(): Promise<ActionResult<{
  project_code: string | null
  project_name: string
  client_name: string
  department_name: string | null
}[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('projects')
    .select('project_code, project_name, clients(company_name), client_departments(name)')
    .eq('tenant_id', tenantId)
  if (error) return { data: null, error: error.message }

  const rows = (data ?? []).map((r: any) => ({
    project_code:    r.project_code ?? null,
    project_name:    r.project_name as string,
    client_name:     r.clients?.company_name ?? '',
    department_name: r.client_departments?.name ?? null,
  }))
  return { data: rows, error: null }
}
```

- [ ] **Step 2: importPartners に案件の重複キーと採番材料を渡す**

`web/src/app/_actions/partnerImportActions.ts` の import に追加する。

```typescript
import { validateAndConvert, departmentKey, projectKey, buildProjectCodes, type ImportFile, type RowError } from '@/utils/partner-import'
import { createProject, fetchProjectsForImport } from '@/app/admin/projects/actions'
```

既存データ取得の直後に、案件の既存情報を取る処理を足す。

```typescript
  const projectsRes = await fetchProjectsForImport()
  if (projectsRes.error) return { ok: false, errors: [], fatal: projectsRes.error }
  const existingProjects = projectsRes.data ?? []
```

`validateAndConvert` の呼び出しに2つのキーを足す。

```typescript
  const validated = validateAndConvert(file, {
    clientNames: existingClients.map(c => c.company_name),
    contractorNames: (contractorsRes.data ?? []).map(c => c.name),
    contractorEmails: (contractorsRes.data ?? []).map(c => c.email),
    departmentKeys,
    clientUseDepartments: Object.fromEntries(
      existingClients.map(c => [c.company_name, !!(c as { use_departments?: boolean }).use_departments]),
    ),
    projectKeys: existingProjects.map(p => projectKey(p.client_name, p.department_name, p.project_name)),
  })
```

- [ ] **Step 3: 件数の型と初期値に projects を足す**

```typescript
export type ImportResult =
  | { ok: true; inserted: { clients: number; departments: number; contractors: number; projects: number } }
  | { ok: false; errors: RowError[]; fatal?: string }
```

```typescript
  const { clients, departments, contractors, projects } = validated.data
  const inserted = { clients: 0, departments: 0, contractors: 0, projects: 0 }
```

`partialFailure` の引数の型と文言も合わせる。

```typescript
function partialFailure(
  sheet: string,
  inserted: { clients: number; departments: number; contractors: number; projects: number },
  message: string,
): ImportResult {
  return {
    ok: false,
    errors: [],
    fatal:
      `${sheet}の挿入中にエラー: ${message}\n` +
      `ここまでの登録: 請求先${inserted.clients}件・部署${inserted.departments}件・` +
      `委託先${inserted.contractors}件・案件${inserted.projects}件。` +
      `登録済み分は重複検査で弾かれるため、残りだけのファイルを作り再実行してください。`,
  }
}
```

- [ ] **Step 4: 部署・委託先のIDマップを作り、案件を登録する**

既存の委託先ループの下に追加する。部署IDは登録結果から拾い、既存分は取得済みの一覧から補う。

```typescript
  // 案件の紐づけ用IDマップ。既存分と今回登録した分の両方を含める
  const departmentIdByKey = new Map<string, string>()
  for (const [i, c] of existingClients.entries()) {
    for (const d of departmentResults[i].data ?? []) {
      departmentIdByKey.set(departmentKey(c.company_name, d.name), d.id)
    }
  }
  const contractorIdByName = new Map<string, string>()
  for (const c of contractorsRes.data ?? []) contractorIdByName.set(c.name, c.id)

  const codes = buildProjectCodes(existingProjects.map(p => p.project_code), projects.length)

  for (const [i, p] of projects.entries()) {
    const clientId = clientIdByName.get(p.clientName)
    if (!clientId) return partialFailure('案件', inserted, `荷主「${p.clientName}」の解決に失敗しました`)

    let departmentId: string | null = null
    if (p.departmentName) {
      departmentId = departmentIdByKey.get(departmentKey(p.clientName, p.departmentName)) ?? null
      if (!departmentId) return partialFailure('案件', inserted, `部署「${p.departmentName}」の解決に失敗しました`)
    }

    let contractorId: string | null = null
    if (p.contractorName) {
      contractorId = contractorIdByName.get(p.contractorName) ?? null
      if (!contractorId) return partialFailure('案件', inserted, `委託先「${p.contractorName}」の解決に失敗しました`)
    }

    const r = await createProject({
      ...p.payload,
      project_code: codes[i],
      client_id: clientId,
      department_id: departmentId,
      contractor_id: contractorId,
    } as Parameters<typeof createProject>[0])
    if (r.error) return partialFailure('案件', inserted, r.error)
    inserted.projects++
  }
```

⚠️ 部署の登録ループ内で `departmentIdByKey` に今回作った部署も追加すること。既存ループの `inserted.departments++` の直前に次を入れる。

```typescript
    departmentIdByKey.set(departmentKey(d.clientName, String(d.payload.name)), r.data!.id)
```

そのため `departmentIdByKey` の宣言は部署ループより前に移動する。

- [ ] **Step 5: 型チェックとテスト**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx tsc --noEmit && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run`
Expected: 型エラーなし、全テストPASS

- [ ] **Step 6: Commit**

```bash
git add web/src/app/_actions/partnerImportActions.ts web/src/app/admin/projects/actions.ts
git commit -m "feat: 取引先インポートに案件の登録処理を追加（採番・ID解決・全件中止）"
```

---

### Task 9: 画面（テンプレ生成・件数表示・シート任意化）

**Files:**
- Modify: `web/src/app/admin/ops/import/ImportClient.tsx`

**Interfaces:**
- Consumes: Task 4 の `SHEET_NAMES` / `TEMPLATE_HEADERS`、Task 8 の `ImportResult`
- Produces: なし（画面のみ）

- [ ] **Step 1: SHEET_ORDER に案件を足す**

```typescript
// テンプレート出力・読み込みの対象シート（依存関係の順: 請求先→部署→委託先→案件）
const SHEET_ORDER = ['clients', 'departments', 'contractors', 'projects'] as const
```

- [ ] **Step 2: ガイド行と記入例行を足す**

`GUIDE_ROWS` と `EXAMPLE_ROWS` に案件を追加する。

```typescript
  projects: [
    '※必須（請求先シートの会社名と一致）', '荷主が「部署を使う=あり」の場合は必須', '必須',
    '必須（輸送系/作業系）', '任意（委託先シートの名前と一致）', '必須（数字のみ）', '任意（数字のみ）',
  ],
```

```typescript
  projects: [
    '例）株式会社サンプル商事', '東京支店', '広島定期便', '輸送系', '山田運送', '15000', '12000',
  ],
```

- [ ] **Step 3: 案件シートが無いファイルを許容する**

`handleFile` のシート読み取りで、案件シートだけは欠けていてもエラーにしない。既存のシート存在チェックを次のように変える。

```typescript
        const ws = wb.Sheets[SHEET_NAMES[key]]
        if (!ws) {
          // 案件シートは後方互換のため任意。取引先3シートは従来どおり必須
          if (key === 'projects') { next[key] = []; continue }
          setParseError(
            `シート「${SHEET_NAMES[key]}」が見つかりません。` +
            'テンプレートをダウンロードして、シート名を変更せずに入力してください。',
          )
          return
        }
```

- [ ] **Step 4: 件数表示に案件を足す**

プレビューの件数表示と成功メッセージを更新する。

```typescript
          請求先 {importFile.clients.filter(r => !isExampleRow(r)).length} 件 ／
          部署 {importFile.departments.filter(r => !isExampleRow(r)).length} 件 ／
          委託先 {importFile.contractors.filter(r => !isExampleRow(r)).length} 件 ／
          案件 {importFile.projects.filter(r => !isExampleRow(r)).length} 件
```

成功時のメッセージ（`result.inserted` を使っている箇所）にも `案件{result.inserted.projects}件` を足す。

- [ ] **Step 5: 説明文を更新**

「1. テンプレートをダウンロード」の説明文を次に差し替える。

```tsx
          <p className="text-xs text-zinc-500">請求先・部署・委託先・案件 の4シート構成です。</p>
```

- [ ] **Step 6: 型チェックとテスト**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx tsc --noEmit && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run`
Expected: 型エラーなし、全テストPASS

- [ ] **Step 7: Commit**

```bash
git add web/src/app/admin/ops/import/ImportClient.tsx
git commit -m "feat: インポート画面のテンプレに案件シートを追加（件数表示・シート任意化）"
```

---

### Task 10: 案件登録画面に区分の入力欄

**Files:**
- Modify: `web/src/app/admin/projects/page.tsx`（フォーム型・初期値・入力欄・payload）

**Interfaces:**
- Consumes: Task 2 の `projects.category`
- Produces: なし（画面のみ）

- [ ] **Step 1: フォーム型と初期値に category を足す**

`ProjectForm` 型（59行目付近）に追加する。

```typescript
  category:       string
```

初期値（79行目付近）に追加する。

```typescript
  category:       'transport',
```

編集時の読み込み（733行目付近、`unit_type: row.unit_type` の並び）に追加する。

```typescript
      category:       row.category ?? 'transport',
```

- [ ] **Step 2: 入力欄を追加**

案件名の入力欄の下に、区分のセレクトを置く。

```tsx
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">区分</label>
                <select
                  className={inputCls}
                  value={form.category}
                  onChange={e => set('category', e.target.value)}
                >
                  <option value="transport">輸送系</option>
                  <option value="work">作業系（デバンニング・荷役等）</option>
                </select>
                <p className="mt-1 text-xs text-zinc-400">
                  支払通知書の並び順と「※人員結果は別紙参照」の判定に使います。
                </p>
              </div>
```

- [ ] **Step 3: payload に足す**

`handleSubmit` の payload（756行目付近）に追加する。

```typescript
        category:       form.category,
```

- [ ] **Step 4: 型チェックとテスト**

Run: `cd web && /Users/atsushikawasaki/.local/share/mise/shims/npx tsc --noEmit && /Users/atsushikawasaki/.local/share/mise/shims/npx vitest run`
Expected: 型エラーなし、全テストPASS

- [ ] **Step 5: 画面で確認**

dev サーバー（`.claude/launch.json` の "Next.js dev"）を起動し、`/admin/projects` で案件を新規作成して区分を「作業系」で保存する。`read_page` で保存後の一覧を確認し、`execute_sql`（`hbpnhbsmsuhjyrohpluu`）で `select project_name, category from projects order by created_at desc limit 3` が `work` を返すことを確認する。

- [ ] **Step 6: Commit**

```bash
git add web/src/app/admin/projects/page.tsx
git commit -m "feat: 案件登録画面に区分（輸送系/作業系）の入力欄を追加"
```

---

### Task 11: E2E確認とドキュメント更新

**Files:**
- Modify: `docs/PARTNER_IMPORT_MANUAL.md`
- Modify: `docs/HANDOVER_MASTER.md`（§5-2 に完了を記録）

**Interfaces:**
- Consumes: Task 1〜10 のすべて
- Produces: なし

- [ ] **Step 1: テスト用xlsxを生成する**

スクラッチパッドにスクリプトを作り、`TEMPLATE_HEADERS` と同じ構成で4シートのファイルを作る。請求先1・部署1・委託先1・案件2（輸送系1・作業系1）とする。

```bash
cd web && NODE_PATH=$PWD/node_modules /Users/atsushikawasaki/.local/share/mise/shims/npx tsx <スクリプトパス> <出力先.xlsx>
```

- [ ] **Step 2: 画面でE2Eを実施**

dev サーバーを起動し `/admin/ops/import` を開く。CORS付きの簡易HTTPサーバーでxlsxを配信し、`javascript_tool` で file input に流し込む（前回の取引先インポートE2Eと同じ手順）。

確認する順序:
1. テンプレDLボタンで4シートのファイルが落ちること
2. アップロード → プレビューで「請求先1件／部署1件／委託先1件／案件2件」と出ること
3. 投入が成功すること
4. 同じファイルを再投入すると、案件も含めて重複エラーで全件中止になること

- [ ] **Step 3: DBで結果を確認**

`execute_sql`（`hbpnhbsmsuhjyrohpluu`）:

```sql
select p.project_code, p.project_name, p.category, c.company_name, d.name as dept, ct.name as contractor
from projects p
join clients c on c.id = p.client_id
left join client_departments d on d.id = p.department_id
left join contractors ct on ct.id = p.contractor_id
order by p.project_code;
```

Expected: `project_code` が `P0001` から連番、`category` が `transport` / `work`、荷主・部署・委託先が正しく紐づいている

- [ ] **Step 4: テストデータを削除**

確認が済んだら、投入したテストデータを削除して0件のベースラインに戻す。

- [ ] **Step 5: マニュアルを更新**

`docs/PARTNER_IMPORT_MANUAL.md` の「2. インポート手順」に案件シートの説明を追記する。テンプレが4シート構成になったこと、区分列が必須であること、案件は取引先が登録済みでないと登録できないため同じファイルで投入するのが確実であることを書く。

- [ ] **Step 6: HANDOVERに記録**

`docs/HANDOVER_MASTER.md` §5-2 に、案件インポートとカテゴリ列の完了、検証結果、**本番適用がマイグレーション→デプロイの順であること**を追記する。

- [ ] **Step 7: Commit**

```bash
git add docs/PARTNER_IMPORT_MANUAL.md docs/HANDOVER_MASTER.md
git commit -m "docs: 案件インポートの手順とE2E結果を記録"
```

---

### Task 12: 本番適用（ボスの承認が必要・1ステップずつ）

⚠️ このタスクは自動で進めない。各ステップの前にボスの確認を取る。

- [ ] **Step 1: マイグレーションを本番に適用**

Supabase MCP の `apply_migration`（project_id: `lsgvnxiuidvwefihjbcu`）で `20260825000000_projects_category.sql` を適用する。**デプロイより先に行う。**

- [ ] **Step 2: 列が入ったことを確認**

```sql
select column_name, data_type, column_default from information_schema.columns
where table_schema='public' and table_name='projects' and column_name='category';
```

- [ ] **Step 3: main へマージして push（＝自動デプロイ）**

```bash
git checkout main && git merge --no-ff <作業ブランチ> && git push origin main
```

- [ ] **Step 4: デプロイ完了と疎通を確認**

```bash
gh run list --workflow deploy.yml --limit 1
```

デプロイ成功後、本番 `/login` が200で応答することを確認する。

- [ ] **Step 5: Driveの記入ガイドを更新**

A社に渡すGoogleドキュメント「【はじめにお読みください】取引先一覧の記入ガイド」に案件シートの説明を追記し、Driveのテンプレxlsxを最新版（4シート）に差し替える。
