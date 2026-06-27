# テナント分離 フェーズ0（下ごしらえ）実装計画

> **実装担当: Cursor（Sonnet 4.6）。** 各タスクはそのまま貼れるSQL/コードを含む。前置き・要約は不要、指示通りに実装すること。
> **このフェーズのDB適用（push/db push/SQL実行）は人間が行う。** Cursorはファイル作成と、指示された読み取り専用クエリの提示までに留める。

**ゴール:** 全テナント対象テーブルの `tenant_id` を `UUID NOT NULL`（companies参照）に統一し、既存データをA社テナントへbackfill。テナントIDを `app_metadata` 管理へ移行する。**この時点ではアプリは引き続き service_role で動くため、画面の挙動は変わらない。**

**アーキテクチャ:** 設計書 `docs/superpowers/specs/2026-06-27-tenant-isolation-rls-design.md` のフェーズ0に対応。additive（追加）中心で、失敗時もfail-closedにすらならない（RLSはF1で導入）。

**Tech Stack:** Supabase (Postgres) マイグレーション / Next.js Server Actions / `@supabase/supabase-js` の `auth.admin`。

## Global Constraints

- 対象DB適用は人間が実施（バックアップ→ステージング→本番）。Cursorはファイル作成のみ。
- 自動生成物（`.next/` `.open-next/`）・`.env*` をコミットに巻き込まない。`git add` は対象ファイルを明示。
- マイグレーションは `BEGIN; ... COMMIT;` で囲む。
- `company_id`（work_records/expense_records の旧概念）はF0では**削除しない**（F3で撤去）。F0は追加・変換のみ。
- 既存の不変ログトリガー（approval_history / notification_logs）には触れない。
- マイグレーション命名: `supabase/migrations/YYYYMMDDHHMMSS_説明.sql`。既存最新（`20260627000001`）より後のタイムスタンプにする。

### テナント対象テーブル（F0で tenant_id を持たせる全テーブル）

既に `tenant_id` あり（型を確認・統一する）:
- TEXT型（`DEFAULT 'local-dev'`）: `clients` / `contractors` / `projects` / `work_records` / `expense_records` / `schedules`
- UUID型（統一済・変換不要）: `driver_project_assignments`

`tenant_id` が**無い**ため追加が必要:
- `approval_history` / `billing_records` / `invoices` / `notification_logs` / `payment_notices` / `payments` / `price_rules` / `project_payees` / `scan_jobs`

対象外（テナント列を持たせない）:
- `companies`（テナントマスタ自身）/ `users`（テナントは `app_metadata` で保持。DB列は持たせない）

---

## Task 0: 事前調査（現状データの確定）

**目的:** 変換に使う「A社の正準テナントUUID」を確定し、想定（既存 tenant_id は実質1種類）を検証する。**このタスクは読み取り専用クエリの提示のみ。Cursorは実行せず、人間がステージング/本番で実行して結果を確認する。**

**Files:** なし（クエリ提示のみ）

- [ ] **Step 1: 既存 tenant_id 値の分布を確認**

人間がSupabase SQL Editorで実行:
```sql
-- TEXT型6テーブルの tenant_id 実値の種類と件数
SELECT 'clients' t, tenant_id, count(*) FROM clients GROUP BY tenant_id
UNION ALL SELECT 'contractors', tenant_id, count(*) FROM contractors GROUP BY tenant_id
UNION ALL SELECT 'projects', tenant_id, count(*) FROM projects GROUP BY tenant_id
UNION ALL SELECT 'work_records', tenant_id, count(*) FROM work_records GROUP BY tenant_id
UNION ALL SELECT 'expense_records', tenant_id, count(*) FROM expense_records GROUP BY tenant_id
UNION ALL SELECT 'schedules', tenant_id, count(*) FROM schedules GROUP BY tenant_id
ORDER BY 1,2;
```
Expected: tenant_id は `'local-dev'` のみ（A社単独運用のため）。`'local-dev'` 以外が出たら**この計画を中断し相談**（複数テナントが既に混在している想定外ケース）。

- [ ] **Step 2: 既に uuid を持つ dpa の値を確認**

```sql
SELECT tenant_id, count(*) FROM driver_project_assignments GROUP BY tenant_id;
```
Expected: 0件、または単一のUUID。**単一UUIDが存在する場合、その値を「A社の正準テナントUUID」として採用する**（後続のbackfill先をこのUUIDに合わせる）。0件なら新規UUIDを発番する（Step 3）。

- [ ] **Step 3: 既存ユーザーの tenant_id 保持状況を確認**

