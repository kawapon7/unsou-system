-- マルチテナント基礎工事: companies テーブルと company_id カラムの追加
-- 既存データへの影響ゼロ（company_id は nullable、既存行はそのまま）

-- ================================================================
-- companies（テナント会社マスタ）
-- ================================================================
CREATE TABLE IF NOT EXISTS companies (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies_service_role_all"
  ON companies FOR ALL
  USING (auth.role() = 'service_role');

-- 将来: 自社ユーザーは自社レコードのみ参照可（users.company_id で絞る）
-- 現時点では service_role のみ操作可能とし、RLS の誤操作を防ぐ

-- ================================================================
-- work_records に company_id を追加（nullable）
-- ================================================================
ALTER TABLE work_records
  ADD COLUMN IF NOT EXISTS company_id UUID
    REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_records_company_id
  ON work_records(company_id)
  WHERE company_id IS NOT NULL;

-- ================================================================
-- expense_records に company_id を追加（nullable）
-- ================================================================
ALTER TABLE expense_records
  ADD COLUMN IF NOT EXISTS company_id UUID
    REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_records_company_id
  ON expense_records(company_id)
  WHERE company_id IS NOT NULL;
