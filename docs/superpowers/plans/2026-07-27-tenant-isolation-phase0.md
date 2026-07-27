# テナント分離 フェーズ0（下ごしらえ）実装計画 v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **この文書は `2026-06-27-tenant-isolation-phase0.md` を置き換える（supersedes）。** 旧版は「`companies` をテナントマスタ兼用にする」前提だったが、2026-07-26の自社マスタ実装（`companies` は請求書発行元情報の表として `tenant_id text UNIQUE` を持つ）と衝突するため全面改訂した。旧版は履歴として残すが**参照しないこと**。

**Goal:** テナントの正体を持つ `tenants` テーブルを新設し、全テナント対象テーブルの `tenant_id` を `uuid NOT NULL` → `tenants(id)` FK に統一。既存データをA社テナントへ寄せ、テナントIDを `app_metadata` 管理へ移行する。

**Architecture:** `tenants`（契約台帳・テナントの正体）を親に置き、`companies`（自社＝請求書発行元情報）を含む全テーブルがその `id` を `tenant_id` として参照する。`companies.tenant_id` の UNIQUE 制約は維持し「1テナント＝1社」をDB制約で保証し続ける。**F0時点ではアプリは引き続き service_role で動くため、RLSは入らず画面の挙動は変わらない。**

**Tech Stack:** Supabase (Postgres 17) マイグレーション / Next.js Server Actions / `@supabase/supabase-js` の `auth.admin`。

---

## Global Constraints

- **DB適用（SQL実行 / db push）は人間が行う。** 実装担当はファイル作成と読み取り専用クエリの提示までに留める。
- マイグレーションは `BEGIN; ... COMMIT;` で囲む。命名は `supabase/migrations/YYYYMMDDHHMMSS_説明.sql`。既存最新は `20260726000001` なので、それより後のタイムスタンプにする。
- **`approval_history` / `notification_logs` に `UPDATE` / `DELETE` を書かない**（CLAUDE.md §2 の不変ログ規約）。本計画は `ADD COLUMN ... DEFAULT` で既存行を埋めるため、これらへのUPDATEは一切発生しない。既存の不変トリガーには触れない。
- **口座情報の列（`bank_name` / `bank_branch` / `account_number` / `account_holder`）には触れない。** 本計画が変更するのは `tenant_id` 列のみ。
- 自動生成物（`.next/` `.open-next/`）・`.env*` をコミットに巻き込まない。`git add` は対象ファイルを明示する。
- `company_id`（`work_records` / `expense_records` の旧概念）はF0では**削除しない**（F3で撤去）。F0は追加・変換のみ。
- `web/AGENTS.md` の指示により、このリポジトリの Next.js は改変版である。`web/` 配下で Next.js API に触れる変更を書く前に `node_modules/next/dist/docs/` の該当ガイドを読むこと。**本計画のアプリ側変更（Task 6〜9）は Next.js API を使わないため対象外だが、逸脱する場合は必ず参照すること。**

### 確定値

| 名前 | 値 |
|---|---|
| `<TENANT_A_UUID>` | `00000000-0000-0000-0000-0000000000a1` |

**以降、全SQL・全コードの `<TENANT_A_UUID>` はこの値に置換すること。**

### テナント対象テーブル（実測 2026-07-27）

**A群 — 既に `tenant_id text` を持つ（値は全て `'local-dev'`）。uuid へ変換する（7テーブル）:**
`clients`(6行) / `contractors`(16) / `projects`(20) / `work_records`(125) / `expense_records`(19) / `schedules`(140) / `driver_project_assignments`(3)

> ⚠️ 旧計画は `driver_project_assignments` を「uuid型・変換不要」と記載していたが**誤り**。2026-07-26のバグ修正（`20260726000000_fix_driver_project_assignments_tenant_id_type.sql`）で text に統一済みのため、A群に含める。

**B群 — `tenant_id` を持たないため追加する（9テーブル）:**
`approval_history`(0行) / `billing_records`(0) / `invoices`(0) / `notification_logs`(8) / `payment_notices`(10) / `payments`(0) / `price_rules`(20) / `project_payees`(12) / `scan_jobs`(1)

**C群 — 個別対応:**
`companies`(0行) … `tenant_id text UNIQUE` を既に持つ。uuid へ変換し FK を張る（Task 2）。

