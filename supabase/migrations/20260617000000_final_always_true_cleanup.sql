-- 20260614_defensive_features.sql と 20260616_fix_security_advisors.sql が
-- 残したすべての Always True ポリシーを最終的に削除する

-- schedules の Always True ポリシー削除
DROP POLICY IF EXISTS "schedules_authenticated_all"     ON public.schedules;
DROP POLICY IF EXISTS "schedules_server_actions_policy" ON public.schedules;

-- notification_logs の Always True ポリシー削除
DROP POLICY IF EXISTS "notification_logs_authenticated_select" ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_authenticated_insert" ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_insert_select_policy" ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_insert_policy"        ON public.notification_logs;

-- schedules_contractor_* が削除されている場合は再作成
-- (20260614_defensive_features.sql が DROP した場合の復元)
DROP POLICY IF EXISTS "schedules_contractor_select" ON public.schedules;
DROP POLICY IF EXISTS "schedules_contractor_insert" ON public.schedules;

CREATE POLICY "schedules_contractor_select" ON public.schedules
    FOR SELECT
    TO authenticated
    USING (
        (NOT is_owner())
        AND contractor_id = my_contractor_id()
    );

CREATE POLICY "schedules_contractor_insert" ON public.schedules
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (NOT is_owner())
        AND contractor_id = my_contractor_id()
    );

-- notification_logs: 管理者のみ SELECT/INSERT（子分は全面禁止）
DROP POLICY IF EXISTS "notification_logs_owner_select" ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_owner_insert" ON public.notification_logs;

CREATE POLICY "notification_logs_owner_select" ON public.notification_logs
    FOR SELECT
    TO authenticated
    USING (is_owner());

CREATE POLICY "notification_logs_owner_insert" ON public.notification_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (is_owner());
