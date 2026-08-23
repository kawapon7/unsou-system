# RLS テナント基準化 — 棚卸し結果と方針案

作成: 2026-08-23（Mac mini / Fable 5）。変更なし・読むだけの調査。
目的: おおば運送の 10/1 本番運用までに「他テナントのデータが混ざらない」構造にする。
関連: `docs/superpowers/plans/2026-08-23-client-format-documents-handover.md`（必須3項目の①）

## 結論（先に）

1. **DB の RLS をテナント基準にするだけでは守れない。** アプリは 100% service_role（RLS 素通り）で DB にアクセスしており、RLS を通る経路がアプリ内に一つも無い。RLS は「直叩きされた場合の防御網」であり、本命は**アプリ側のテナント絞りを構造的に強制すること**
2. **今すぐ直すべき実害バグがある。** `admin/dashboard/actions.ts` の全 9 クエリがテナント絞りゼロ（おおば運送を入れた瞬間に両社の売上・支払が合算される）。ほか 6 箇所に無絞りの UPDATE/SELECT
3. **おおば運送のアカウントを作ると `getCurrentTenantId()` が throw する。** tenant は JWT の `app_metadata.tenant_id` から取るが、これを**書き込むコードが存在しない**（本番の admin@hibiki.com は手動設定と推定）。テナント作成フロー自体も無い。これは様式②より前に必要
4. 見積もり: **合計 13〜18 時間**（2〜3 時間 × 6〜7 セッション）。うちボスがパソコンの前にいる必要があるのは SQL 適用と画面確認で 1〜2 時間

## 1. テーブルと tenant_id

- `20260805113940_tenant_id_constraints.sql` で 17 テーブルに `tenant_id uuid NOT NULL` + FK + index 済み。`price_rules` にもある（コード中の「price_rules には tenant_id が無い」コメント 4 箇所は**古い**: `billing-actions.ts:156`, `driver-actions.ts:343`, `pdf-actions.ts:99,262`）
- **`public.users` に tenant_id 列が無い**（owner は contractor_id も NULL なので tenant を辿れない）← RLS の起点が作れない最大の穴
- `companies.tenant_id` は nullable（UNIQUE で 1 テナント 1 社）
- 生成型 `web/src/types/supabase.ts` が古い: approval_history / billing_records / notification_logs / payments / price_rules / scan_jobs に tenant_id が無く、`tenants` / `notification_reads` テーブル自体が欠落 → 型の再生成が必要

## 2. 現行 RLS

- 全 public テーブルで RLS 有効。**どのポリシーにも tenant_id 条件は無い**（grep で出現ゼロ）
- パターン: `*_owner_all = FOR ALL USING (internal.is_owner())`、`*_contractor_select = NOT is_owner() AND contractor_id = my_contractor_id()`。clients / projects / price_rules はドライバーが `NOT is_owner()` だけで**全社横断閲覧可**
- authenticated 向けポリシー 0 件（service_role 専用）: tenants, notification_reads, client_departments, document_sequences, driver_project_assignments, companies
- helper: `internal.is_owner()`, `internal.my_contractor_id()`（`20260617000001`、SECURITY DEFINER、authenticated + service_role に EXECUTE）。`my_contractor_id()` は `users.email = contractors.email` JOIN の `LIMIT 1` → **テナント跨ぎで同じ email があると他テナントの contractor に解決され得る**
- GRANT: authenticated に全テーブル SELECT/INSERT/UPDATE/DELETE（RLS だけが防壁）、anon 無し

## 3. service_role 利用箇所（31 ファイル）— テナント絞りが無い/不十分なもの

| 優先 | ファイル:行（web/src/） | 内容 | 対処 |
|---|---|---|---|
| **高** | `app/admin/dashboard/actions.ts:122,126,132,136,182,221,261,282,286` | invoices / payment_notices 集計・トレンド全 9 クエリが無絞り | `.eq('tenant_id', tenantId)` を全部に追加 |
| **高** | `app/_actions/scan-voice-bridge.ts:62,77,101,118` | 任意テーブルの metadata を `.eq('id')` だけで UPDATE。owner 判定も無し | tenant 条件 + requireOwner |
| **高** | `app/_actions/approvalActions.ts:119,154` | payment_notices UPDATE が `.eq('id')` のみ（直前 SELECT で検証はあるが TOCTOU） | UPDATE に tenant 条件 |
| **高** | `app/_actions/approvalActions.ts:227` | approval_history 最新 100 件が全社横断 | tenant 条件 |
| **高** | `app/_actions/defensiveAlertActions.ts:250` | `.from(table).update().eq('id')` のみ | tenant 条件 |
| 中 | `app/_actions/defensiveAlertQueries.ts:70` | notification_logs を alert_key だけで検索（衝突で他社の送信済み判定を拾う） | tenant 条件 |
| 中 | `app/_actions/pdf-actions.ts:249` | projects 全件取得 | tenant 条件 |
| 中 | `app/admin/projects/actions.ts:198`, `app/admin/users/actions.ts:32,43,102,143,161,190,324`, `app/_actions/scheduleActions.ts:29,337,480`, `app/_actions/workRecordActions.ts:26,34,312,365,437,462`, `app/api/scan/upload/route.ts:209`, `app/admin/settings/company/actions.ts:173` | 要確認（一部無絞り、users は列が無く構造的に絞れない） | 個別確認 |
| 低 | price_rules の `.in('project_id')`（billing-actions:159, sales/actions:202,359, pdf-actions:103,270, driver-actions:345） | 親テーブル経由で実質分離 | tenant_id 列があるので直接絞りに変更 |
| 許容 | `utils/tenant.ts:43 getAllTenantIds()`（cron）、`document-actions.ts:102 rpc`（tenant 明示） | 意図的横断 / 明示 | そのまま |

