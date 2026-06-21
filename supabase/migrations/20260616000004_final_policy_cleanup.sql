-- 20260616_fix_security_advisors.sql が再作成した Always True ポリシーを削除
DROP POLICY IF EXISTS "schedules_server_actions_policy" ON public.schedules;

-- 20260614_defensive_features.sql によって削除された contractor ポリシーを復元
-- （20260615_schedules_rls_strict.sql の正規定義に合わせる）
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
