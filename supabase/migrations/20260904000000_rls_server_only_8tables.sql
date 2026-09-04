-- ================================================================
-- RLS 有効・ポリシー 0 本だった 8 テーブルを「サーバー専用（service_role のみ）」として明示する。
--
-- 背景（2026-09-04 調査・docs/hibiki-rls-handoff.md）:
--   advisor の INFO "RLS Enabled No Policy" が 8 件。ポリシー 0 本 = anon/authenticated は全拒否
--   （fail-closed）なので漏洩リスクではないが、「意図なのか漏れなのか」が読み取れなかった。
--   web/src 全域を確認した結果、8 テーブルへのアクセスは全て createServiceClient()（service_role・
--   RLS バイパス）経由で、anon キーのクライアント（createClient / createBrowserClient）からの
--   直接クエリは 0 件。よって「サーバー専用」が正しい設計であり、ポリシー追加は不要。
--
-- 本マイグレーションがやること（アプリ動作は一切変わらない）:
--   ① service_role 向けの明示ポリシーを 1 本置く（20260607 の contractors_rls_server_only と同型）。
--      service_role は元々 RLS をバイパスするので機能上は無意味だが、advisor の INFO を消し、
--      「意図してサーバー専用にした」ことを DB 側にも残すための宣言。
--   ② anon / authenticated への GRANT を全て REVOKE（多層防御。RLS と GRANT は AND 条件なので
--      将来ポリシーを誤って足しても anon キーからは到達できない）。error_logs は既に GRANT なし。
--   ③ COMMENT ON TABLE で意図を残す。
--
-- internal.is_owner() / internal.my_contractor_id() は SECURITY DEFINER のため、
-- authenticated から contractors の SELECT を剥がしても既存ポリシー（schedules 等）は壊れない。
--
-- 全操作は冪等（IF EXISTS / DROP→CREATE / REVOKE は無権限でもエラーにならない）。
-- ================================================================
BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants',
    'contractors',
    'client_departments',
    'document_sequences',
    'driver_project_assignments',
    'expense_records',
    'notification_reads',
    'error_logs'
  ]
  LOOP
    -- RLS 有効化（既に有効でも冪等）
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- ① service_role 専用の明示ポリシー
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_server_only', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_server_only', t
    );

    -- ② anon / authenticated の権限を全て剥がす
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);

    -- ③ 意図をテーブルコメントに残す
    EXECUTE format(
      'COMMENT ON TABLE public.%I IS %L',
      t,
      'server-only: アプリからは service_role（Server Actions）経由のみ。anon/authenticated 向けポリシーは意図的に置かない（2026-09-04 rls_server_only_8tables）'
    );
  END LOOP;
END $$;

COMMIT;

-- ===== 適用後の確認（結果が 8 行・policies=1・grants=NULL なら OK）=====
-- select c.relname, c.relrowsecurity as rls,
--   (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies,
--   (select string_agg(grantee||':'||privilege_type, ',') from information_schema.role_table_grants g
--     where g.table_schema='public' and g.table_name=c.relname and grantee in ('anon','authenticated')) as grants
-- from pg_class c join pg_namespace n on n.oid=c.relnamespace
-- where n.nspname='public' and c.relname in ('tenants','contractors','client_departments','document_sequences',
--   'driver_project_assignments','expense_records','notification_reads','error_logs') order by 1;

-- ===== ROLLBACK（緊急時のみ手動実行。GRANT を戻すだけ。ポリシーは無害なので残してよい）=====
-- BEGIN;
-- GRANT ALL ON TABLE public.tenants, public.contractors, public.client_departments, public.document_sequences,
--   public.driver_project_assignments, public.expense_records, public.notification_reads TO anon, authenticated;
-- COMMIT;
