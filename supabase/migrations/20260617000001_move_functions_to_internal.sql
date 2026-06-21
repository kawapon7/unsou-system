-- 前回の失敗で public.is_owner() / my_contractor_id() が CASCADE 削除されているため、
-- 冪等性を持たせてすべてのステップを再実行できるよう設計する

-- 1. internal スキーマを作成
CREATE SCHEMA IF NOT EXISTS internal;

-- 2. internal.is_owner() を定義（最新ロジック: role IN ('master', 'owner')）
CREATE OR REPLACE FUNCTION internal.is_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role IN ('master', 'owner')
  );
$$;

-- 3. internal.my_contractor_id() を定義
CREATE OR REPLACE FUNCTION internal.my_contractor_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id FROM public.contractors c
  JOIN public.users u ON u.email = c.email
  WHERE u.id = auth.uid()
  LIMIT 1
$$;

-- 4. internal スキーマのアクセス権設定（anon / PUBLIC には付与しない）
REVOKE ALL ON SCHEMA internal FROM PUBLIC;
GRANT USAGE ON SCHEMA internal TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal.is_owner()         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal.my_contractor_id() TO authenticated, service_role;

-- 5. public.is_owner() と public.my_contractor_id() を CASCADE 削除
--    すでに削除済みの場合は IF EXISTS で安全にスキップ
DROP FUNCTION IF EXISTS public.is_owner() CASCADE;
DROP FUNCTION IF EXISTS public.my_contractor_id() CASCADE;

-- 6. 全テーブルの RLS ポリシーを internal.* 参照で再作成
--    CASCADE または前回の失敗で中途削除されている可能性があるため
--    DROP IF EXISTS → CREATE のペアで冪等に処理する

-- clients
DROP POLICY IF EXISTS "clients_owner_all"         ON public.clients;
DROP POLICY IF EXISTS "clients_contractor_select"  ON public.clients;

CREATE POLICY "clients_owner_all" ON public.clients
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

CREATE POLICY "clients_contractor_select" ON public.clients
  FOR SELECT TO authenticated
  USING (
    NOT internal.is_owner()
    AND id IN (
      SELECT DISTINCT p.client_id FROM public.projects p
      INNER JOIN public.work_records wr ON wr.project_id = p.id
      WHERE wr.contractor_id = internal.my_contractor_id()
    )
  );

-- contractors
DROP POLICY IF EXISTS "contractors_owner_all"    ON public.contractors;
DROP POLICY IF EXISTS "contractors_self_select"  ON public.contractors;

CREATE POLICY "contractors_owner_all" ON public.contractors
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

CREATE POLICY "contractors_self_select" ON public.contractors
  FOR SELECT TO authenticated
  USING (
    NOT internal.is_owner()
    AND id = internal.my_contractor_id()
  );

-- users
DROP POLICY IF EXISTS "users_owner_all"    ON public.users;
DROP POLICY IF EXISTS "users_self_select"  ON public.users;

CREATE POLICY "users_owner_all" ON public.users
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

CREATE POLICY "users_self_select" ON public.users
  FOR SELECT TO authenticated
  USING (
    NOT internal.is_owner()
    AND id = auth.uid()
  );

-- projects
DROP POLICY IF EXISTS "projects_owner_all"          ON public.projects;
DROP POLICY IF EXISTS "projects_contractor_select"  ON public.projects;

CREATE POLICY "projects_owner_all" ON public.projects
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

CREATE POLICY "projects_contractor_select" ON public.projects
  FOR SELECT TO authenticated
  USING (
    NOT internal.is_owner()
    AND id IN (
      SELECT DISTINCT project_id FROM public.work_records
      WHERE contractor_id = internal.my_contractor_id()
        AND project_id IS NOT NULL
    )
  );

-- price_rules
DROP POLICY IF EXISTS "price_rules_owner_all"         ON public.price_rules;
DROP POLICY IF EXISTS "price_rules_contractor_select" ON public.price_rules;

CREATE POLICY "price_rules_owner_all" ON public.price_rules
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

CREATE POLICY "price_rules_contractor_select" ON public.price_rules
  FOR SELECT TO authenticated
  USING (
    NOT internal.is_owner()
    AND project_id IN (
      SELECT DISTINCT project_id FROM public.work_records
      WHERE contractor_id = internal.my_contractor_id()
        AND project_id IS NOT NULL
    )
  );

-- project_payees
--   payee_contractor_id / via_contractor_id の存在はリモートスキーマ次第のため
--   DO ブロックで動的に確認してからポリシーを生成する
DROP POLICY IF EXISTS "project_payees_owner_all"         ON public.project_payees;
DROP POLICY IF EXISTS "project_payees_contractor_select" ON public.project_payees;

CREATE POLICY "project_payees_owner_all" ON public.project_payees
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

DO $$
DECLARE
  has_payee_col BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'project_payees'
      AND column_name  = 'payee_contractor_id'
  ) INTO has_payee_col;

  IF has_payee_col THEN
    EXECUTE $p$
      CREATE POLICY "project_payees_contractor_select" ON public.project_payees
        FOR SELECT TO authenticated
        USING (
          NOT internal.is_owner()
          AND (
            payee_contractor_id = internal.my_contractor_id()
            OR via_contractor_id = internal.my_contractor_id()
          )
        )
    $p$;
  ELSE
    -- カラムが存在しない場合は管理者のみに制限（安全側に倒す）
    EXECUTE $p$
      CREATE POLICY "project_payees_contractor_select" ON public.project_payees
        FOR SELECT TO authenticated
        USING (NOT internal.is_owner())
    $p$;
  END IF;
END;
$$;

