# 取引先の部署分割対応 ＋ 請求書書き込み一本化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 取引先を部署単位で請求書に分割できるようにし、同時に `invoices` への書き込み4経路を1つの窓口へ集約して同型バグの再発を止める。

**Architecture:** `client_departments` テーブルを新設し、`projects` / `invoices` に nullable な `department_id` を持たせる。部署分割の有無は `clients.use_departments` フラグで切り替え、切替時も過去データは書き換えない。請求書の書き込みは `web/src/utils/invoice-writer.ts` の 1 関数に集約し、金額の計算は従来どおり各呼び出し側に残す。

**Tech Stack:** Next.js (App Router) / Supabase (Postgres + Auth) / TypeScript / Vitest / Tailwind

## Global Constraints

以下は全タスクに暗黙に適用される。逸脱してはならない。

- **`tenant_id` は必ず `text` 型**、既定値 `'local-dev'`。**`uuid` にしてはならない**（2026-07-26 の `driver_project_assignments` 事故と同型）
- **DBアクセスは必ず Server Actions 経由**。クライアントからの直接クエリは全面禁止（CLAUDE.md §2）
- **Server Actions は `createServiceClient()`（サービスロール）を使い、`tenant_id` でフィルタする**
- **すべての Server Action は先頭で `requireOwner()` による権限ガードを通す**
- **`'use server'` ファイルは async 関数以外を export してはならない。** 純粋関数は `'use server'` の付いていない別ファイル（`utils/` 配下）に置く
- **本番DBへのマイグレーション適用は 1 コマンドずつ提示し、都度ボスの確認を取る**（CLAUDE.md §2）。本プロジェクトのDBは本番1つのみで、開発と共用している
- **`git add` はファイルを明示する。`git add .` を使わない**（CLAUDE.md §2）
- **`ooba/` はコミットしない**（`.gitignore` 済み。実口座情報・角印画像・従業員実名を含む）
- **作業ブランチ `feat/client-departments` で行う。** `main` への push は `web/**` の変更で本番へ自動デプロイされるため、未完成の状態を `main` に乗せない
- **確認は `read_page` / ログを優先し、スクリーンショットはレイアウト確認時のみ**（1枚 ≒ 35,000トークン）

**設計書:** `docs/superpowers/specs/2026-07-29-client-departments-design.md`

---

## タスク依存関係

```
Task 1（ベースライン取得）
  └→ Task 2（マイグレーション: 追加のみ）
       └→ Task 3（共通ライタ・TDD）
            ├→ Task 4（sales/actions.ts 移行）┐
            ├→ Task 5（billing-actions 移行） ├→ Task 7（制約張り替え）
            └→ Task 6（scan-actions 移行）    ┘      └→ Task 11（生成ロジック）
       └→ Task 8（部署CRUD Actions）                        └→ Task 12（生成画面）
            └→ Task 9（荷主マスタ画面）
                 └→ Task 10（案件マスタ画面）
Task 13（実地検証・引き継ぎ更新）※ 全タスク完了後
```

**⚠️ Task 7 は Task 4・5・6 がすべて完了し、本番へデプロイされた後にのみ実行する。**
制約を削除した瞬間に `finalizeInvoice` の `onConflict` upsert が `42P10` で壊れるため。

---

### Task 1: ベースライン取得（実装前の必須作業・コード変更なし）✅ 完了 2026-07-29（コミット `e511e78`）

> **実施結果:** UI 自動操作が効かなかったため、**スキーマとコードの突き合わせによる論理的確定**に切り替えた（設計書 §12 参照）。B-1（`commitManualInvoice` の必須列3つ欠落 → `23502`）と B-2（`saveClientScanResult` の2枚目 → `23505`）を確定。
> **⚠️ 申し送り: UI 自動操作（`computer` のクリック／タイプ）がこのアプリに届かない。** Task 4 以降の画面検証は別手段が必要（設計書 §12-4）。

2026-07-28 時点で本番の `invoices` は **0件**だった。これらの経路の多くは本番でまだ一度も成功していない可能性がある。改修後に不具合が出たとき「今回壊したのか、元から壊れていたのか」を判別できないと原因究明に時間を溶かす。

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-client-departments-design.md`（§12 の表を埋める）

**Interfaces:**
- Consumes: なし
- Produces: §12 に埋まったベースライン記録。Task 4・5・6 の完了判定の比較対象になる

- [x] **Step 1: 作業ブランチを作る**

```bash
git switch -c feat/client-departments
```

- [x] **Step 2: ローカル開発サーバを起動する**

`.claude/launch.json` が無ければ以下の内容で作成する。

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "hibiki-web",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 3000
    }
  ]
}
```

`preview_start` に `{name: "hibiki-web"}` を渡して起動する。**Bash で `npm run dev` を実行してはならない。**

⚠️ `.claude/launch.json` の `runtimeArgs` は `web/` ディレクトリで実行される必要がある。
`npm run dev` がリポジトリルートで失敗する場合は `"runtimeArgs": ["--prefix", "web", "run", "dev"]` に変更する。

- [x] **Step 3: 4経路をそれぞれ画面から実行し、結果を記録する**

現状のコードのまま、以下を順に実行する。**成功・失敗のどちらでも構わない。結果を正確に記録することが目的。**

| # | 経路 | 画面 | 操作 |
|---|---|---|---|
| 1 | `finalizeInvoice` | `/admin/billing` | 請求確定を実行 |
| 2 | `saveClientScanResult`（1回目） | `/admin/scan` | 請求書をスキャンして保存 |
| 2' | `saveClientScanResult`（2回目） | `/admin/scan` | **同一荷主・同一月**でもう一度保存（B-2 の確認） |
| 4 | `commitManualInvoice` | `/admin/sales` | 手動で請求書を作成して確定（B-1 の確認） |

エラーが出た場合は `read_console_messages` と `preview_logs` でエラーコード（`23502` / `23505` / `42P10` など）を採取する。

- [x] **Step 4: 設計書 §12 の表を埋める**

`docs/superpowers/specs/2026-07-29-client-departments-design.md` の §12「ベースライン記録」の表に、実行日・結果（成功/失敗）・エラーコードを記入する。

- [x] **Step 5: コミット**

```bash
git add docs/superpowers/specs/2026-07-29-client-departments-design.md
git commit -m "docs: 請求書書き込み4経路のベースラインを記録"
```

---

### Task 2: マイグレーション（テーブル・列の追加のみ）✅ 完了 2026-07-30（コミット `a521442`）

追加のみで既存データを変更しない。制約の張り替えは Task 7 で行う。

> **実施結果（実測）:** 本番DB `hbpnhbsmsuhjyrohpluu` へ適用済み。テーブル1・列3すべて存在、`client_departments.tenant_id` は **`text`**、RLS 有効・ポリシー **0件**。型再生成後 `tsc --noEmit` エラー0。
> 適用ファイルは `supabase/migrations/20260730123144_add_client_departments.sql`（MCP の自動採番に合わせてリネーム済み）。
>
> **⚠️ 下記 Step 1 の SQL から意図的に変更した点（1件）:** 計画時に書いた
> `CREATE POLICY "service role full access" ON public.client_departments FOR ALL USING (true) WITH CHECK (true);`
> は **採用しなかった**。`TO` 指定が無いため `public`（anon / authenticated）に開いてしまい、
> `20260627000000_rls_tighten_5tables.sql` で全廃した緩いポリシーと同型になるため。
> service_role は RLS を常にバイパスするので service 用ポリシーは不要。
> **正しい形は「RLS 有効化＋ポリシー0件（deny-by-default）」。** 以降のタスクでもこの形を守ること。

**Files:**
- Create: `supabase/migrations/20260729000000_add_client_departments.sql`
- Modify: `web/src/types/supabase.ts`（自動生成）

**Interfaces:**
- Consumes: なし
- Produces: テーブル `client_departments`、列 `clients.use_departments` / `projects.department_id` / `invoices.department_id`。TypeScript 型 `Database['public']['Tables']['client_departments']['Row' | 'Insert' | 'Update']`

- [x] **Step 1: マイグレーションファイルを作る**