**対象外:**
`users` … テナントは `app_metadata` で保持する。DB列は持たせない。
`tenants` … テナントマスタ自身。

---

## ⚠️ 適用順序とダウンタイム（人間向け・着手前に必読）

DBの `tenant_id` が uuid になった瞬間から、**アプリが `'local-dev'` を送ると全書き込みが `invalid input syntax for type uuid` で失敗する**（2026-07-26に `driver_project_assignments` で実際に起きた事故と同型）。DB側とアプリ側は**連続して適用する必要がある**。

**前提条件（F0着手前に解消すること）:**
- 自動デプロイが `CLOUDFLARE_API_TOKEN` 未再発行で停止中。**アプリ側変更（Task 6〜9）をデプロイできない状態ではF0のDB適用を始めてはいけない。** 先にデプロイ経路を復旧させること。

**推奨適用手順（A社1社・フィールドテスト中のため、数分のダウンタイムを許容する）:**
1. 利用者のいない時間帯を選ぶ
2. Supabaseダッシュボードでバックアップを取得
3. Task 1〜5 のマイグレーションを順に適用
4. Task 9 のスクリプトを実行（全ユーザーの `app_metadata.tenant_id` をUUIDに設定）
5. アプリをデプロイ（Task 6〜8 の変更を反映）
6. **全ユーザーが再ログイン**（JWTに新しい `app_metadata` を載せるため）
7. Task 10 の検証を実施

> 手順3〜5の間は書き込みが失敗する。この窓を短くするため、3〜5は続けて実施すること。

---

## Task 1: `tenants` テーブル新設 ＋ A社行の投入

**Files:**
- Create: `supabase/migrations/20260727000000_create_tenants.sql`

**Interfaces:**
- Produces: `tenants` テーブルと `id = <TENANT_A_UUID>` の行。以降の全 `tenant_id` FK の参照先。

- [ ] **Step 1: マイグレーション作成**

```sql
-- テナント（契約している会社アカウント）の正体を持つマスタ。
-- 全テナント対象テーブルの tenant_id はこの id を参照する。
--
-- 設計判断（2026-07-27）:
--   companies は「自社＝請求書の発行元情報」の表であり、テナントそのものではない。
--   companies をテナントマスタ兼用にすると
--     1) 契約はしたが自社情報未登録のテナントを表現できない
--     2) 契約プラン・停止フラグなどテナント単位の情報の置き場が無い
--   ため、テナントの正体は独立した表に持たせる。
--   「1テナント＝1社」は companies.tenant_id の UNIQUE 制約で引き続き保証する。
BEGIN;

CREATE TABLE IF NOT EXISTS public.tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- アプリは service_role で動くため RLS は素通りするが、
-- anon/authenticated からの直接アクセスを塞ぐため有効化しておく（F1でポリシーを本格化）。
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- A社（既存の単一テナント）。id は固定値で発番する。
INSERT INTO public.tenants (id, name)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'A社')
ON CONFLICT (id) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: 適用（人間）**

Supabase SQL Editor で上記を実行。

- [ ] **Step 3: 投入確認（人間）**

```sql
SELECT id, name FROM tenants;
```
Expected: 1行。`id = 00000000-0000-0000-0000-0000000000a1`、`name = 'A社'`。

- [ ] **Step 4: コミット**

```bash
git status   # .next/ .open-next/ が居ないこと
git add supabase/migrations/20260727000000_create_tenants.sql
git commit -m "feat(tenant): F0 tenants テーブルを新設しA社行を投入"
```

---

## Task 2: `companies.tenant_id` を uuid へ変換し FK を張る

**Files:**
- Create: `supabase/migrations/20260727000001_companies_tenant_id_to_uuid.sql`

**Interfaces:**
- Consumes: `tenants` テーブルとA社行（Task 1）。
- Produces: `companies.tenant_id` が `uuid` ＋ `tenants(id)` FK ＋ UNIQUE 維持。

> `companies` は現在0行のため、型変換によるデータ変換は発生しない。
> UNIQUE制約 `companies_tenant_id_unique` は「1テナント1社」を保証するため**維持する**。
> `companies.id`（自動採番PK）には触れない。`admin/settings/company/actions.ts` が
> `.eq('id', existing.id)` で使っているため、変更すると保存処理が壊れる。

- [ ] **Step 1: マイグレーション作成**

```sql
-- companies.tenant_id を text → uuid へ変換し、tenants(id) を参照させる。
--
-- 背景: companies は 2026-07-26 の自社マスタ実装で tenant_id text UNIQUE を得たが、
--       テナント統一(uuid)より前に作られたため型が揃っていない。
-- 安全性: 適用時点で companies は0件のため、データ変換は発生しない。
BEGIN;