```sql
SELECT id, email,
       raw_user_meta_data ->> 'tenant_id' AS user_meta_tenant,
       raw_app_meta_data  ->> 'tenant_id' AS app_meta_tenant
FROM auth.users;
```
Expected: `user_meta_tenant` に値があるか未設定かを把握。`app_meta_tenant` は未設定のはず。

- [ ] **Step 4: 正準UUIDの確定**

Step 2でUUIDが見つかればそれを採用。無ければ固定UUID `00000000-0000-0000-0000-0000000000a1` をA社として採用する（任意だが以降のタスクで一貫使用すること）。
**以降このUUIDを `<TENANT_A_UUID>` と表記する。Task 1〜7の `<TENANT_A_UUID>` を全てこの確定値に置換すること。**

---

## Task 1: companies にA社行を投入するマイグレーション

**Files:**
- Create: `supabase/migrations/20260628000000_seed_company_a.sql`

**Interfaces:**
- Produces: `companies` に `id = <TENANT_A_UUID>` の行（後続の全 tenant_id FK 参照先）。

- [ ] **Step 1: マイグレーション作成**

```sql
-- A社（既存単一テナント）を companies に登録。tenant_id 統一の参照先。
BEGIN;

INSERT INTO companies (id, name)
VALUES ('<TENANT_A_UUID>', 'A社')
ON CONFLICT (id) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: コミット**

```bash
git add supabase/migrations/20260628000000_seed_company_a.sql
git commit -m "feat(tenant): F0 companies にA社テナント行を投入"
```

---

## Task 2: tenant_id が無いテーブルへ列を追加（nullable）

**Files:**
- Create: `supabase/migrations/20260628000001_add_tenant_id_missing_tables.sql`

**Interfaces:**
- Produces: 9テーブルに `tenant_id uuid`（この時点では nullable・FKなし。backfill後にTask 4で締める）。

- [ ] **Step 1: マイグレーション作成**

```sql
-- tenant_id 未保持テーブルへ追加（まず nullable。backfill 後に NOT NULL 化）。
BEGIN;

ALTER TABLE approval_history  ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE billing_records   ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE invoices          ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE payment_notices   ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE payments          ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE price_rules       ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE project_payees    ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE scan_jobs         ADD COLUMN IF NOT EXISTS tenant_id uuid;

COMMIT;
```

- [ ] **Step 2: コミット**

```bash
git add supabase/migrations/20260628000001_add_tenant_id_missing_tables.sql
git commit -m "feat(tenant): F0 不足テーブルへ tenant_id 列を追加(nullable)"
```

---

## Task 3: TEXT型6テーブルの tenant_id を UUID へ変換 ＋ 全テーブル backfill

**Files:**
- Create: `supabase/migrations/20260628000002_tenant_id_to_uuid_and_backfill.sql`

**Interfaces:**
- Consumes: `<TENANT_A_UUID>`（Task 0確定）。companies行（Task 1）。Task 2で追加した列。
- Produces: 全テナント対象テーブルの `tenant_id` が UUID型・全行が `<TENANT_A_UUID>`。

- [ ] **Step 1: マイグレーション作成**

```sql
-- (A) TEXT型6テーブル: DEFAULT 撤去 → 'local-dev' を A社UUID へ書換え → 型を uuid へ変換
-- (B) Task2で追加した9テーブル + dpa: backfill（NULL を A社UUID で埋める）
BEGIN;

-- (A) TEXT → UUID 変換（clients/contractors/projects/work_records/expense_records/schedules）
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['clients','contractors','projects','work_records','expense_records','schedules']
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id DROP DEFAULT', tbl);
    EXECUTE format($f$UPDATE %I SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id = 'local-dev' OR tenant_id IS NULL$f$, tbl);
    EXECUTE format($f$ALTER TABLE %I ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid$f$, tbl);
  END LOOP;
END $$;

-- (B) tenant_id を追加した9テーブルの backfill
UPDATE approval_history  SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;
UPDATE billing_records   SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;
UPDATE invoices          SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;
UPDATE notification_logs SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;
UPDATE payment_notices   SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;
UPDATE payments          SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;
UPDATE price_rules       SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;
UPDATE project_payees    SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;
UPDATE scan_jobs         SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;

-- dpa（既にuuid型）も念のため backfill
UPDATE driver_project_assignments SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;

