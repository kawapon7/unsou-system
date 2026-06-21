-- Always True ポリシーをすべて削除
DROP POLICY IF EXISTS "schedules_authenticated_all"          ON public.schedules;
DROP POLICY IF EXISTS "schedules_server_actions_policy"      ON public.schedules;
DROP POLICY IF EXISTS "notification_logs_authenticated_select" ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_authenticated_insert" ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_insert_select_policy" ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_insert_policy"      ON public.notification_logs;

-- notification_logs: 適切なポリシーを再設定
-- 管理者のみ SELECT 可能（子分はアクセス全面禁止）
DROP POLICY IF EXISTS "notification_logs_owner_select" ON public.notification_logs;
CREATE POLICY "notification_logs_owner_select" ON public.notification_logs
    FOR SELECT
    TO authenticated
    USING (is_owner());

-- INSERT は service_role が RLS をバイパスするため不要だが、
-- authenticated（Server Actions / is_owner()）からも挿入を許容
DROP POLICY IF EXISTS "notification_logs_owner_insert" ON public.notification_logs;
CREATE POLICY "notification_logs_owner_insert" ON public.notification_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (is_owner());

-- UPDATE / DELETE ポリシーは作成しない → 全ロールで完全遮断

-- is_owner() / my_contractor_id() の実行権限を確実に再設定
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.my_contractor_id() FROM PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_contractor_id() TO authenticated, service_role;
