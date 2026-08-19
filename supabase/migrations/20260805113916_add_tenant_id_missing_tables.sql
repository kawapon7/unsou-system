-- tenant_id 未保持の6テーブルへ列を追加する。
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
  -- project_payees / invoices / payment_notices / client_departments は
  -- text 列を追加済みのため、ここではなく次のマイグレーション（A群）で uuid へ変換する。
  tables text[] := ARRAY[
    'approval_history','billing_records','notification_logs',
    'payments','price_rules','scan_jobs'
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