COMMIT;
```

> ⚠️ 注意: `notification_logs` / `approval_history` は不変トリガー（UPDATE禁止）対象。
> このUPDATEは**マイグレーション（テーブルowner権限）で実行**するため、`session_replication_role` の扱いに注意。
> 適用時にトリガーでUPDATEが弾かれる場合は、当該2テーブルのみ「トリガーを一時 DISABLE → UPDATE → ENABLE」を
> 同一トランザクション内で行う（下記Step 2の代替SQL参照）。

- [ ] **Step 2: （必要時のみ）不変トリガーで弾かれた場合の代替**

`notification_logs` / `approval_history` のbackfillがトリガーで失敗したら、その2テーブルのUPDATEを次で置換:
```sql
ALTER TABLE notification_logs DISABLE TRIGGER trg_notification_logs_no_update;
UPDATE notification_logs SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;
ALTER TABLE notification_logs ENABLE TRIGGER trg_notification_logs_no_update;

ALTER TABLE approval_history DISABLE TRIGGER trg_approval_history_no_update;
UPDATE approval_history SET tenant_id = '<TENANT_A_UUID>' WHERE tenant_id IS NULL;
ALTER TABLE approval_history ENABLE TRIGGER trg_approval_history_no_update;
```

- [ ] **Step 3: コミット**

```bash
git add supabase/migrations/20260628000002_tenant_id_to_uuid_and_backfill.sql
git commit -m "feat(tenant): F0 tenant_id を UUID 統一しA社へbackfill"
```

---

## Task 4: NOT NULL ＋ FK ＋ インデックス付与

**Files:**
- Create: `supabase/migrations/20260628000003_tenant_id_constraints.sql`

**Interfaces:**
- Consumes: backfill完了（Task 3。NULL行が無いこと）。
- Produces: 全15テーブルの `tenant_id` が `NOT NULL` ＋ `companies(id)` FK ＋ index。

- [ ] **Step 1: マイグレーション作成**

```sql
-- 全テナント対象テーブルへ NOT NULL / FK / index を付与
BEGIN;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'clients','contractors','projects','work_records','expense_records','schedules',
    'driver_project_assignments',
    'approval_history','billing_records','invoices','notification_logs',
    'payment_notices','payments','price_rules','project_payees','scan_jobs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', tbl);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES companies(id)',
      tbl, tbl || '_tenant_id_fkey'
    );
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)', 'idx_' || tbl || '_tenant_id', tbl);
  END LOOP;
END $$;

COMMIT;
```

> ⚠️ FK制約が既に存在するとエラーになる。再実行時は `ADD CONSTRAINT` を `DROP CONSTRAINT IF EXISTS ... ; ADD CONSTRAINT` の順にするか、エラー時に当該行をスキップ。

- [ ] **Step 2: コミット**

```bash
git add supabase/migrations/20260628000003_tenant_id_constraints.sql
git commit -m "feat(tenant): F0 tenant_id に NOT NULL/FK/index を付与"
```

---

## Task 5: dev用テナントUUID定数の更新（アプリ）

**Files:**
- Modify: `web/src/utils/tenant.ts`

**Interfaces:**
- Produces: `DEV_TENANT_ID` が `<TENANT_A_UUID>`（UUID）になり、UUID型 tenant_id と整合。

- [ ] **Step 1: DEV_TENANT_ID を UUID へ変更**

`web/src/utils/tenant.ts` の現在の定数:
```ts
export const DEV_TENANT_ID = 'local-dev'
```
を次へ変更:
```ts
// F0でtenant_idをUUID統一したため、dev/bypass時もUUIDを返す（A社=既存単一テナント）
export const DEV_TENANT_ID = '<TENANT_A_UUID>'
```

- [ ] **Step 2: 型チェック**

Run: `cd web && npx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 3: コミット**

```bash
git add web/src/utils/tenant.ts
git commit -m "feat(tenant): F0 DEV_TENANT_ID を A社UUID へ更新"
```

---

## Task 6: getCurrentTenantId を app_metadata 読み取りへ変更（アプリ）

**Files:**
- Modify: `web/src/utils/tenant.ts`

**Interfaces:**
- Consumes: ログインユーザーJWTの `app_metadata.tenant_id`。
- Produces: `getCurrentTenantId()` が `app_metadata.tenant_id` を返す（本人改変不能な経路）。未解決は例外（fail-closed維持）。

- [ ] **Step 1: 取得元を user_metadata → app_metadata に変更**

`web/src/utils/tenant.ts` の `getCurrentTenantId` 内、現在:
```ts
  const tenantId = user?.user_metadata?.tenant_id
```
を次へ変更（`app_metadata` を一次ソースにし、移行途中の保険として user_metadata もフォールバック）:
```ts
  // app_metadata（管理者のみ設定可・本人改変不能）を一次ソースにする。
  // 移行期間中は user_metadata もフォールバックで許容（F3で撤去）。
  const tenantId =
    (user?.app_metadata as { tenant_id?: string } | undefined)?.tenant_id
    ?? user?.user_metadata?.tenant_id
```