ALTER TABLE public.companies
  ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

COMMIT;
```

- [ ] **Step 2: 適用（人間）**

Supabase SQL Editor で実行。

- [ ] **Step 3: 型とUNIQUEの確認（人間）**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'companies' AND column_name = 'tenant_id';
```
Expected: `uuid`。

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.companies'::regclass
  AND conname IN ('companies_tenant_id_unique', 'companies_tenant_id_fkey');
```
Expected: 2行（UNIQUE と FK が両方存在）。

- [ ] **Step 4: コミット**

```bash
git status
git add supabase/migrations/20260727000001_companies_tenant_id_to_uuid.sql
git commit -m "feat(tenant): F0 companies.tenant_id を uuid 化し tenants を参照"
```

---

## Task 3: B群9テーブルへ `tenant_id` を追加（DEFAULT付きで既存行も同時に埋める）

**Files:**
- Create: `supabase/migrations/20260727000002_add_tenant_id_missing_tables.sql`

**Interfaces:**
- Consumes: `tenants` のA社行（Task 1）。
- Produces: B群9テーブルに `tenant_id uuid`（全行 `<TENANT_A_UUID>`、この時点では nullable・FKなし。Task 5で締める）。

> **なぜ `UPDATE` ではなく `ADD COLUMN ... DEFAULT` なのか（重要）**
> `approval_history` / `notification_logs` は不変ログであり、`UPDATE` / `DELETE` が
> 全ロールで禁止されている（CLAUDE.md §2、トリガー `trg_*_no_update` / `trg_*_no_delete`）。
> `UPDATE` で backfill するとトリガーを一時無効化する必要があり、規約に抵触する。
> PostgreSQL 11以降、`ADD COLUMN ... DEFAULT <定数>` は**既存行にもその値が入り**
> （テーブル全体の書き換えも発生しない）、**行レベルのUPDATEトリガーも発火しない**。
> これを使えば UPDATE 文を一切書かずに backfill が完了する。本番は PG 17.6 で条件を満たす。
> 値を入れ終えたら DEFAULT は落とす（新規行が暗黙に A社 になるのを防ぐため）。

- [ ] **Step 1: マイグレーション作成**

```sql
-- tenant_id 未保持の9テーブルへ列を追加する。
-- DEFAULT を付けて追加することで既存行も同時に A社UUID で埋まる（PG11+）。
-- ⚠️ approval_history / notification_logs は不変ログ（UPDATE禁止）のため、
--    UPDATE 文による backfill は行わない。この ADD COLUMN DEFAULT 方式なら
--    行トリガーが発火しないため規約に抵触しない。
-- ⚠️ 埋め終わった直後に DEFAULT を落とす。残すと新規行が暗黙にA社になり、
--    B社導入後に他テナントのデータがA社に混入する事故につながる。
BEGIN;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'approval_history','billing_records','invoices','notification_logs',
    'payment_notices','payments','price_rules','project_payees','scan_jobs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT %L',
      tbl, '00000000-0000-0000-0000-0000000000a1'
    );
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id DROP DEFAULT', tbl);
  END LOOP;
END $$;

