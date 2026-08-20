-- 監査(2026-08-21)で検出した緩すぎるRLSポリシー3件を、既存の本人分離パターン
-- (work_records_contractor_select と同型: contractor_id = internal.my_contractor_id())へ是正する。
-- これらのテーブルへの正規アプリ経路は service_role(RLSバイパス)のため、本修正で
-- アプリ動作は変わらない。修正対象は「anon/authenticated による直叩き」への防御。
-- 全操作は IF EXISTS/DROP→CREATE で冪等。緩い版のある本番へ流しても同じ結果になる。
BEGIN;

-- 1) schedules: q=true/w=true(全ログインユーザーが全予定を読み書き・削除可)を是正
DROP POLICY IF EXISTS schedules_authenticated_all ON public.schedules;
DROP POLICY IF EXISTS schedules_owner_all ON public.schedules;
CREATE POLICY schedules_owner_all ON public.schedules FOR ALL TO authenticated
  USING (internal.is_owner()) WITH CHECK (internal.is_owner());
DROP POLICY IF EXISTS schedules_contractor_select ON public.schedules;
CREATE POLICY schedules_contractor_select ON public.schedules FOR SELECT TO authenticated
  USING ((NOT internal.is_owner()) AND (contractor_id = internal.my_contractor_id()));

-- 2) notification_logs(不変ログ): q=true(全通知を閲覧可)/w=true(誰でも偽ログを注入可)を是正。
--    INSERTは service_role のみに限定(authenticated向けINSERTポリシーを置かない)。
DROP POLICY IF EXISTS notification_logs_authenticated_select ON public.notification_logs;
DROP POLICY IF EXISTS notification_logs_authenticated_insert ON public.notification_logs;
DROP POLICY IF EXISTS notification_logs_owner_select ON public.notification_logs;
CREATE POLICY notification_logs_owner_select ON public.notification_logs FOR SELECT TO authenticated
  USING (internal.is_owner());
DROP POLICY IF EXISTS notification_logs_contractor_select ON public.notification_logs;
CREATE POLICY notification_logs_contractor_select ON public.notification_logs FOR SELECT TO authenticated
  USING ((NOT internal.is_owner()) AND (contractor_id = internal.my_contractor_id()));

-- 3) project_payees: q=(NOT is_owner())で全ドライバーが全案件の支払先・単価構造を閲覧可を是正
DROP POLICY IF EXISTS project_payees_contractor_select ON public.project_payees;
CREATE POLICY project_payees_contractor_select ON public.project_payees FOR SELECT TO authenticated
  USING ((NOT internal.is_owner()) AND (contractor_id = internal.my_contractor_id()));

COMMIT;
