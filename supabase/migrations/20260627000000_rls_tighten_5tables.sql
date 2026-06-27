-- RLS強化: 対象5テーブルを deny-by-default 化（USING(true) 等の緩いポリシーを全廃）。
-- 前提: アプリのDBアクセスは全て service_role 経由（RLSバイパス）。よってポリシー全削除でも機能影響なし。
-- service_role はRLSを常にバイパスするため、本マイグレーションで service 用ポリシーは不要。

BEGIN;

-- ① 対象5テーブルの既存ポリシーを全削除（名前は動的に取得）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'contractors',
        'expense_records',
        'schedules',
        'notification_logs',
        'driver_project_assignments'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ② RLSを有効化（ポリシー0件 ＝ anon/authenticated は全拒否、service_role のみバイパスで可）
ALTER TABLE public.contractors                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_records            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_project_assignments ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ===== ROLLBACK（緊急時のみ手動実行）=====
-- BEGIN;
-- CREATE POLICY "tmp_allow_all" ON public.contractors                FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "tmp_allow_all" ON public.expense_records            FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "tmp_allow_all" ON public.schedules                  FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "tmp_allow_all" ON public.notification_logs          FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "tmp_allow_all" ON public.driver_project_assignments FOR ALL USING (true) WITH CHECK (true);
-- COMMIT;