```sql
-- 取引先の部署分割対応。
--
-- 背景:
--   取引先（株式会社エス.アール.シー）が同一会社でありながら部署ごとに
--   請求書を分けて提出することを求めている。
--   部署ごとに異なるのは担当者・連絡先のみで、締め日・支払サイト・振込先口座・
--   インボイス登録番号・税区分はすべて会社で共通（ボス確認済み 2026-07-29）。
--   そのため部署は clients の複製ではなく、独立した子テーブルとして持つ。
--
-- 安全性: 追加のみ。既存の荷主・案件・請求書は
--   use_departments = false / department_id = NULL のまま従来どおり動作する。
--   データ移行は発生しない。
--
-- ⚠️ tenant_id は text。uuid にしてはならない。
--   （2026-07-26 に driver_project_assignments を uuid で作り、
--     'local-dev' の INSERT が invalid input syntax for type uuid で
--     必ず失敗した事故と同型）

CREATE TABLE IF NOT EXISTS public.client_departments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  name         text NOT NULL,
  contact_name text,
  email        text,
  phone        text,
  sort_order   int  NOT NULL DEFAULT 0,
  tenant_id    text NOT NULL DEFAULT 'local-dev',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_departments_client_id_idx
  ON public.client_departments (client_id);

ALTER TABLE public.client_departments ENABLE ROW LEVEL SECURITY;

-- アクセスは全て Server Actions のサービスロール経由（CLAUDE.md §2）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'client_departments'
      AND policyname = 'service role full access'
  ) THEN
    CREATE POLICY "service role full access"
      ON public.client_departments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 部署分割を使うかどうかのフラグ（後から変更可能）
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS use_departments boolean NOT NULL DEFAULT false;

-- 案件がどの部署に属するか
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS department_id uuid
  REFERENCES public.client_departments(id) ON DELETE SET NULL;

-- 請求書がどの部署のものか。
-- ON DELETE RESTRICT: 確定済み請求書がぶら下がっている部署を消せなくする
-- （取引先に提出した紙の根拠が消えるのを防ぐ）
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS department_id uuid
  REFERENCES public.client_departments(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS projects_department_id_idx
  ON public.projects (department_id);
CREATE INDEX IF NOT EXISTS invoices_department_id_idx
  ON public.invoices (department_id);
```

- [x] **Step 2: 本番DBへ適用する（ボス確認必須）**

⚠️ **本プロジェクトのDBは本番1つのみで、開発と共用している。適用前に必ずボスの確認を取る。**

適用は Supabase MCP の `apply_migration` を使う。マイグレーション名は `add_client_departments`。

⚠️ **MCP 経由の適用はバージョン番号を自動採番する。** 適用後、ローカルのファイル名を採番結果に合わせてリネームすること（HANDOVER §5-2 の 2026-07-27 参照。これを怠るとマイグレーションと本番スキーマの 1:1 一致が崩れる）。

- [x] **Step 3: 適用結果を確認する**

`execute_sql` で以下を実行し、4つとも存在することを確認する。

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_name='client_departments')  AS tbl,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='clients'  AND column_name='use_departments') AS f_clients,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='projects' AND column_name='department_id')   AS f_projects,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='invoices' AND column_name='department_id')   AS f_invoices,
  (SELECT data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='client_departments' AND column_name='tenant_id') AS tenant_type;
```

期待値: `tbl=1, f_clients=1, f_projects=1, f_invoices=1, tenant_type=text`

**`tenant_type` が `uuid` になっていたら即座に修正する。** これを見逃すと保存が本番で必ず失敗する。

- [x] **Step 4: TypeScript 型を再生成する**

```bash
cd web && npx supabase gen types typescript --linked > src/types/supabase.ts
```

- [x] **Step 5: 型チェックが通ることを確認する**

```bash
cd web && npx tsc --noEmit
```

期待: エラー 0 件

- [x] **Step 6: コミット**

```bash
git add supabase/migrations/ web/src/types/supabase.ts
git commit -m "feat(db): client_departments テーブルと department_id 列を追加"
```

---

### Task 3: 共通ライタ `invoice-writer.ts`（TDD）✅ 完了 2026-07-30（コミット `33d591a`）

`invoices` への書き込みを 1 箇所に集約する。金額の計算は各呼び出し側に残し、この関数は「必須列を埋めて書く」ことだけに責任を持つ。

> **実施結果（実測）:** 計画の SQL/TS から変更なしで実装。`vitest run src/utils/invoice-writer.test.ts` → **8 passed**、`tsc --noEmit` → 0件、`eslint src/utils/invoice-writer.ts` → 0件。
> Step 2 の失敗確認も想定どおり（`Cannot find module './invoice-writer'`）。
>
> **B-1 の裏付け（型定義で確認済み）:** 再生成後の `web/src/types/supabase.ts` の `invoices.Insert` において
> `target_month` / `total_amount_ex_tax` / `total_tax` は **`?` なし＝必須**、
> 一方 `invoice_month` / `total_tax_excluded` / `consumption_tax` は `?` 付き（DEFAULT あり）。
> 旧列だけが必須という非対称が 23502 の原因であることがスキーマ上で確定した。
> `department_id` / `updated_at` 列も存在を確認済み（ライタが書く列はすべて実在する）。
>
> **未検証:** DBに実際に書く `writeInvoice` はテスト対象外（純粋関数 `buildInvoiceRow` のみテスト）。
> 実書き込みの確認は Task 4・5・6 の実地確認で行う。

**Files:**
- Create: `web/src/utils/invoice-writer.ts`
- Test: `web/src/utils/invoice-writer.test.ts`

**Interfaces:**
- Consumes: `Database` 型（Task 2 で再生成済み）
- Produces:
  - `type InvoiceWritePayload = { clientId: string; departmentId: string | null; yearMonth: string; subtotal: number; taxAmount: number; totalAmount: number; status: 'draft' | 'issued' | 'paid'; dueDate: string | null; issuedAt: string | null; tenantId: string }`
  - `function buildInvoiceRow(p: InvoiceWritePayload): Record<string, unknown>` — 純粋関数
  - `async function writeInvoice(service, payload: InvoiceWritePayload): Promise<{ id: string | null; error: string | null }>`

- [x] **Step 1: 失敗するテストを書く**

Create `web/src/utils/invoice-writer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildInvoiceRow, type InvoiceWritePayload } from './invoice-writer'

const base: InvoiceWritePayload = {
  clientId:     'client-1',
  departmentId: null,
  yearMonth:    '2026-06',
  subtotal:     1_020_000,
  taxAmount:    102_000,
  totalAmount:  1_122_000,
  status:       'draft',
  dueDate:      '2026-07-31',
  issuedAt:     null,
  tenantId:     'local-dev',
}

describe('buildInvoiceRow', () => {
  it('新列と旧列に同じ値を入れる（3回発生した 23502 の再発防止）', () => {
    const row = buildInvoiceRow(base)
    // 旧列は NOT NULL・DEFAULT なし。新列と必ず同値でなければならない
    expect(row['target_month']).toBe(row['invoice_month'])
    expect(row['total_amount_ex_tax']).toBe(row['total_tax_excluded'])
    expect(row['total_tax']).toBe(row['consumption_tax'])
  })

  it('旧列3つが undefined にならない', () => {
    const row = buildInvoiceRow(base)
    expect(row['target_month']).toBeDefined()
    expect(row['total_amount_ex_tax']).toBeDefined()
    expect(row['total_tax']).toBeDefined()
  })

  it("yearMonth 'YYYY-MM' を月初日 'YYYY-MM-01' に変換する", () => {
    const row = buildInvoiceRow(base)
    expect(row['invoice_month']).toBe('2026-06-01')
    expect(row['target_month']).toBe('2026-06-01')
  })

  it('departmentId の null を保持する（部署なし荷主）', () => {
    const row = buildInvoiceRow(base)
    expect(row['department_id']).toBeNull()
  })

  it('departmentId を指定するとその値が入る', () => {
    const row = buildInvoiceRow({ ...base, departmentId: 'dept-1' })
    expect(row['department_id']).toBe('dept-1')
  })

  it('tenant_id を必ず書き込む（DEFAULT 依存をやめる）', () => {
    const row = buildInvoiceRow(base)
    expect(row['tenant_id']).toBe('local-dev')
  })

  it('金額をそのまま渡す', () => {
    const row = buildInvoiceRow(base)
    expect(row['total_tax_excluded']).toBe(1_020_000)
    expect(row['consumption_tax']).toBe(102_000)
    expect(row['total_amount']).toBe(1_122_000)
  })

  it('yearMonth の形式が不正なら例外を投げる', () => {
    expect(() => buildInvoiceRow({ ...base, yearMonth: '2026-6' })).toThrow()
    expect(() => buildInvoiceRow({ ...base, yearMonth: '2026-06-01' })).toThrow()
  })
})
```

- [x] **Step 2: テストが失敗することを確認する**

```bash
cd web && npx vitest run src/utils/invoice-writer.test.ts
```

期待: FAIL（`Failed to resolve import "./invoice-writer"`）

- [x] **Step 3: 実装する**

Create `web/src/utils/invoice-writer.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

// ⚠️ このファイルに 'use server' を付けてはならない。
//    純粋関数 buildInvoiceRow を export しているため、
//    'use server' を付けると「async 関数以外を export できない」で実行時エラーになる。

