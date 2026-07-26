-- driver_project_assignments.tenant_id の型を uuid → text に統一する。
--
-- 背景:
--   他の全テーブルの tenant_id は text（本番の値は 'local-dev'）だが、
--   このテーブルだけ uuid 型だった。
--   admin/users/actions.ts の updateDriverAssignments が getCurrentTenantId() の
--   戻り値（text）をこの列に INSERT するため、
--     invalid input syntax for type uuid: "local-dev"
--   で必ず失敗していた。ドライバー別案件フィルターの保存が本番で一度も
--   成功していなかった（適用時点でテーブルは0件）。
--
-- 安全性: 適用時点でレコード0件のため、データ変換は発生しない。

ALTER TABLE public.driver_project_assignments
  ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
