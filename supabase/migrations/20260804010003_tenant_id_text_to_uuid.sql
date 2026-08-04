-- A群11テーブル: DEFAULT撤去 → 'local-dev' を A社UUID へ書換え → 型を uuid へ変換。
-- driver_project_assignments は 20260726000000 で uuid→text にした経緯があるが、
-- ここで改めて他テーブルと揃えて uuid にする。
-- project_payees / invoices / payment_notices は 20260727123545（本番障害の修正）で
-- text 列を追加したテーブル。同じA群として一括変換する。
-- client_departments は計画書作成後の 2026-07-30（部署分割対応）に新設されたテーブルで、
-- 同じ text DEFAULT 'local-dev' 型のためA群へ追加した（計画書v2の16テーブルには未記載）。
BEGIN;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'clients','contractors','projects','work_records',
    'expense_records','schedules','driver_project_assignments',
    'project_payees','invoices','payment_notices',
    'client_departments'
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
