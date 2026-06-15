-- ================================================================
-- RLS (Row Level Security) ポリシー定義
--
-- 役割判定ロジック:
--   is_owner()      : users テーブルの role = 'owner'（親分・管理者）
--   my_contractor() : users テーブルから自身の contractor_id を取得
-- ================================================================

-- ----------------------------------------------------------------
-- ヘルパー関数
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_owner()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
      AND role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION my_contractor_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT c.id FROM contractors c
  JOIN users u ON u.email = c.email
  WHERE u.id = auth.uid()
  LIMIT 1
$$;

-- ================================================================
-- clients（荷主マスタ）
-- 親分: CRUD / 子分: 参照不要（自身の案件に紐づく範囲のみSELECT）
-- ================================================================
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_owner_all" ON clients
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "clients_contractor_select" ON clients
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND id IN (
      SELECT DISTINCT p.client_id FROM projects p
      INNER JOIN work_records wr ON wr.project_id = p.id
      WHERE wr.contractor_id = my_contractor_id()
    )
  );

-- ================================================================
-- contractors（委託先マスタ）
-- 親分: CRUD / 子分: 自分自身の行のみSELECT
-- ================================================================
ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contractors_owner_all" ON contractors
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "contractors_self_select" ON contractors
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND id = my_contractor_id()
  );

-- ================================================================
-- users
-- 親分: CRUD / 子分: 自分自身の行のみSELECT
-- ================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_owner_all" ON users
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "users_self_select" ON users
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND id = auth.uid()
  );

-- ================================================================
-- projects（案件マスタ）
-- 親分: CRUD / 子分: 自身が関わる案件のみSELECT
-- ================================================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_owner_all" ON projects
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "projects_contractor_select" ON projects
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND id IN (
      SELECT DISTINCT project_id FROM work_records
      WHERE contractor_id = my_contractor_id()
        AND project_id IS NOT NULL
    )
  );

-- ================================================================
-- price_rules（単価ルール）
-- 親分: CRUD / 子分: 参照のみ（自身の案件に紐づく行）
-- ================================================================
ALTER TABLE price_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_rules_owner_all" ON price_rules
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "price_rules_contractor_select" ON price_rules
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND project_id IN (
      SELECT DISTINCT project_id FROM work_records
      WHERE contractor_id = my_contractor_id()
        AND project_id IS NOT NULL
    )
  );

-- ================================================================
-- project_payees（案件支払先）
-- 親分: CRUD / 子分: 自身が payee または via の行のみSELECT
-- ================================================================
ALTER TABLE project_payees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_payees_owner_all" ON project_payees
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "project_payees_contractor_select" ON project_payees
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND (
      payee_contractor_id = my_contractor_id()
      OR via_contractor_id = my_contractor_id()
    )
  );

-- ================================================================
-- work_records（勤務記録）
-- 親分: CRUD / 子分: 自身の contractor_id の行のみ SELECT・INSERT
-- ================================================================
ALTER TABLE work_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_records_owner_all" ON work_records
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "work_records_contractor_select" ON work_records
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND contractor_id = my_contractor_id()
  );

CREATE POLICY "work_records_contractor_insert" ON work_records
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT is_owner()
    AND contractor_id = my_contractor_id()
  );

-- ================================================================
-- expense_records（立替金・経費記録）
-- 親分: CRUD / 子分: 自身の contractor_id の行のみ SELECT・INSERT
-- ================================================================
ALTER TABLE expense_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_records_owner_all" ON expense_records
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "expense_records_contractor_select" ON expense_records
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND contractor_id = my_contractor_id()
  );

CREATE POLICY "expense_records_contractor_insert" ON expense_records
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT is_owner()
    AND contractor_id = my_contractor_id()
  );

-- ================================================================
-- payment_notices（支払通知書）
-- 親分: CRUD / 子分: 自身の contractor_id の行のみSELECT
-- ================================================================
ALTER TABLE payment_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_notices_owner_all" ON payment_notices
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "payment_notices_contractor_select" ON payment_notices
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND contractor_id = my_contractor_id()
  );

-- ================================================================
-- invoices（請求書）
-- 親分のみ全操作 / 子分はアクセス不可
-- ================================================================
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_owner_all" ON invoices
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

-- ================================================================
-- payments（支払明細）
-- 親分: CRUD / 子分: 自身の contractor_id の行のみSELECT
-- ================================================================
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_owner_all" ON payments
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "payments_contractor_select" ON payments
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND contractor_id = my_contractor_id()
  );

-- ================================================================
-- approval_history（承認履歴）
-- 親分: SELECT・INSERT のみ（UPDATE/DELETE はトリガーで禁止済み）
-- 子分: 自身の payment_notice_id に紐づく行のみSELECT
-- ================================================================
ALTER TABLE approval_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approval_history_owner_select_insert" ON approval_history
  FOR SELECT TO authenticated
  USING (is_owner());

CREATE POLICY "approval_history_owner_insert" ON approval_history
  FOR INSERT TO authenticated
  WITH CHECK (is_owner());

CREATE POLICY "approval_history_contractor_select" ON approval_history
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND payment_notice_id IN (
      SELECT id FROM payment_notices
      WHERE contractor_id = my_contractor_id()
    )
  );

-- ================================================================
-- billing_records（課金管理）
-- 親分のみ全操作 / 子分はアクセス不可
-- ================================================================
ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_records_owner_all" ON billing_records
  FOR ALL TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());