- [ ] **Step 2: 型チェック**

Run: `cd web && npx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 3: コミット**

```bash
git add web/src/utils/tenant.ts
git commit -m "feat(tenant): F0 getCurrentTenantId を app_metadata 読取りへ移行"
```

---

## Task 7: 既存ユーザーの app_metadata.tenant_id 設定スクリプト

**Files:**
- Create: `scripts/backfill-app-metadata-tenant.mjs`

**Interfaces:**
- Consumes: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `<TENANT_A_UUID>`。
- Produces: 全 auth ユーザーの `app_metadata.tenant_id = <TENANT_A_UUID>`。

> このスクリプトは `auth.admin`（service_role）が必要なため、DB マイグレーションではなく一度きりの実行スクリプトとして用意する。実行は人間が行う。

- [ ] **Step 1: スクリプト作成**

```js
// scripts/backfill-app-metadata-tenant.mjs
// 既存ユーザー全員の app_metadata.tenant_id を A社UUIDに設定する一度きりのスクリプト。
// 実行: node scripts/backfill-app-metadata-tenant.mjs
// 必要env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js'

const TENANT_A_UUID = '<TENANT_A_UUID>'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { throw new Error('env未設定: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY') }

const admin = createClient(url, key, { auth: { persistSession: false } })

let page = 1
let total = 0
for (;;) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
  if (error) throw error
  const users = data.users
  if (users.length === 0) break
  for (const u of users) {
    const current = u.app_metadata?.tenant_id
    if (current === TENANT_A_UUID) continue
    const { error: upErr } = await admin.auth.admin.updateUserById(u.id, {
      app_metadata: { ...u.app_metadata, tenant_id: TENANT_A_UUID },
    })
    if (upErr) { console.error('更新失敗', u.email, upErr.message); continue }
    total++
    console.log('更新', u.email)
  }
  page++
}
console.log(`完了: ${total} 件のユーザーに tenant_id を設定`)
```

- [ ] **Step 2: コミット**

```bash
git add scripts/backfill-app-metadata-tenant.mjs
git commit -m "feat(tenant): F0 既存ユーザーへ app_metadata.tenant_id 設定スクリプト追加"
```

---

## Task 8: 検証（人間が適用後に実施）

**Files:** なし（検証クエリ・手順の提示）

- [ ] **Step 1: NULL残存ゼロの確認**

```sql
SELECT 'clients' t, count(*) FROM clients WHERE tenant_id IS NULL
UNION ALL SELECT 'invoices', count(*) FROM invoices WHERE tenant_id IS NULL
UNION ALL SELECT 'payment_notices', count(*) FROM payment_notices WHERE tenant_id IS NULL
UNION ALL SELECT 'notification_logs', count(*) FROM notification_logs WHERE tenant_id IS NULL;
-- 他テーブルも同様に。全て 0 であること。
```
Expected: 全テーブル 0。

- [ ] **Step 2: tenant_id が単一値（A社）であることの確認**

```sql
SELECT DISTINCT tenant_id FROM projects;   -- <TENANT_A_UUID> のみ
SELECT id, name FROM companies;            -- A社行が存在
```

- [ ] **Step 3: ユーザーの app_metadata 設定確認**

```sql
SELECT count(*) FROM auth.users WHERE raw_app_meta_data ->> 'tenant_id' IS NULL;
-- 0 であること
```

- [ ] **Step 4: アプリ動作確認（挙動不変）**

ステージングで管理画面・子分ダッシュボードを開き、案件/取引先/請求/支払/カレンダーが**従来通り表示される**ことを確認（service_role動作のままなので変化しないはず）。dev環境では `ALLOW_DEV_AUTH_BYPASS=true` で `DEV_TENANT_ID`(=UUID) が backfill 値と一致して表示されること。

---

## 完了条件（F0 Done）

- [ ] 全テナント対象16テーブルの `tenant_id` が `uuid NOT NULL` ＋ companies FK ＋ index。
- [ ] 全行が `<TENANT_A_UUID>`、NULL残存ゼロ。
- [ ] 全 auth ユーザーの `app_metadata.tenant_id` が設定済み。
- [ ] `getCurrentTenantId()` が app_metadata を一次ソースに読む。`DEV_TENANT_ID` がUUID。
- [ ] `tsc --noEmit` がEXIT 0。アプリ挙動は従来通り（RLS未導入のため）。
- [ ] `company_id` は未削除（F3で撤去予定）。

## 次フェーズ

F1（RLSポリシー＋自動付与トリガー設置・まだ効かせない）の計画は、F0適用・検証完了後に別ドキュメントで作成する。