export type InvoiceWritePayload = {
  clientId:     string
  departmentId: string | null
  yearMonth:    string   // 'YYYY-MM'
  subtotal:     number   // 税抜合計
  taxAmount:    number   // 消費税額
  totalAmount:  number   // 税込合計
  status:       'draft' | 'issued' | 'paid'
  dueDate:      string | null
  issuedAt:     string | null
  tenantId:     string   // ⚠️ 必須。DEFAULT 依存をやめる（F0 テナント分離の Task 5B に相当）
}

/**
 * invoices の 1 行を組み立てる純粋関数。
 *
 * ⚠️ target_month / total_amount_ex_tax / total_tax は旧列だが NOT NULL・DEFAULT なし。
 *    渡さないと 23502 not-null violation で書き込みが必ず失敗する。
 *    2026-07-27 / 07-28 / 07-29 と 3 回続けて同じ事故が起きているため、
 *    ここ 1 箇所で新列と同値を保証し、テストで固定する。
 */
export function buildInvoiceRow(p: InvoiceWritePayload) {
  if (!/^\d{4}-\d{2}$/.test(p.yearMonth)) {
    throw new Error(`yearMonth は 'YYYY-MM' 形式で渡してください: ${p.yearMonth}`)
  }
  const month = `${p.yearMonth}-01`

  return {
    client_id:           p.clientId,
    department_id:       p.departmentId,
    invoice_month:       month,
    target_month:        month,              // 旧列（invoice_month と同値）
    total_tax_excluded:  p.subtotal,
    total_amount_ex_tax: p.subtotal,         // 旧列（total_tax_excluded と同値）
    consumption_tax:     p.taxAmount,
    total_tax:           p.taxAmount,        // 旧列（consumption_tax と同値）
    total_amount:        p.totalAmount,
    status:              p.status,
    due_date:            p.dueDate,
    issued_at:           p.issuedAt,
    tenant_id:           p.tenantId,
    updated_at:          new Date().toISOString(),
  }
}

/**
 * invoices への唯一の書き込み口。
 *
 * (client_id, department_id, invoice_month) で既存行を探し、
 * あれば UPDATE・なければ INSERT する。
 *
 * ⚠️ onConflict を使わない。
 *    Task 7 で一意性を「部分ユニークインデックス 2 本」に張り替えるため、
 *    onConflict では対象を指定できない。
 *
 * ⚠️ この関数は「確定済み請求書のロック判定」を行わない。
 *    status が issued / paid の請求書を上書きしてよいかの判断は業務ロジックであり、
 *    呼び出し側の責任として残す（例: billing-actions.ts の開発者アンロック）。
 *    ここで守られると思い込むと、発行済み請求書が黙って上書きされる事故になる。
 */