## 4. 認証とテナントの紐づけ

- `getCurrentTenantId()`（`utils/tenant.ts:15-30`）: `auth.getUser()` → `app_metadata.tenant_id ?? user_metadata.tenant_id`、無ければ throw。**users テーブルは引かない**
- `app_metadata.tenant_id` を**書く箇所がゼロ**（`app/admin/users/actions.ts:95,135` の `auth.admin.createUser` は email/password のみ）。JWT custom claims / auth hook も無し
- `public.users.id = auth.users.id`（アプリが明示挿入。FK 無し）。`role` CHECK は `('master','sub')` だが `is_owner()` は `('master','owner')` を見る（不整合だが実害なし）
- dev バイパス（`ALLOW_DEV_AUTH_BYPASS=true`）: `auth.uid()` が NULL → RLS 下では `is_owner()` が false。service_role 継続なら無関係

## 5. テスト

- 2 テナント分離を検証するテストは無い。e2e / pgTAP 無し
- 既存の番人テスト（`use-server-exports.test.ts`, `phantom-columns.test.ts`）と同じ「静的にソースを走査する」方式が有効

## 6. 方針案（二段構え）

全面的に authenticated クライアントへ移行して RLS に委ねる案は、31 ファイル・数百クエリの書き換え＋dev バイパス非互換＋owner/driver ポリシー再設計が必要で、**10/1 には間に合わない**。採らない。

| 段階 | 内容 | 時間 |
|---|---|---|
| **P0 テナント紐づけの整備**（様式②より先） | `users.tenant_id` 列追加＋既存行 backfill。ユーザー作成時に `auth.admin.createUser({ app_metadata: { tenant_id } })` を書く。`getCurrentTenantId()` は app_metadata → users.tenant_id の順で解決。テナント作成（tenants insert + 初代 master）の Server Action | 2〜3h |
| **P1 実害バグの修正** | §3 の高・中を全部直す。price_rules を直接絞りに変更。型 `supabase.ts` 再生成 | 4〜6h |
| **P2 構造的な強制（本命）** | (a) `tenantScoped(service, tenantId)` ラッパを作り、`.from(table)` に自動で `.eq('tenant_id')` を付ける（tenant_id を持つテーブルのみ）。(b) 番人テスト: service_role で `.from('x')` しているクエリに `tenant_id` 条件が無ければ失敗（許可リスト: getAllTenantIds, tenants, users, rpc）。以後の書き漏れを CI で止める | 3〜4h |
| **P3 DB 側の防御網** | `internal.current_tenant_id()`（users.tenant_id から）を作り、authenticated 向け全ポリシーに `tenant_id = internal.current_tenant_id()` を追加。`my_contractor_id()` を tenant 内に限定。clients / projects / price_rules のドライバー横断閲覧を閉じる。service_role には効かないが、直叩き・将来の authenticated 移行に備える | 2〜3h |
| **P4 分離テスト** | 2 テナントのダミーデータ（A 社・B 社）を作り、主要 Server Action を A でログインして B のデータが取れない／更新できないことを確認するテスト。dashboard・approval・document の各経路 | 2h |

**順序: P0 → P1 → P2 → P4 → P3。** P3 は最後でよい（service_role には効かないため、本番の安全性は P1/P2 で決まる）。

## 7. ボスがパソコンの前で行うこと

- P0 のマイグレーション適用（users.tenant_id）と、本番 admin@hibiki.com の `app_metadata.tenant_id` が設定されているかの確認（Supabase ダッシュボード > Authentication > Users）
- P3 のマイグレーション適用（ポリシー差し替え、1 回）
- 各段階後の画面一巡（ダッシュボード・承認・発行控え）