COMMIT;
```

- [ ] **Step 2: 適用（人間）**

Supabase SQL Editor で実行。

- [ ] **Step 3: 既存行が埋まったことの確認（人間）**

```sql
SELECT 'notification_logs' t, count(*) FILTER (WHERE tenant_id IS NULL) AS nulls, count(*) AS total FROM notification_logs
UNION ALL SELECT 'payment_notices', count(*) FILTER (WHERE tenant_id IS NULL), count(*) FROM payment_notices
UNION ALL SELECT 'price_rules',     count(*) FILTER (WHERE tenant_id IS NULL), count(*) FROM price_rules
UNION ALL SELECT 'project_payees',  count(*) FILTER (WHERE tenant_id IS NULL), count(*) FROM project_payees
UNION ALL SELECT 'scan_jobs',       count(*) FILTER (WHERE tenant_id IS NULL), count(*) FROM scan_jobs
ORDER BY 1;
```
Expected: 全行 `nulls = 0`。`total` は notification_logs=8 / payment_notices=10 / price_rules=20 / project_payees=12 / scan_jobs=1。

- [ ] **Step 4: コミット**

```bash
git status
git add supabase/migrations/20260727000002_add_tenant_id_missing_tables.sql
git commit -m "feat(tenant): F0 不足9テーブルへ tenant_id を追加(既存行も充填)"
```

---

## Task 4: A群7テーブルの `tenant_id` を text → uuid へ変換

**Files:**
- Create: `supabase/migrations/20260727000003_tenant_id_text_to_uuid.sql`

**Interfaces:**
- Consumes: `tenants` のA社行（Task 1）。
- Produces: A群7テーブルの `tenant_id` が `uuid`、全行 `<TENANT_A_UUID>`。

> A群はいずれも不変ログではないため `UPDATE` で値を書き換えてよい。
> `clients` 等は `DEFAULT 'local-dev'` を持つため、型変換の前に DEFAULT を落とす必要がある
> （text の DEFAULT が付いたまま uuid へ変換しようとすると失敗する）。

- [ ] **Step 1: マイグレーション作成**

```sql
-- A群7テーブル: DEFAULT撤去 → 'local-dev' を A社UUID へ書換え → 型を uuid へ変換。
-- driver_project_assignments は 20260726000000 で uuid→text にした経緯があるが、
-- ここで改めて他テーブルと揃えて uuid にする（3行のみ）。
BEGIN;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'clients','contractors','projects','work_records',
    'expense_records','schedules','driver_project_assignments'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id DROP DEFAULT', tbl);
    EXECUTE format(
      'UPDATE public.%I SET tenant_id = %L WHERE tenant_id = ''local-dev'' OR tenant_id IS NULL',
      tbl, '00000000-0000-0000-0000-0000000000a1'
    );
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid',
      tbl
    );
  END LOOP;
END $$;

COMMIT;
```

> ⚠️ `'local-dev'` 以外の想定外の文字列が1件でも残っていると、
> `tenant_id::uuid` のキャストで `invalid input syntax for type uuid` が出て
> トランザクション全体がロールバックする。これは**安全側の失敗**（中途半端な状態にならない）。
> エラーが出たらその値を調査し、この計画の作成者に相談すること。

- [ ] **Step 2: 適用（人間）**

Supabase SQL Editor で実行。

- [ ] **Step 3: 型と値の確認（人間）**

```sql
SELECT table_name, data_type FROM information_schema.columns
WHERE column_name = 'tenant_id' AND table_schema = 'public'
ORDER BY table_name;
```
Expected: 全テーブル `uuid`（`text` が1つも残っていないこと）。

```sql
SELECT DISTINCT tenant_id FROM projects
UNION SELECT DISTINCT tenant_id FROM work_records
UNION SELECT DISTINCT tenant_id FROM driver_project_assignments;
```
Expected: 1行のみ（`00000000-0000-0000-0000-0000000000a1`）。

- [ ] **Step 4: コミット**

```bash
git status
git add supabase/migrations/20260727000003_tenant_id_text_to_uuid.sql
git commit -m "feat(tenant): F0 A群7テーブルの tenant_id を uuid へ統一"
```

---

## Task 5: `NOT NULL` ＋ FK ＋ インデックス付与

**Files:**
- Create: `supabase/migrations/20260727000004_tenant_id_constraints.sql`

**Interfaces:**
- Consumes: 全テーブルの `tenant_id` が uuid・NULLなし（Task 3・4完了後）。
- Produces: 対象16テーブルの `tenant_id` が `NOT NULL` ＋ `tenants(id)` FK ＋ index。

> `companies` は Task 2 で FK 済みのためこのリストに含めない。
> `companies.tenant_id` は NOT NULL にしない（0行の現在に NOT NULL を付けても害はないが、
> 自社情報の登録は任意タイミングであり、行が無い＝未登録という現在の設計を変えないため）。

- [ ] **Step 1: マイグレーション作成**

```sql
-- 全テナント対象16テーブルへ NOT NULL / FK / index を付与し、テナント境界をDB制約で固める。
-- FK先は tenants(id)。これ以降、存在しないテナントIDでの書き込みはDBが拒否する。
BEGIN;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    -- A群
    'clients','contractors','projects','work_records',
    'expense_records','schedules','driver_project_assignments',
    -- B群
    'approval_history','billing_records','invoices','notification_logs',
    'payment_notices','payments','price_rules','project_payees','scan_jobs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', tbl);

    -- 再実行できるよう、既存FKを落としてから張り直す
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', tbl, tbl || '_tenant_id_fkey');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)',
      tbl, tbl || '_tenant_id_fkey'
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)',
      'idx_' || tbl || '_tenant_id', tbl
    );
  END LOOP;