export async function writeInvoice(
  service: SupabaseClient<Database>,
  payload: InvoiceWritePayload,
): Promise<{ id: string | null; error: string | null }> {
  const row = buildInvoiceRow(payload)

  // ⚠️ department_id が null のとき .eq('department_id', null) は PostgREST では動かない。
  //    必ず .is('department_id', null) を使うこと。
  let query = service
    .from('invoices')
    .select('id')
    .eq('client_id',     payload.clientId)
    .eq('invoice_month', row.invoice_month)
    .eq('tenant_id',     payload.tenantId)

  query = payload.departmentId === null
    ? query.is('department_id', null)
    : query.eq('department_id', payload.departmentId)

  const { data: existing, error: selectErr } = await query.maybeSingle()
  if (selectErr) return { id: null, error: selectErr.message }

  if (existing) {
    const { error } = await service
      .from('invoices')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(row as any)
      .eq('id', existing.id)
    if (error) return { id: null, error: error.message }
    return { id: existing.id, error: null }
  }

  const { data, error } = await service
    .from('invoices')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(row as any)
    .select('id')
    .single()
  if (error) return { id: null, error: error.message }
  return { id: (data as { id: string }).id, error: null }
}
```

- [x] **Step 4: テストが通ることを確認する**

```bash
cd web && npx vitest run src/utils/invoice-writer.test.ts
```

期待: 8 tests passed

- [x] **Step 5: 型チェックとリント**

```bash
cd web && npx tsc --noEmit && npx eslint src/utils/invoice-writer.ts
```

期待: どちらもエラー 0 件

- [x] **Step 6: コミット**

```bash
git add web/src/utils/invoice-writer.ts web/src/utils/invoice-writer.test.ts
git commit -m "feat(billing): invoices 書き込みの共通ライタを追加（必須列の充足をテストで固定）"
```

---

### Task 4: `admin/sales/actions.ts` の 2 経路を共通ライタへ移行（B-1・B-3 解消）🔶 コード完了 2026-07-30（コミット `36728e8`）／**実地確認は未実施**

> **実施結果（実測）:** `tsc --noEmit` 0件 / `vitest run` **24 passed**（全3ファイル）/ `eslint` **新規エラー0件**（既存5件のみ＝`createServiceClient() as any` 2箇所・`(r: any)` 1箇所・ManualInvoiceTab の既存2件）。
>
> **計画書から意図的に変更・追加した点:**
> 1. **`upsertInvoice` に `tenantId` が無かったので `getCurrentTenantId()` を追加した**（計画書 Step 2 の ⚠️ どおり）。従来この経路は `tenant_id` を渡さず DEFAULT に依存していた。
> 2. **`commitManualInvoice` の引数に `subtotalExTax` / `taxAmount` を追加**し、呼び出し元 `ManualInvoiceTab.tsx` も修正（計画書 Step 3 の ⚠️ どおり。`finalAmount` は税込なので旧列 `total_amount_ex_tax` に税込額が入るのを防いだ）。
> 3. **Step 4 の grep の期待値は不正確だった。** 「`insert(`/`update(` を伴う行が無いこと」とあるが、実際には次の2つが残る（どちらも正しい）:
>    - `updateInvoiceStatus` の `.update({ status })` — **status のみを id 指定で更新**する入金ステータス更新。必須列に触れないため 23502 は起こり得ず、共通ライタでは「金額を渡さず status だけ変える」を表現できない（金額の再取得が必要になり、かえって危険）。**意図的に残した。**
>    - `commitManualInvoice` の else 側 `payment_notices` への `insert` — `invoices` ではないため本計画の対象外。
>
> **⚠️ 別件として発見（本計画では未対応）:** `updateInvoiceStatus` は `.eq('id', invoiceId)` のみで **`tenant_id` フィルタが無い**。`requireOwner()` は通るが、テナントが複数になった時点でテナント跨ぎの更新が可能になる。B社オンボーディング前に潰す必要がある。
>
> **未検証:** 画面からの実地確認（Step 6）。ローカルは `ALLOW_DEV_AUTH_BYPASS=false` でログインが必要であり、パスワード入力はアシスタントが行えないため。**ボス判断により Task 5・6 完了後に4経路まとめて実施することにした（2026-07-30）。**

**Files:**
- Modify: `web/src/app/admin/sales/actions.ts`（`upsertInvoice` 周辺 396-441行、`commitManualInvoice` 周辺 713-750行）

**Interfaces:**
- Consumes: `writeInvoice` / `InvoiceWritePayload`（Task 3）
- Produces: 変更なし（両関数の外部シグネチャは維持する）

- [x] **Step 1: import を追加する**

`web/src/app/admin/sales/actions.ts` の import 群に追加:

```ts
import { writeInvoice } from '@/utils/invoice-writer'
```

- [x] **Step 2: `upsertInvoice` の SELECT→UPDATE/INSERT を置き換える**

396-441行（`const { data: existing } = await supabase.from('invoices')` から関数末尾の `return { data: { id: data.id }, error: null }` まで）を以下で置き換える:

```ts
  const { id, error } = await writeInvoice(supabase, {
    clientId:     clientId,
    departmentId: null,          // Task 11 で部署対応を入れる
    yearMonth:    yearMonth,
    subtotal:     preview.netTotal,
    taxAmount:    preview.taxTotal,
    totalAmount:  preview.grandTotal,
    status:       'issued',
    dueDate:      preview.dueDate,
    issuedAt:     new Date().toISOString(),
    tenantId:     tenantId,
  })

  if (error || !id) return { data: null, error: error ?? '請求書の保存に失敗しました' }
  return { data: { id }, error: null }
```

⚠️ この関数のスコープに `tenantId` が無い場合は、関数冒頭で `const tenantId = await getCurrentTenantId()` を取得すること。

- [x] **Step 3: `commitManualInvoice` の insert を置き換える（B-1・B-3 の修正）**

737-748行の `.from('invoices').insert({...})` ブロックを以下で置き換える:

```ts
    // ⚠️ 2026-07-29 まで target_month / total_amount_ex_tax / total_tax が未指定で、
    //    23502 not-null violation により必ず失敗していた（B-1）。
    //    また素の insert だったため、同一荷主・同一月の 2 回目が 23505 で失敗した（B-3）。
    //    共通ライタへ移行して両方を解消する。
    const { id, error } = await writeInvoice(db, {
      clientId:     params.clientId,
      departmentId: null,          // Task 11 で部署対応を入れる
      yearMonth:    params.yearMonth,
      subtotal:     params.finalAmount,
      taxAmount:    0,
      totalAmount:  params.finalAmount,
      status:       'draft',
      dueDate:      null,
      issuedAt:     null,
      tenantId:     tenantId,
    })

    if (error || !id) return { data: null, error: error ?? '請求書の保存に失敗しました' }
```

⚠️ **`params.finalAmount` は税込である**（Task 1 のベースライン取得で画面プレビューにより確認済み。
税抜 ¥10,000 → 消費税 +¥1,000 → 経過措置 −¥220 → 最終請求額 ¥10,780）。

**そのため上記コードのままでは誤りになる。** `subtotal` に税込額が入り、旧列 `total_amount_ex_tax`
（税抜であるべき列）に税込額が書かれてしまう。

`computeManualInvoicePreview` の戻り値には税抜合計・消費税額も含まれているため、
`commitManualInvoice` の引数にそれらを追加し、以下のように渡すこと:

```ts
      subtotal:     params.subtotalExTax,   // 税抜合計（新規に引数へ追加する）
      taxAmount:    params.taxAmount,       // 消費税額（新規に引数へ追加する）
      totalAmount:  params.finalAmount,     // 税込（経過措置差引後）
```

呼び出し元 `web/src/app/admin/sales/ManualInvoiceTab.tsx:238` の `commitManualInvoice({...})` にも
同じ 2 つを追加する（`preview` から取れる）。

- [x] **Step 4: 元の insert / update ブロックが残っていないことを確認する**

```bash
cd /Users/kawasakiatsushi/developer/unsou-system && grep -n "from('invoices')" web/src/app/admin/sales/actions.ts
```

期待: **SELECT 系のみが残る**（147行・329行・398行付近の読み取り）。`insert(` / `update(` を伴う行が無いこと。

- [x] **Step 5: 型チェックとテスト**

```bash
cd web && npx tsc --noEmit && npx vitest run
```

期待: どちらもエラー 0 件

- [ ] **Step 6: ローカルで実地確認**

`preview_start` で開発サーバを起動し、`/admin/sales` で以下を確認する（`read_page` を使う。スクリーンショットは不要）:

1. 請求書を発行できる
2. **手動で請求書を作成して確定できる**（B-1 が解消されていること。Task 1 で失敗を記録しているはず）
3. **同じ荷主・同じ月で手動作成をもう一度実行しても失敗しない**（B-3 が解消されていること。2枚目が作られず 1 枚目が更新される）

`read_console_messages` と `preview_logs` でエラーが出ていないことを確認する。

- [x] **Step 7: コミット**

```bash
git add web/src/app/admin/sales/actions.ts
git commit -m "fix(billing): 手動請求書確定の必須列欠落と重複エラーを修正、共通ライタへ移行"
```

---

### Task 5: `_actions/billing-actions.ts` を共通ライタへ移行（ロック判定は残す）🔶 コード完了 2026-07-30（コミット `cf55276`）／**実地確認は未実施**

> **実施結果（実測）:** `tsc --noEmit` 0件 / `vitest run` 24 passed / `eslint` **新規エラー0件**（既存3件のみ＝`finalizePaymentNotice` 内の `as any` 3箇所。変更前と同一行）。
> `tenantId` は既に関数スコープ内（91行）にあったため追加不要だった。ロック判定（104-122行）は無変更。
>
> **意図的な挙動変更（1件）:** 従来の upsert は `issued_at` に触れなかったため、開発者アンロックでの再確定時に `status='draft'` なのに `issued_at` が残るという矛盾状態になっていた。共通ライタは `issuedAt: null` を渡すためクリアされる。draft に戻すのと整合する方向なので採用した。
>
> **未検証:** 画面からの実地確認（Step 5）。とくに**ロック判定が生きていること**（issued の請求書に再確定して開発者アンロックを要求して停止する）は自動テストで代替できていない。4経路の一括検証で必ず確認する。

**Files:**
- Modify: `web/src/app/_actions/billing-actions.ts`（`finalizeInvoice` 内 149-170行）

**Interfaces:**
- Consumes: `writeInvoice`（Task 3）
- Produces: 変更なし

- [x] **Step 1: import を追加する**

```ts
import { writeInvoice } from '@/utils/invoice-writer'
```

- [x] **Step 2: ロック判定（113-122行）に手を触れないことを確認する**

`status` が `issued` / `paid` の請求書を上書きしようとしたとき停止し、開発者アンロックを要求する処理がある。**この判定は業務ロジックであり、そのまま残す。** 共通ライタは渡された内容をそのまま書くだけで、ロックを守らない。

- [x] **Step 3: upsert を置き換える（149-170行）**

```ts
  // ⚠️ 従来は onConflict: 'client_id,invoice_month' の upsert だった。
  //    Task 7 で一意性を部分ユニークインデックス 2 本に張り替えるため、
  //    onConflict では対象を指定できない。共通ライタの SELECT→UPDATE/INSERT へ移行する。
  //    ⚠️ 確定済み（issued/paid）のロック判定は上部（113-122行）に残してある。
  //       共通ライタはロックを守らない。
  const { error: writeErr } = await writeInvoice(service, {
    clientId:     clientId,
    departmentId: null,          // Task 11 で部署対応を入れる
    yearMonth:    yearMonth,
    subtotal:     result.subtotal,
    taxAmount:    result.taxAmount,
    totalAmount:  newTotalAmount,
    status:       'draft',
    dueDate:      dueDate.toISOString().slice(0, 10),
    issuedAt:     null,
    tenantId:     tenantId,
  })

  if (writeErr) return { data: null, error: writeErr }

  return { data: undefined, error: null }
```

⚠️ この関数は `invoiceMonthDate`（`'YYYY-MM-01'`）を使っているが、共通ライタは `yearMonth`（`'YYYY-MM'`）を受け取る。**`yearMonth` をそのまま渡すこと。** `invoiceMonthDate` を渡すと形式チェックで例外になる。

⚠️ `tenantId` がこの関数のスコープに無い場合は `getCurrentTenantId()` で取得する。従来この経路は `tenant_id` を渡しておらず DEFAULT に依存していた。

- [x] **Step 4: 型チェックとテスト**

```bash
cd web && npx tsc --noEmit && npx vitest run
```

期待: どちらもエラー 0 件

- [ ] **Step 5: ローカルで実地確認**

`/admin/billing` で請求確定を実行し、成功することを確認する（`read_page`）。

**加えてロック判定が生きていることを確認する:** 一度確定して `issued` にした請求書に対してもう一度確定を実行し、**開発者アンロックを要求して停止する**ことを確認する。ここが素通りしたら Step 2 の判定が壊れている。

- [x] **Step 6: コミット**

```bash
git add web/src/app/_actions/billing-actions.ts
git commit -m "refactor(billing): finalizeInvoice を共通ライタへ移行（ロック判定は維持）"
```

---

### Task 6: `_actions/scan-actions.ts` を共通ライタへ移行（B-2 解消）🔶 コード完了 2026-07-30（コミット `6127294`）／**実地確認は未実施**

> **実施結果（実測）:** `tsc --noEmit` 0件 / `vitest run` 24 passed / `eslint src/app/_actions/scan-actions.ts` **0件**（Step 3 の `(service as any)` と `eslint-disable-next-line` を削除できたため）。
> 使わなくなった `invoiceMonth` 変数も削除済み（未使用変数の警告は出ていない）。
>
> **未検証:** 画面からの実地確認（Step 5）。とくに**同一荷主・同一月の2枚目が1枚目を上書きする**という挙動変更の妥当性は、実データで一度見ておく必要がある。
>
> **✅ Task 7 の前提条件は充足済み（機械確認）:** `grep -rn "onConflict" src/app/_actions/ src/app/admin/ | grep -i invoice` → **0件**。
> なお最初は Task 5 で書いたコメント文に `onConflict` の語が含まれて grep に引っかかったため、**将来のセッションが誤って手戻りしないようコメント文言から該当語を外した**（`cf55276` の内容）。

**Files:**
- Modify: `web/src/app/_actions/scan-actions.ts`（`saveClientScanResult` 内 83-106行）

**Interfaces:**
- Consumes: `writeInvoice`（Task 3）
- Produces: 変更なし

- [x] **Step 1: import を追加する**

```ts
import { writeInvoice } from '@/utils/invoice-writer'
```

- [x] **Step 2: insert を置き換える（83-106行）**

```ts
  // ⚠️ 従来は素の insert だったため、同一荷主・同一月の 2 枚目をスキャンすると
  //    23505 duplicate key で失敗していた（B-2）。
  //    2026-07-28 に UNIQUE(client_id, invoice_month) を追加したことで顕在化した。
  //    共通ライタの SELECT→UPDATE/INSERT へ移行して解消する。
  const { id, error: writeErr } = await writeInvoice(service, {
    clientId:     params.clientId,
    departmentId: null,          // Task 11 で部署対応を入れる
    yearMonth:    params.invoiceDate.slice(0, 7),
    subtotal:     params.subtotal,
    taxAmount:    params.taxAmount,
    totalAmount:  params.subtotal + params.taxAmount,
    status:       'draft',
    dueDate:      null,
    issuedAt:     null,
    tenantId:     tenantId,
  })

  if (writeErr || !id) {
    return { data: null, error: writeErr ?? '保存に失敗しました' }
  }

  return { data: { id }, error: null }
```

⚠️ **挙動の変更点を認識すること。** 従来は毎回新しい行を作ろうとしていた（が制約で失敗した）。移行後は同一荷主・同一月の 2 枚目が **1 枚目を上書き**する。スキャンは 1 荷主 1 月 1 枚が前提であるという判断に基づく。**この前提が誤っている場合は実装を止めてボスに確認する**（複数枚を別行として残す必要があるなら、設計から見直しが必要）。

- [x] **Step 3: `as any` キャストの eslint-disable が不要になったら削除する**

元コードには `// eslint-disable-next-line @typescript-eslint/no-explicit-any` と `(service as any)` があった。共通ライタ側でキャストを持つため、この経路では不要になる。残っていたら削除する。

- [x] **Step 4: 型チェック・テスト・リント**

```bash
cd web && npx tsc --noEmit && npx vitest run && npx eslint src/app/_actions/scan-actions.ts
```

期待: すべてエラー 0 件

- [ ] **Step 5: ローカルで実地確認**

`/admin/scan` で請求書をスキャンして保存し、成功することを確認する。
**同一荷主・同一月で 2 回目を保存しても失敗しない**ことを確認する（B-2 解消）。

- [x] **Step 6: コミット**

```bash
git add web/src/app/_actions/scan-actions.ts
git commit -m "fix(scan): 同一荷主・同一月の2枚目スキャンが失敗する不具合を修正、共通ライタへ移行"
```

---

### Task 7: 一意性制約の張り替え（本計画で最も慎重を要する）✅ 完了 2026-08-03（ボスがSQL Editorで適用・検証済み、マイグレーション `20260803150000`）

**⚠️ 前提条件: Task 4・5・6 がすべて完了し、`onConflict` を使う書き込みが 1 つも残っていないこと。**

> **🚧 2026-07-30 時点の状態: Task 7 にはまだ着手してはならない。**
> Task 4・5・6 は**コードは完了しているが実地確認が未実施**（3タスクとも Step 5/6 の画面確認が未消化）。
> 制約を張り替えた後に不具合が出ると「今回の張り替えで壊れたのか、4・5・6 の移行が元から壊れていたのか」を切り分けられなくなる。
> **順序: ①4経路の実地確認 → ②本番デプロイ → ③Task 7。**
> なお Step 1 の grep 自体は既に 0 件（Task 6 の実施結果を参照）。

**Files:**
- Create: `supabase/migrations/20260729000001_invoices_unique_with_department.sql`

**Interfaces:**
- Consumes: Task 2 の `invoices.department_id`、Task 4・5・6 の共通ライタ移行
- Produces: 部分ユニークインデックス `invoices_uniq_with_dept` / `invoices_uniq_no_dept`

- [ ] **Step 1: 前提条件を機械的に確認する**

```bash
cd /Users/kawasakiatsushi/developer/unsou-system && grep -rn "onConflict" web/src/app/_actions/ web/src/app/admin/ | grep -i invoice
```

期待: **出力が空**。1 件でも残っていたら Task 4・5・6 に戻る。

- [ ] **Step 2: マイグレーションファイルを作る**

```sql
-- invoices の一意性を「荷主 × 月」から「荷主 × 部署 × 月」へ張り替える。
--
-- 背景:
--   2026-07-28 に UNIQUE(client_id, invoice_month) を追加した（二重請求の防止）。
--   しかし部署分割では同一荷主・同一月に複数枚（人材派遣部・運送事業部）を作るため、
--   この制約と正面から衝突し 2 枚目が 23505 で弾かれる。
--
-- ⚠️ 単純な UNIQUE(client_id, department_id, invoice_month) にしてはならない。
--   PostgreSQL の UNIQUE 制約は NULL 同士を「別物」とみなす（NULLS DISTINCT が既定）ため、
--   部署を持たない荷主（department_id IS NULL）の請求書が同じ月に何枚でも作れてしまう。
--   部分ユニークインデックス 2 本に分けることで、PG のバージョンに依存せず確実に防げる。
--
-- ⚠️ 前提: アプリ側の invoices 書き込みが
--   utils/invoice-writer.ts の SELECT→UPDATE/INSERT へ移行済みであること。
--   移行前にこの制約を削除すると、billing-actions.ts の
--   onConflict: 'client_id,invoice_month' upsert が 42P10 で必ず失敗する。

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_client_id_invoice_month_key;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_uniq_with_dept
  ON public.invoices (client_id, department_id, invoice_month)
  WHERE department_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_uniq_no_dept
  ON public.invoices (client_id, invoice_month)
  WHERE department_id IS NULL;
```

- [ ] **Step 3: 適用前に既存データの重複を確認する**

⚠️ **既に (client_id, invoice_month) が重複している行があると、`invoices_uniq_no_dept` の作成が失敗する。** 先に確認する。

```sql
SELECT client_id, invoice_month, count(*)
FROM public.invoices
WHERE department_id IS NULL
GROUP BY client_id, invoice_month
HAVING count(*) > 1;
```

期待: **0 行**。1 行でも出たら適用を止め、ボスに重複の処理方針を確認する。

- [ ] **Step 4: 本番DBへ適用する（ボス確認必須）**

⚠️ **既存制約の削除を含む。適用前に必ずボスの確認を取る。** マイグレーション名は `invoices_unique_with_department`。適用後はファイル名を採番結果へリネームする。

- [ ] **Step 5: 適用結果を確認する**

```sql
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='invoices'
  AND indexname IN ('invoices_uniq_with_dept','invoices_uniq_no_dept');

SELECT count(*) AS old_constraint_remaining
FROM pg_constraint
WHERE conname = 'invoices_client_id_invoice_month_key';
```

期待: インデックス 2 本が存在し、`old_constraint_remaining = 0`

- [ ] **Step 6: 4 経路すべてが引き続き動くことをローカルで確認する**

制約を張り替えた直後が最も危険なので、**Task 4・5・6 で確認した 4 経路をもう一度すべて実行する。**

- [ ] `/admin/billing` 請求確定
- [ ] `/admin/scan` スキャン保存
- [ ] `/admin/sales` 請求書発行
- [ ] `/admin/sales` 手動請求書確定

`read_console_messages` / `preview_logs` で `42P10` / `23505` が出ていないことを確認する。

- [ ] **Step 7: コミット**

```bash
git add supabase/migrations/
git commit -m "feat(db): invoices の一意性を荷主×部署×月へ張り替え（NULL の扱いに部分索引を使用）"
```

---

### Task 8: 部署の CRUD Server Actions ✅ 完了 2026-07-30（コミット `eb47545`）

**Files:**
- Modify: `web/src/app/admin/partners/actions.ts`（末尾に追加）

**Interfaces:**
- Consumes: `client_departments` テーブル（Task 2）
- Produces:
  - `fetchClientDepartments(clientId: string): Promise<ActionResult<ClientDepartmentRow[]>>`
  - `createClientDepartment(payload: ClientDepartmentInsert): Promise<ActionResult<ClientDepartmentRow>>`
  - `updateClientDepartment(id: string, payload: ClientDepartmentUpdate): Promise<ActionResult<ClientDepartmentRow>>`
  - `deleteClientDepartment(id: string): Promise<ActionResult<null>>`
  - `countUnassignedProjects(clientId: string): Promise<ActionResult<number>>`

- [x] **Step 1: 型エイリアスを追加する**

`web/src/app/admin/partners/actions.ts` の型定義群（10-15行付近）に追加:

```ts
type ClientDepartmentRow    = Database['public']['Tables']['client_departments']['Row']
type ClientDepartmentInsert = Database['public']['Tables']['client_departments']['Insert']
type ClientDepartmentUpdate = Database['public']['Tables']['client_departments']['Update']
```

- [x] **Step 2: CRUD を追加する**

ファイル末尾に追加:

```ts
// ── Client Departments（取引先の部署） ──────────────────────

export async function fetchClientDepartments(
  clientId: string,
): Promise<ActionResult<ClientDepartmentRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('client_departments')
    .select('*')
    .eq('client_id', clientId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data: data ?? [], error: null }
}

export async function createClientDepartment(
  payload: ClientDepartmentInsert,
): Promise<ActionResult<ClientDepartmentRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  // ⚠️ tenant_id は text。呼び出し側の値を信用せず必ずサーバ側で上書きする
  const { data, error } = await supabase
    .from('client_departments')
    .insert({ ...payload, tenant_id: tenantId })
    .select()
    .single()
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data, error: null }
}

export async function updateClientDepartment(
  id: string,
  payload: ClientDepartmentUpdate,
): Promise<ActionResult<ClientDepartmentRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  // tenant_id / client_id はクライアントから変更させない
  const { tenant_id: _t, client_id: _c, ...safe } = payload
  const { data, error } = await supabase
    .from('client_departments')
    .update(safe)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data, error: null }
}

export async function deleteClientDepartment(id: string): Promise<ActionResult<null>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  // ⚠️ invoices.department_id は ON DELETE RESTRICT。
  //    確定済み請求書がぶら下がっている部署は削除できず、
  //    translateDbError が「他のデータから参照されているため削除できません」を返す。
  const { error } = await supabase
    .from('client_departments')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data: null, error: null }
}

/**
 * 部署が未割当の案件件数を返す。
 * use_departments = true の荷主でこれが 0 より大きいと、
 * その案件は「どの請求書にも入らない」＝売上が漏れる状態になる。
 */
export async function countUnassignedProjects(
  clientId: string,
): Promise<ActionResult<number>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('tenant_id', tenantId)
    .is('department_id', null)   // ⚠️ .eq(..., null) は動かない。必ず .is() を使う
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data: count ?? 0, error: null }
}
```

- [x] **Step 3: `'use server'` の制約に違反していないことを確認する**

このファイルは `'use server'` である。**追加したのが全て `async function` の export であることを確認する。** 型エイリアスは `type` なので実行時 export されず問題ない。

```bash
cd /Users/kawasakiatsushi/developer/unsou-system && grep -n "^export" web/src/app/admin/partners/actions.ts | grep -v "export async function" | grep -v "^.*export type"
```

期待: 出力が空

- [x] **Step 4: 型チェックとリント**

```bash
cd web && npx tsc --noEmit && npx eslint src/app/admin/partners/actions.ts
```

期待: どちらもエラー 0 件

- [x] **Step 5: コミット**

```bash
git add web/src/app/admin/partners/actions.ts
git commit -m "feat(partners): 取引先の部署 CRUD Server Actions を追加"
```

---

### Task 9: 荷主マスタ画面に部署設定を追加

**Files:**
- Modify: `web/src/app/admin/partners/page.tsx`

**Interfaces:**
- Consumes: Task 8 の 5 つの Server Action
- Produces: 荷主編集フォームの `use_departments` トグルと部署管理 UI

- [ ] **Step 1: 荷主フォームに `use_departments` トグルを追加する**

`page.tsx` のフォーム state（49-53行付近の型と 66-70行付近の初期値）に `use_departments: boolean` を追加し、締め日セレクトの近くにトグルを置く。

```tsx
<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={form.use_departments}
    onChange={e => set('use_departments', e.target.checked)}
  />
  <span>部署で請求を分ける</span>
</label>
<p className="text-xs text-zinc-500">
  同じ会社でも部署ごとに請求書を分けて提出する場合にオンにします。
  オンにすると案件の登録時に部署の指定が必要になります。あとから変更できます。
</p>
```

保存処理（523-527行付近の payload 組み立て）に `use_departments: form.use_departments` を追加する。
編集時の読み込み（496-500行付近）にも `use_departments: row.use_departments ?? false` を追加する。

- [ ] **Step 2: 部署管理 UI を追加する**

トグルがオンのときのみ表示する。部署の一覧・追加・編集・削除・並び順を扱う。

```tsx
{form.use_departments && (
  <div className="mt-4 rounded border border-zinc-200 p-3">
    <div className="mb-2 text-sm font-medium">部署</div>
    {departments.length === 0 && (
      <p className="text-xs text-zinc-500">
        部署がまだ登録されていません。1つ以上登録してください。
      </p>
    )}
    <ul className="space-y-2">
      {departments.map(d => (
        <li key={d.id} className="flex items-center gap-2">
          <span className="flex-1">{d.name}</span>
          <span className="text-xs text-zinc-500">{d.contact_name ?? '担当者未設定'}</span>
          <button type="button" onClick={() => handleEditDepartment(d)}>編集</button>
          <button type="button" onClick={() => handleDeleteDepartment(d.id)}>削除</button>
        </li>
      ))}
    </ul>
    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-200 pt-3">
      <div>
        <label className="text-xs text-zinc-600">部署名 <span className="text-red-500">*</span></label>
        <input
          className={inputCls}
          value={deptForm.name}
          onChange={e => setDeptForm({ ...deptForm, name: e.target.value })}
          placeholder="人材派遣部"
        />
      </div>
      <div>
        <label className="text-xs text-zinc-600">担当者名</label>
        <input
          className={inputCls}
          value={deptForm.contact_name}
          onChange={e => setDeptForm({ ...deptForm, contact_name: e.target.value })}
        />
      </div>
      <div>
        <label className="text-xs text-zinc-600">メール</label>
        <input
          className={inputCls}
          value={deptForm.email}
          onChange={e => setDeptForm({ ...deptForm, email: e.target.value })}
        />
      </div>
      <div>
        <label className="text-xs text-zinc-600">電話</label>
        <input
          className={inputCls}
          value={deptForm.phone}
          onChange={e => setDeptForm({ ...deptForm, phone: e.target.value })}
        />
      </div>
      <div>
        <label className="text-xs text-zinc-600">並び順</label>
        <input
          type="number"
          className={inputCls}
          value={deptForm.sort_order}
          onChange={e => setDeptForm({ ...deptForm, sort_order: Number(e.target.value) })}
        />
      </div>
      <div className="flex items-end">
        <button
          type="button"
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          disabled={!deptForm.name.trim()}
          onClick={handleSaveDepartment}
        >
          {editingDeptId ? '更新' : '追加'}
        </button>
      </div>
    </div>
  </div>
)}
```

state と保存ハンドラは以下のとおり:

```tsx
type DeptForm = { name: string; contact_name: string; email: string; phone: string; sort_order: number }
const emptyDeptForm: DeptForm = { name: '', contact_name: '', email: '', phone: '', sort_order: 0 }

const [departments, setDepartments]   = useState<ClientDepartmentRow[]>([])
const [deptForm, setDeptForm]         = useState<DeptForm>(emptyDeptForm)
const [editingDeptId, setEditingDeptId] = useState<string | null>(null)
const [unassignedCount, setUnassignedCount] = useState(0)

async function reloadDepartments(clientId: string) {
  const res = await fetchClientDepartments(clientId)
  if (res.data) setDepartments(res.data)
}

async function handleSaveDepartment() {
  if (!editingClientId) return
  const payload = {
    name:         deptForm.name.trim(),
    contact_name: deptForm.contact_name || null,
    email:        deptForm.email || null,
    phone:        deptForm.phone || null,
    sort_order:   deptForm.sort_order,
  }
  const res = editingDeptId
    ? await updateClientDepartment(editingDeptId, payload)
    : await createClientDepartment({ ...payload, client_id: editingClientId })
  if (res.error) { setFormError(res.error); return }
  setDeptForm(emptyDeptForm)
  setEditingDeptId(null)
  await reloadDepartments(editingClientId)
}

function handleEditDepartment(d: ClientDepartmentRow) {
  setEditingDeptId(d.id)
  setDeptForm({
    name:         d.name,
    contact_name: d.contact_name ?? '',
    email:        d.email ?? '',
    phone:        d.phone ?? '',
    sort_order:   d.sort_order,
  })
}

async function handleDeleteDepartment(id: string) {
  if (!confirm('この部署を削除しますか？\n確定済みの請求書がある部署は削除できません。')) return
  const res = await deleteClientDepartment(id)
  if (res.error) { setFormError(res.error); return }
  if (editingClientId) await reloadDepartments(editingClientId)
}
```

⚠️ `editingClientId` は既存の編集対象荷主 ID を保持する state。ファイル内の既存の命名に合わせること。

⚠️ **削除は確認ダイアログを出す。** 確定済み請求書がぶら下がっている部署は削除できず、
「他のデータから参照されているため削除できません」が返る。このメッセージをそのまま画面に出す。

- [ ] **Step 3: 未割当案件の警告を出す**

トグルをオフからオンに変更したとき、`countUnassignedProjects(clientId)` を呼び、0 より大きければ表示する。

```tsx
{unassignedCount > 0 && (
  <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-800">
    ⚠️ この荷主には部署が未割当の案件が {unassignedCount} 件あります。
    このままでは請求書に含まれません。案件管理画面で部署を割り当ててください。
  </p>
)}
```

- [ ] **Step 4: 型チェックとリント**

```bash
cd web && npx tsc --noEmit && npx eslint src/app/admin/partners/page.tsx
```

期待: どちらもエラー 0 件

- [ ] **Step 5: ローカルで実地確認**

`/admin/partners` で `read_page` を使って確認する:

1. 荷主編集で「部署で請求を分ける」をオンにできる
2. 部署を 2 つ登録でき、`sort_order` の順に並ぶ
3. 部署を編集・削除できる
4. 未割当案件がある荷主でオンにすると警告が出る

- [ ] **Step 6: コミット**

```bash
git add web/src/app/admin/partners/page.tsx
git commit -m "feat(partners): 荷主マスタに部署分割トグルと部署管理UIを追加"
```

---

### Task 10: 案件マスタ画面に部署セレクトを追加

**Files:**
- Modify: `web/src/app/admin/projects/page.tsx`（荷主セレクト 174行付近、保存 695-705行付近）
- Modify: `web/src/app/admin/projects/actions.ts`（保存 payload に `department_id`）

**Interfaces:**
- Consumes: `fetchClientDepartments`（Task 8）
- Produces: 案件フォームの部署セレクト

- [ ] **Step 1: フォーム state に `department_id` を追加する**

型（56行付近）に `department_id: string`、初期値（68行付近）に `department_id: ''` を追加する。

- [ ] **Step 2: 荷主選択に連動する部署セレクトを追加する**

荷主セレクト（174行）の直後に置く。選択中の荷主が `use_departments = true` のときのみ表示する。

```tsx
{selectedClientUsesDepartments && (
  <>
    <label className={labelCls}>部署 <span className="text-red-500">*</span></label>
    <select
      className={selectCls}
      value={form.department_id}
      onChange={e => set('department_id', e.target.value)}
      required
    >
      <option value="">選択してください</option>
      {departments.map(d => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  </>
)}
```

荷主を切り替えたら `fetchClientDepartments(newClientId)` を呼び直し、`form.department_id` を `''` にリセットする。

- [ ] **Step 3: 保存時のバリデーションを追加する**

695行付近の `if (!form.client_id)` の直後に追加:

```ts
if (selectedClientUsesDepartments && !form.department_id) {
  setFormError('部署を選択してください')
  setSaving(false)
  return
}
```

保存 payload（700行付近）に追加:

```ts
department_id: form.department_id || null,
```

- [ ] **Step 4: 案件一覧に部署列を追加する**

部署を持つ荷主の案件で、どの部署に属するかが一覧で分かるようにする。未割当は `—` ではなく **「未割当」を目立つ色で**表示する（請求漏れに直結するため）。

ヘッダ行に `<th className="px-4 py-3 text-left">部署</th>` を追加し、データ行に:

```tsx
<td className="px-4 py-3 text-zinc-600">
  {!clientUsesDepartments(row.client_id)
    ? '—'
    : row.department_id
      ? (departmentNameMap.get(row.department_id) ?? '—')
      : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">未割当</span>}
</td>
```

`departmentNameMap` は全部署の `id → name` の Map、`clientUsesDepartments` は荷主 ID から
`use_departments` を引く関数。どちらも案件一覧の読み込み時に一度だけ作る。

⚠️ 案件ごとに `fetchClientDepartments` を呼んではならない（N+1 になる）。一覧読み込み時に
荷主一覧と全部署を一括で取得して Map を組む。

- [ ] **Step 5: 型チェックとリント**

```bash
cd web && npx tsc --noEmit && npx eslint src/app/admin/projects/page.tsx src/app/admin/projects/actions.ts
```

期待: どちらもエラー 0 件

- [ ] **Step 6: ローカルで実地確認**

`/admin/projects` で `read_page` を使って確認する:

1. `use_departments = false` の荷主を選ぶと部署セレクトが**表示されない**
2. `use_departments = true` の荷主を選ぶと部署セレクトが表示され、未選択では保存できない
3. 部署を選んで保存でき、一覧に部署名が出る
4. 未割当の案件が一覧で「未割当」と目立つ形で表示される

- [ ] **Step 7: コミット**

```bash
git add web/src/app/admin/projects/page.tsx web/src/app/admin/projects/actions.ts
git commit -m "feat(projects): 案件マスタに部署セレクトを追加"
```

---

### Task 11: 請求書生成ロジックの部署対応 ✅ 完了 2026-08-03（コミット `1174e3e`。実関数名は fetchInvoicePreview でなく computeInvoicePreview）

**Files:**
- Modify: `web/src/app/admin/sales/actions.ts`（`fetchInvoicePreview` 271-334行、`upsertInvoice` 382行〜）

**Interfaces:**
- Consumes: `client_departments`（Task 2）、`writeInvoice`（Task 3）
- Produces:
  - `fetchInvoicePreview(clientId: string, yearMonth: string, departmentId?: string | null)`
  - `upsertInvoice(clientId: string, yearMonth: string, departmentId?: string | null)`
  - `fetchExistingInvoices(clientId: string, yearMonth: string): Promise<ActionResult<ExistingInvoiceSummary[]>>`
  - `type ExistingInvoiceSummary = { id: string; departmentId: string | null; departmentName: string | null; status: string; totalAmount: number }`

- [ ] **Step 1: `fetchInvoicePreview` に `departmentId` 引数を足す**

荷主の取得（271-276行）の select に `use_departments` を追加し、案件の絞り込み（285-291行）を変える:

```ts
  // 部署制ONなら departmentId は必須。未指定で全案件を集めると、
  // 部署をまたいだ請求書ができて取引先に誤った金額を提示することになる
  if (client.use_departments && !departmentId) {
    return { data: null, error: '部署を選択してください' }
  }

  let projectQuery = supabase
    .from('projects')
    .select('id, project_name, project_code')
    .eq('client_id', clientId)
    .eq('tenant_id', tenantId)

  if (client.use_departments) {
    projectQuery = projectQuery.eq('department_id', departmentId!)
  }

  const { data: projects, error: projErr } = await projectQuery
```

⚠️ `use_departments = false` の場合は**絞り込みを一切足さない**。従来どおり全案件が対象になる（回帰を起こさないため）。

- [ ] **Step 2: 既存請求書の判定に部署を含める**

328-333行の既存請求書 SELECT を、部署も条件に含めるよう変える:

```ts
    (() => {
      let q = supabase
        .from('invoices')
        .select('id, status')
        .eq('client_id', clientId)
        .eq('invoice_month', toDbMonth(yearMonth))
        .eq('tenant_id', tenantId)
      // ⚠️ .eq('department_id', null) は PostgREST では動かない。必ず .is() を使う
      q = departmentId ? q.eq('department_id', departmentId) : q.is('department_id', null)
      return q.maybeSingle()
    })(),
```

- [ ] **Step 3: 未割当案件の件数をプレビューに載せる**

`InvoicePreview` 型に `unassignedProjectCount: number` を追加し、`use_departments = true` のときだけ `department_id IS NULL` の案件数を数えて入れる（`false` のときは常に 0）。

- [ ] **Step 4: `upsertInvoice` に `departmentId` を渡す**

Task 4 で `departmentId: null` としていた箇所を引数の値に変える。`fetchInvoicePreview` にも同じ `departmentId` を渡す。

- [ ] **Step 5: `fetchExistingInvoices` を追加する**

生成前に同一（荷主, 月）の請求書を一覧表示するために使う。

```ts
export type ExistingInvoiceSummary = {
  id:             string
  departmentId:   string | null
  departmentName: string | null
  status:         string
  totalAmount:    number
}

export async function fetchExistingInvoices(
  clientId: string,
  yearMonth: string,
): Promise<ActionResult<ExistingInvoiceSummary[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('invoices')
    .select('id, department_id, status, total_amount, client_departments ( name )')
    .eq('client_id',     clientId)
    .eq('invoice_month', toDbMonth(yearMonth))
    .eq('tenant_id',     tenantId)
  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map(r => ({
      id:             r.id as string,
      departmentId:   (r.department_id as string | null),
      departmentName: ((r as Record<string, unknown>)['client_departments'] as { name: string } | null)?.name ?? null,
      status:         r.status as string,
      totalAmount:    r.total_amount as number,
    })),
    error: null,
  }
}
```

⚠️ `requireOwner` / `getCurrentTenantId` / `createServiceClient` がこのファイルで未 import なら追加する。

- [ ] **Step 6: 型チェックとテスト**

```bash
cd web && npx tsc --noEmit && npx vitest run
```

期待: どちらもエラー 0 件

- [ ] **Step 7: コミット**

```bash
git add web/src/app/admin/sales/actions.ts
git commit -m "feat(billing): 請求書生成を部署単位に対応、既存請求書の一覧取得を追加"
```

---

### Task 12: 請求書生成画面の部署対応 ✅ 完了 2026-08-03（コミット `9832ea5`。Step 5 の実地確認も本番URLで全項目合格）

**Files:**
- Modify: `web/src/app/admin/sales/page.tsx`（または請求書生成タブのコンポーネント）

**Interfaces:**
- Consumes: `fetchInvoicePreview` / `upsertInvoice` / `fetchExistingInvoices`（Task 11）、`fetchClientDepartments`（Task 8）
- Produces: なし（画面のみ）

- [ ] **Step 1: 部署セレクトを追加する**

荷主セレクトの隣に置く。選択中の荷主が `use_departments = true` のときのみ表示・必須。

```tsx
const [departments, setDepartments] = useState<ClientDepartmentRow[]>([])
const [departmentId, setDepartmentId] = useState<string>('')

// 荷主を変えたら部署一覧を取り直し、選択をリセットする
useEffect(() => {
  setDepartmentId('')
  setDepartments([])
  if (!selectedClient?.use_departments) return
  fetchClientDepartments(selectedClient.id).then(res => {
    if (res.data) setDepartments(res.data)
  })
}, [selectedClient?.id, selectedClient?.use_departments])
```

```tsx
{selectedClient?.use_departments && (
  <select
    className={selectCls}
    value={departmentId}
    onChange={e => setDepartmentId(e.target.value)}
    required
  >
    <option value="">部署を選択</option>
    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
  </select>
)}
```

`fetchInvoicePreview` / `upsertInvoice` の呼び出しには
`selectedClient?.use_departments ? departmentId : null` を渡す。

生成ボタンは `selectedClient?.use_departments && !departmentId` のとき `disabled` にする。

- [ ] **Step 2: 未割当案件の警告を出す**

```tsx
{preview && preview.unassignedProjectCount > 0 && (
  <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">
    ⚠️ 部署が未割当の案件が {preview.unassignedProjectCount} 件あります。
    この請求書には含まれません。案件管理画面で部署を割り当ててください。
  </p>
)}
```

⚠️ **生成をブロックしない。** 止めると業務が回らないため、警告のみに留める（設計書 §8-2）。

- [ ] **Step 3: 既存請求書の一覧を生成前に表示する**

荷主と対象月が決まった時点で `fetchExistingInvoices` を呼び、1 件以上あれば表示する。

```tsx
{existingInvoices.length > 0 && (
  <div className="rounded border border-zinc-300 p-3">
    <div className="mb-1 text-sm font-medium">
      この荷主・この月には既に {existingInvoices.length} 件の請求書があります
    </div>
    <ul className="text-sm">
      {existingInvoices.map(inv => (
        <li key={inv.id}>
          {inv.departmentName ?? '（部署なし）'} — {inv.status} — ¥{inv.totalAmount.toLocaleString()}
        </li>
      ))}
    </ul>
  </div>
)}
```

これは部署機能と独立に価値のあるガードである。二重請求は取引先に直接迷惑がかかるため、生成前に必ず見せる。

- [ ] **Step 4: 型チェックとリント**

```bash
cd web && npx tsc --noEmit && npx eslint src/app/admin/sales/
```

期待: どちらもエラー 0 件

- [ ] **Step 5: ローカルで実地確認（`read_page`）**

- [ ] `use_departments = false` の荷主では部署セレクトが出ず、従来どおり生成できる
- [ ] `use_departments = true` の荷主では部署セレクトが出て、未選択だと生成できない
- [ ] **同一荷主・同一月で部署 A・部署 B の 2 枚が生成できる**（Task 7 の張り替えが効いていること）
- [ ] 同じ部署・同じ月で 2 回生成すると、2 枚目が作られず 1 枚目が更新される
- [ ] 未割当案件があると警告が出る
- [ ] 既存請求書の一覧が生成前に表示される

- [ ] **Step 6: コミット**

```bash
git add web/src/app/admin/sales/
git commit -m "feat(billing): 請求書生成画面に部署セレクト・未割当警告・既存請求書一覧を追加"
```

---

### Task 13: 総合検証・本番反映・引き継ぎ更新 ✅ 完了 2026-08-04（全項目合格。§11-4含む。検証記録は HANDOVER §5-4 の 2026-08-03 その2）

**Files:**
- Modify: `docs/HANDOVER_MASTER.md`（§5-2 のタスク表、§5-4 に作業履歴、§5-7 にテーブル追記）

**Interfaces:**
- Consumes: Task 1〜12 のすべて
- Produces: 更新された引き継ぎドキュメント

- [ ] **Step 1: 設計書 §11 の検証項目をすべて実施する**

`docs/superpowers/specs/2026-07-29-client-departments-design.md` §11 の全チェックボックスを埋める。
特に §11-4（フラグ切替）は他タスクで扱っていないため、ここで必ず確認する:

- [ ] OFF → ON にすると未割当案件の件数が表示される
- [ ] ON → OFF にしても過去の請求書の `department_id` が変わらない
- [ ] ON → OFF 後に生成した請求書と、過去の部署別請求書が共存できる

- [ ] **Step 2: 全テストと型チェックを通す**

```bash
cd web && npx tsc --noEmit && npx vitest run && npx eslint src
```

期待: すべてエラー 0 件

- [ ] **Step 3: ビルドが通ることを確認する**

```bash
cd web && npm run build
```

期待: 成功。**失敗したまま `main` にマージしない**（自動デプロイが走るため）

- [ ] **Step 4: コミット前セキュリティチェック（HANDOVER §2-6S・スキップ禁止）**

```bash
cd /Users/kawasakiatsushi/developer/unsou-system && git status --short
```

`.next/` / `.open-next/` / `ooba/` が候補に無いことを確認する。

```bash
git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"
```

期待: 出力が空

- [ ] **Step 5: `main` へマージする（ボス確認必須）**

⚠️ **`main` への push は `web/**` の変更で本番へ自動デプロイされる。** マージ前にボスの確認を取る。

```bash
git switch main && git merge --no-ff feat/client-departments
```

- [ ] **Step 6: 本番デプロイを確認する**

GitHub Actions の CI が緑になっただけでは不十分。**Cloudflare Worker の `modified_on` が更新されていることで判定する**（HANDOVER の自動デプロイメモ参照）。

- [ ] **Step 7: 本番URLで最終確認する**

`https://unsou-system.kawapon7.workers.dev` で、部署を 2 つ持つ荷主の請求書を 2 枚生成できることを確認する。
ローカルで通ってもデプロイ経路で壊れることがある（2026-07-29 の事例）。

- [ ] **Step 8: `docs/HANDOVER_MASTER.md` を更新する**

1. §5-2 のタスク表に「✅ 完了 2026-07-XX 取引先の部署分割対応＋請求書書き込み一本化」を追加
2. §5-4 に作業履歴を追加（発見したバグ B-1〜B-3、制約張り替えの経緯、ベースライン結果）
3. §5-7 のテーブル一覧に `client_departments` を追加し、`invoices` の行に部署対応を追記
4. §5-6 の Server Actions 一覧に Task 8 の 5 関数と `fetchExistingInvoices` を追加
5. **`pdfActions.ts` の整理**と**日別配置表の自動生成**が未着手であることを明記

- [ ] **Step 9: コミット**

```bash
git add docs/HANDOVER_MASTER.md docs/superpowers/specs/2026-07-29-client-departments-design.md
git commit -m "docs: 部署分割対応の完了と検証結果を記録"
```

---

## 残課題（本計画の範囲外・別計画とする）

| 項目 | 内容 |
|---|---|
| 日別配置表（Excel）の自動生成 | ドライバーカレンダーから協和冷蔵形式の人員配置表を自動入力。①②の 2 名体制・ドライバー表示順の固定 |
| 請求書テンプレートの取引先別カスタマイズ | 実物レイアウトの再現・角印の埋め込み・案件によってドライバー名を出す/出さない |
| `pdfActions.ts` の整理 | 未使用の重複ファイル。2026-07-29 から未着手 |
| `commitManualInvoice` の税額 | Task 4 Step 3 で税額 0 固定としている。手動請求書に消費税を持たせる必要があるか要確認 |