-- work_records
DROP POLICY IF EXISTS "work_records_owner_all"          ON public.work_records;
DROP POLICY IF EXISTS "work_records_contractor_select"  ON public.work_records;
DROP POLICY IF EXISTS "work_records_contractor_insert"  ON public.work_records;

CREATE POLICY "work_records_owner_all" ON public.work_records
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

CREATE POLICY "work_records_contractor_select" ON public.work_records
  FOR SELECT TO authenticated
  USING (
    NOT internal.is_owner()
    AND contractor_id = internal.my_contractor_id()
  );

CREATE POLICY "work_records_contractor_insert" ON public.work_records
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT internal.is_owner()
    AND contractor_id = internal.my_contractor_id()
  );

-- expense_records
DROP POLICY IF EXISTS "expense_records_owner_all"         ON public.expense_records;
DROP POLICY IF EXISTS "expense_records_contractor_select" ON public.expense_records;
DROP POLICY IF EXISTS "expense_records_contractor_insert" ON public.expense_records;

CREATE POLICY "expense_records_owner_all" ON public.expense_records
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

CREATE POLICY "expense_records_contractor_select" ON public.expense_records
  FOR SELECT TO authenticated
  USING (
    NOT internal.is_owner()
    AND contractor_id = internal.my_contractor_id()
  );

CREATE POLICY "expense_records_contractor_insert" ON public.expense_records
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT internal.is_owner()
    AND contractor_id = internal.my_contractor_id()
  );

-- payment_notices
DROP POLICY IF EXISTS "payment_notices_owner_all"         ON public.payment_notices;
DROP POLICY IF EXISTS "payment_notices_contractor_select" ON public.payment_notices;

CREATE POLICY "payment_notices_owner_all" ON public.payment_notices
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

CREATE POLICY "payment_notices_contractor_select" ON public.payment_notices
  FOR SELECT TO authenticated
  USING (
    NOT internal.is_owner()
    AND contractor_id = internal.my_contractor_id()
  );

-- invoices
DROP POLICY IF EXISTS "invoices_owner_all" ON public.invoices;

CREATE POLICY "invoices_owner_all" ON public.invoices
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

-- payments
DROP POLICY IF EXISTS "payments_owner_all"         ON public.payments;
DROP POLICY IF EXISTS "payments_contractor_select" ON public.payments;

CREATE POLICY "payments_owner_all" ON public.payments
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

CREATE POLICY "payments_contractor_select" ON public.payments
  FOR SELECT TO authenticated
  USING (
    NOT internal.is_owner()
    AND contractor_id = internal.my_contractor_id()
  );

-- approval_history
DROP POLICY IF EXISTS "approval_history_owner_select_insert" ON public.approval_history;
DROP POLICY IF EXISTS "approval_history_owner_insert"        ON public.approval_history;
DROP POLICY IF EXISTS "approval_history_contractor_select"   ON public.approval_history;

CREATE POLICY "approval_history_owner_select_insert" ON public.approval_history
  FOR SELECT TO authenticated
  USING (internal.is_owner());

CREATE POLICY "approval_history_owner_insert" ON public.approval_history
  FOR INSERT TO authenticated
  WITH CHECK (internal.is_owner());

CREATE POLICY "approval_history_contractor_select" ON public.approval_history
  FOR SELECT TO authenticated
  USING (
    NOT internal.is_owner()
    AND payment_notice_id IN (
      SELECT id FROM public.payment_notices
      WHERE contractor_id = internal.my_contractor_id()
    )
  );

-- billing_records
DROP POLICY IF EXISTS "billing_records_owner_all" ON public.billing_records;

CREATE POLICY "billing_records_owner_all" ON public.billing_records
  FOR ALL TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

-- schedules
DROP POLICY IF EXISTS "schedules_owner_select"      ON public.schedules;
DROP POLICY IF EXISTS "schedules_owner_insert"      ON public.schedules;
DROP POLICY IF EXISTS "schedules_owner_update"      ON public.schedules;
DROP POLICY IF EXISTS "schedules_owner_delete"      ON public.schedules;
DROP POLICY IF EXISTS "schedules_contractor_select" ON public.schedules;
DROP POLICY IF EXISTS "schedules_contractor_insert" ON public.schedules;

CREATE POLICY "schedules_owner_select" ON public.schedules
  FOR SELECT TO authenticated
  USING (internal.is_owner());

CREATE POLICY "schedules_owner_insert" ON public.schedules
  FOR INSERT TO authenticated
  WITH CHECK (internal.is_owner());

CREATE POLICY "schedules_owner_update" ON public.schedules
  FOR UPDATE TO authenticated
  USING (internal.is_owner())
  WITH CHECK (internal.is_owner());

CREATE POLICY "schedules_owner_delete" ON public.schedules
  FOR DELETE TO authenticated
  USING (internal.is_owner());

CREATE POLICY "schedules_contractor_select" ON public.schedules
  FOR SELECT TO authenticated
  USING (
    NOT internal.is_owner()
    AND contractor_id = internal.my_contractor_id()
  );

CREATE POLICY "schedules_contractor_insert" ON public.schedules
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT internal.is_owner()
    AND contractor_id = internal.my_contractor_id()
  );

-- notification_logs（管理者のみ SELECT/INSERT、子分は全面禁止、UPDATE/DELETE は全ロール禁止）
DROP POLICY IF EXISTS "notification_logs_owner_select" ON public.notification_logs;
DROP POLICY IF EXISTS "notification_logs_owner_insert" ON public.notification_logs;

CREATE POLICY "notification_logs_owner_select" ON public.notification_logs
  FOR SELECT TO authenticated
  USING (internal.is_owner());

CREATE POLICY "notification_logs_owner_insert" ON public.notification_logs
  FOR INSERT TO authenticated
  WITH CHECK (internal.is_owner());