END $$;

COMMIT;
```

- [ ] **Step 2: 適用（人間）**

Supabase SQL Editor で実行。

- [ ] **Step 3: 制約が16テーブル分揃ったことの確認（人間）**

```sql
SELECT count(*) AS fk_count FROM pg_constraint
WHERE contype = 'f' AND conname LIKE '%_tenant_id_fkey';
```
Expected: 17（16テーブル ＋ `companies`）。

- [ ] **Step 4: コミット**

```bash
git status
git add supabase/migrations/20260727000004_tenant_id_constraints.sql
git commit -m "feat(tenant): F0 tenant_id に NOT NULL/FK(tenants)/index を付与"
```

---

## Task 6: `DEV_TENANT_ID` を UUID へ更新

**Files:**
- Modify: `web/src/utils/tenant.ts:4`

**Interfaces:**
- Produces: `DEV_TENANT_ID` が `<TENANT_A_UUID>`。uuid 型の `tenant_id` 列と整合する。

- [ ] **Step 1: 定数を変更**

`web/src/utils/tenant.ts` の現在の4行目:
```ts
export const DEV_TENANT_ID = 'local-dev'
```
を次へ変更:
```ts
// F0でtenant_idをUUID統一したため、dev/bypass時もUUIDを返す（A社=既存の単一テナント）。
// ⚠️ この値は tenants テーブルに実在する id でなければならない。
//    存在しない値にすると全書き込みがFK違反で失敗する。
export const DEV_TENANT_ID = '00000000-0000-0000-0000-0000000000a1'
```

- [ ] **Step 2: docstring の記述を実態に合わせる**

同ファイルの `getCurrentTenantId` 上の docstring、現在:
```ts
 * - ALLOW_DEV_AUTH_BYPASS=true のときのみ 'local-dev' を返す（dev専用フラグ）。
```
を次へ変更:
```ts
 * - ALLOW_DEV_AUTH_BYPASS=true のときのみ DEV_TENANT_ID(A社UUID) を返す（dev専用フラグ）。
```

- [ ] **Step 3: 型チェック**

Run: `cd web && npx tsc --noEmit`
Expected: EXIT 0（出力なし）

- [ ] **Step 4: コミット**

```bash
git status
git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"   # 空であること
git add web/src/utils/tenant.ts
git commit -m "feat(tenant): F0 DEV_TENANT_ID を A社UUID へ更新"
```

---

## Task 7: `getCurrentTenantId` を `app_metadata` 読み取りへ変更

**Files:**
- Modify: `web/src/utils/tenant.ts:18`

**Interfaces:**
- Consumes: ログインユーザーJWTの `app_metadata.tenant_id`（Task 9 で設定済みであること）。
- Produces: `getCurrentTenantId()` が `app_metadata.tenant_id` を一次ソースに返す。未解決は例外（fail-closed維持）。

> **なぜ `user_metadata` から移すのか:** `user_metadata` はログイン中のユーザー自身が
> `supabase.auth.updateUser()` で書き換えられる。テナントIDがそこにあると、
> 利用者が自分のテナントIDを他社の値に書き換えて他社データを読める。
> `app_metadata` は service_role でしか書き換えられないため、この経路が塞がる。

- [ ] **Step 1: 取得元を変更**

`web/src/utils/tenant.ts` の現在の18行目:
```ts
  const tenantId = user?.user_metadata?.tenant_id
