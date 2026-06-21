-- 1. 関数のサーチパス変更および実行権限の適正化
--    public.is_owner() / my_contractor_id() は後続の 20260617000001 で internal へ移動済みの場合は
--    DO ブロックでスキップする（冪等性の担保）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'is_owner') THEN
    ALTER FUNCTION public.is_owner() SET search_path = public, pg_temp;
    REVOKE EXECUTE ON FUNCTION public.is_owner() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'my_contractor_id') THEN
    ALTER FUNCTION public.my_contractor_id() SET search_path = public, pg_temp;
    REVOKE EXECUTE ON FUNCTION public.my_contractor_id() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.my_contractor_id() TO authenticated, service_role;
  END IF;
END;
$$;

ALTER FUNCTION public.update_schedules_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_approval_history_modification() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;

-- 2. schedules テーブルの RLS ポリシー（後続 20260617000001 で正規ポリシーに上書きされる）
DROP POLICY IF EXISTS "Allow all"                    ON public.schedules;
DROP POLICY IF EXISTS "schedules_policy"             ON public.schedules;
DROP POLICY IF EXISTS "schedules_server_actions_policy" ON public.schedules;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

-- 3. notification_logs テーブルの RLS ポリシー（後続 20260617000001 で正規ポリシーに上書きされる）
DROP POLICY IF EXISTS "Allow all"                          ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_policy"           ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_insert_select_policy" ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_insert_policy"    ON public.notification_logs;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
