-- 全テナント対象17テーブルへ NOT NULL / FK / index を付与し、テナント境界をDB制約で固める。
-- FK先は tenants(id)。これ以降、存在しないテナントIDでの書き込みはDBが拒否する。
-- client_departments は 2026-07-30 新設（部署分割対応）のため計画書v2の16テーブルに加えて含める。
BEGIN;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    -- A群（前のマイグレーションで uuid へ変換した11テーブル）
    'clients','contractors','projects','work_records',
    'expense_records','schedules','driver_project_assignments',
    'project_payees','invoices','payment_notices','client_departments',
    -- B群（uuid 列を追加した6テーブル）
    'approval_history','billing_records','notification_logs',
    'payments','price_rules','scan_jobs'
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