```
を次へ変更:
```ts
  // app_metadata（service_roleのみ設定可・本人改変不能）を一次ソースにする。
  // ⚠️ user_metadata へのフォールバックは移行期間中の保険。F1のRLS導入前に必ず撤去すること
  //    （残すと利用者が自分で tenant_id を書き換えられ、テナント分離が破れる）。
  const tenantId =
    (user?.app_metadata as { tenant_id?: string } | undefined)?.tenant_id
    ?? user?.user_metadata?.tenant_id
```

- [ ] **Step 2: エラーメッセージを実態に合わせる**

同関数内の現在:
```ts
  throw new Error('テナントが解決できません（user_metadata.tenant_id が未設定です）。')
```
を次へ変更:
```ts
  throw new Error('テナントが解決できません（app_metadata.tenant_id が未設定です）。')
```

- [ ] **Step 3: 型チェック**

Run: `cd web && npx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 4: コミット**

```bash
git status
git add web/src/utils/tenant.ts
git commit -m "feat(tenant): F0 getCurrentTenantId を app_metadata 読取りへ移行"
```

---

## Task 8: `getAllTenantIds` を `tenants` テーブル読み取りへ変更

**Files:**
- Modify: `web/src/utils/tenant.ts:30-38`

**Interfaces:**
- Consumes: `tenants` テーブル（Task 1）。
- Produces: `getAllTenantIds()` が `tenants.id` の一覧を返す。

> **なぜ変えるのか:** 現在の実装は `contractors` から `DISTINCT tenant_id` を集めている。
> これは「委託先が1件も登録されていないテナント」を取りこぼす。
> このメソッドは `api/cron/defensive-alerts/route.ts` が5大アラートの巡回対象を決めるのに使っており、
> 取りこぼすとそのテナントにアラートメールが一切飛ばなくなる。
> `tenants` が正本になった以上、そこから引くのが正しい。

- [ ] **Step 1: 実装を差し替える**

`web/src/utils/tenant.ts` の現在の `getAllTenantIds` 全体:
```ts
export async function getAllTenantIds(): Promise<string[]> {
  const db = createServiceClient() as any
  const { data, error } = await db.from('contractors').select('tenant_id')
  if (error) throw new Error(error.message)
  const ids: string[] = (data ?? [])
    .map((r: any) => r.tenant_id as string | null)
    .filter((id: string | null): id is string => Boolean(id))
  return [...new Set(ids)]
}
```
を次へ変更:
```ts
export async function getAllTenantIds(): Promise<string[]> {
  const db = createServiceClient() as any
  // F0以降 tenants がテナントの正本。
  // ⚠️ 旧実装は contractors の DISTINCT を取っていたため、
  //    委託先が0件のテナントを取りこぼし、そのテナントにアラートが飛ばなかった。
  const { data, error } = await db.from('tenants').select('id')
  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((r: any) => r.id as string | null)
    .filter((id: string | null): id is string => Boolean(id))
}
```

- [ ] **Step 2: 呼び出し側が壊れていないことを確認**

Run: `cd web && grep -rn "getAllTenantIds" src`
Expected: 定義（`src/utils/tenant.ts`）と呼び出し（`src/app/api/cron/defensive-alerts/route.ts:2,34`）の3行のみ。戻り値の型 `Promise<string[]>` は変わっていないため呼び出し側の変更は不要。

- [ ] **Step 3: 型チェック**

Run: `cd web && npx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 4: コミット**

```bash
git status
git add web/src/utils/tenant.ts
git commit -m "fix(tenant): F0 getAllTenantIds を tenants 正本から引くよう変更"
```

---

## Task 9: 既存ユーザーへ `app_metadata.tenant_id` を設定するスクリプト

**Files:**
- Create: `web/scripts/backfill-app-metadata-tenant.mjs`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `<TENANT_A_UUID>`。
- Produces: 全 auth ユーザーの `app_metadata.tenant_id = <TENANT_A_UUID>`。

> `auth.admin`（service_role）が必要なためDBマイグレーションではなく一度きりの実行スクリプトにする。
> 実行は人間が行う。既存のデモデータ用スクリプトと同じ `web/scripts/` に置く。
> 現在のユーザーは10名。うち3名が `user_metadata.tenant_id = 'local-dev'`、7名が未設定。
> `app_metadata.tenant_id` は全員未設定。

- [ ] **Step 1: スクリプト作成**

```js
// web/scripts/backfill-app-metadata-tenant.mjs
// 既存ユーザー全員の app_metadata.tenant_id を A社UUIDに設定する一度きりのスクリプト。
//
// 実行: node web/scripts/backfill-app-metadata-tenant.mjs
// 必要env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// ⚠️ 実行後、対象ユーザーは再ログインが必要（JWTに新しい app_metadata を載せるため）。
//    再ログインするまでは古いJWTのままなので getCurrentTenantId が
//    user_metadata フォールバック（'local-dev'）を返し、uuid化したDBと不整合になる。
import { createClient } from '@supabase/supabase-js'

