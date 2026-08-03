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
--   utils/invoice-writer.ts の SELECT→UPDATE/INSERT へ移行済みであること（2026-08-03 本番デプロイ済み）。
--   移行前にこの制約を削除すると、billing-actions.ts の
--   onConflict: 'client_id,invoice_month' upsert が 42P10 で必ず失敗する。
--
-- ⚠️ 適用手順（2026-08-03 時点）: MCP 経由の DDL がハーネスにブロックされるため、
--   Supabase ダッシュボードの SQL Editor でボスが実行する。実行後に
--   supabase_migrations.schema_migrations へ本バージョンを記録し、1:1 一致を維持すること。

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_client_id_invoice_month_key;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_uniq_with_dept
  ON public.invoices (client_id, department_id, invoice_month)
  WHERE department_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_uniq_no_dept
  ON public.invoices (client_id, invoice_month)
  WHERE department_id IS NULL;