const TENANT_A_UUID = '00000000-0000-0000-0000-0000000000a1'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  throw new Error('env未設定: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
}

const admin = createClient(url, key, { auth: { persistSession: false } })

let page = 1
let updated = 0
let skipped = 0

for (;;) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
  if (error) throw error

  const users = data.users
  if (users.length === 0) break

  for (const u of users) {
    if (u.app_metadata?.tenant_id === TENANT_A_UUID) {
      skipped++
      continue
    }
    // 既存の app_metadata（provider 等）を保持したまま tenant_id だけ足す。
    // ⚠️ スプレッドを外すと provider/providers が消えてログインが壊れる。
    const { error: upErr } = await admin.auth.admin.updateUserById(u.id, {
      app_metadata: { ...u.app_metadata, tenant_id: TENANT_A_UUID },
    })
    if (upErr) {
      console.error('更新失敗', u.email, upErr.message)
      continue
    }
    updated++
    console.log('更新', u.email)
  }
  page++
}

console.log(`完了: 更新 ${updated} 件 / 設定済みスキップ ${skipped} 件`)
```

- [ ] **Step 2: コミット**

```bash
git status
git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"   # 空であること
git add web/scripts/backfill-app-metadata-tenant.mjs
git commit -m "feat(tenant): F0 既存ユーザーへ app_metadata.tenant_id 設定スクリプトを追加"
```

- [ ] **Step 3: 実行（人間）**

```bash
cd /Users/kawasakiatsushi/developer/unsou-system
node web/scripts/backfill-app-metadata-tenant.mjs
```
Expected: `完了: 更新 10 件 / 設定済みスキップ 0 件`

---

## Task 10: 検証（人間が適用・デプロイ後に実施）

**Files:** なし（検証クエリ・手順の提示）

- [ ] **Step 1: NULL残存ゼロの確認**

```sql
SELECT 'clients' t, count(*) FROM clients WHERE tenant_id IS NULL
UNION ALL SELECT 'contractors',        count(*) FROM contractors        WHERE tenant_id IS NULL
UNION ALL SELECT 'projects',           count(*) FROM projects           WHERE tenant_id IS NULL
UNION ALL SELECT 'work_records',       count(*) FROM work_records       WHERE tenant_id IS NULL
UNION ALL SELECT 'expense_records',    count(*) FROM expense_records    WHERE tenant_id IS NULL
UNION ALL SELECT 'schedules',          count(*) FROM schedules          WHERE tenant_id IS NULL
UNION ALL SELECT 'driver_project_assignments', count(*) FROM driver_project_assignments WHERE tenant_id IS NULL
UNION ALL SELECT 'approval_history',   count(*) FROM approval_history   WHERE tenant_id IS NULL
UNION ALL SELECT 'billing_records',    count(*) FROM billing_records    WHERE tenant_id IS NULL
UNION ALL SELECT 'invoices',           count(*) FROM invoices           WHERE tenant_id IS NULL
UNION ALL SELECT 'notification_logs',  count(*) FROM notification_logs  WHERE tenant_id IS NULL
UNION ALL SELECT 'payment_notices',    count(*) FROM payment_notices    WHERE tenant_id IS NULL
UNION ALL SELECT 'payments',           count(*) FROM payments           WHERE tenant_id IS NULL
UNION ALL SELECT 'price_rules',        count(*) FROM price_rules        WHERE tenant_id IS NULL
UNION ALL SELECT 'project_payees',     count(*) FROM project_payees     WHERE tenant_id IS NULL
UNION ALL SELECT 'scan_jobs',          count(*) FROM scan_jobs          WHERE tenant_id IS NULL
ORDER BY 1;
```
Expected: 全16テーブルが `0`。

- [ ] **Step 2: 全テーブルが uuid 型で単一テナントであることの確認**

```sql
SELECT table_name, data_type FROM information_schema.columns
WHERE column_name = 'tenant_id' AND table_schema = 'public' AND data_type <> 'uuid';
```
Expected: 0行（text が残っていない）。

```sql
SELECT DISTINCT tenant_id FROM projects;
SELECT id, name FROM tenants;
```
Expected: 前者は `00000000-0000-0000-0000-0000000000a1` のみ。後者はA社1行。

- [ ] **Step 3: ユーザーの app_metadata 設定確認**

```sql
SELECT count(*) AS unset FROM auth.users WHERE raw_app_meta_data ->> 'tenant_id' IS NULL;
```
Expected: `0`。

- [ ] **Step 4: 不変ログのトリガーが健在であることの確認**

```sql
SELECT c.relname, tg.tgname, tg.tgenabled
FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
WHERE NOT tg.tgisinternal AND c.relname IN ('approval_history','notification_logs')
ORDER BY 1, 2;
```
Expected: 4行すべて `tgenabled = 'O'`（有効）。`trg_approval_history_no_delete` / `trg_approval_history_no_update` / `trg_notification_logs_no_delete` / `trg_notification_logs_no_update`。

- [ ] **Step 5: アプリ動作確認（挙動不変であること）**

全ユーザーが**再ログイン**した上で、本番URL（`https://unsou-system.kawapon7.workers.dev`）で以下を確認する。service_role 動作のままなので、F0では表示内容は従来と変わらないはず。

| 画面 | 確認内容 |
|---|---|
| `/admin`（業績サマリー） | 数字が従来通り表示される |
| `/admin/projects` | 案件20件が表示される |
| `/admin/contractors` | 委託先16件が表示される |
| 配車カレンダー | 予定140件が従来通り表示される |
| `/admin/users` のドライバー別案件フィルター | ✅の保存が**成功する**（uuid化後もFKで弾かれないこと） |
| `/admin/settings/company` | 自社情報の保存が成功する |
| 支払通知書PDF | 10件のうち1件を出力し、発行元情報が正しく出る |

- [ ] **Step 6: 書き込みがFKで守られていることの確認**

```sql
-- 存在しないテナントIDでの挿入が拒否されること（意図的に失敗させるテスト）
INSERT INTO clients (name, tenant_id) VALUES ('FKテスト', '00000000-0000-0000-0000-0000000000ff');
```
Expected: `insert or update on table "clients" violates foreign key constraint "clients_tenant_id_fkey"` で**失敗する**。成功してしまった場合はFKが張れていないので Task 5 を見直すこと。

---

## 完了条件（F0 Done）

- [ ] `tenants` テーブルが存在し、A社1行（`<TENANT_A_UUID>`）が入っている。
- [ ] テナント対象16テーブルの `tenant_id` が `uuid NOT NULL` ＋ `tenants(id)` FK ＋ index。
- [ ] `companies.tenant_id` が `uuid` ＋ `tenants(id)` FK ＋ UNIQUE（1テナント1社の保証を維持）。
- [ ] 全行が `<TENANT_A_UUID>`、NULL残存ゼロ、text型の `tenant_id` が1つも残っていない。
- [ ] 全 auth ユーザー（10名）の `app_metadata.tenant_id` が設定済み。
- [ ] `getCurrentTenantId()` が `app_metadata` を一次ソースに読む。`DEV_TENANT_ID` がUUID。
- [ ] `getAllTenantIds()` が `tenants` から引いている。
- [ ] 不変ログのトリガー4本がすべて有効なまま（一度も無効化していない）。
- [ ] `cd web && npx tsc --noEmit` が EXIT 0。
- [ ] アプリ挙動は従来通り（RLS未導入のため）。ドライバー別案件フィルターと自社情報の保存が成功する。
- [ ] `company_id` は未削除（F3で撤去予定）。

## 次フェーズ

F1（RLSポリシー＋`tenant_id` 自動付与トリガーの設置・まだ強制はしない）の計画は、F0適用・検証完了後に別ドキュメントで作成する。**F1着手時に Task 7 の `user_metadata` フォールバックを撤去すること**（残したままRLSを効かせると、利用者が自分の `user_metadata.tenant_id` を書き換えて他テナントに侵入できる）。
