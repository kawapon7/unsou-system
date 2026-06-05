-- ================================================================
-- 運送業務管理システム 初期スキーマ v1.8
-- 金額カラムはすべて「税抜き金額」で定義（expense_records は実費額＋税抜額の両方を持つ）
-- ================================================================

-- ================================================================
-- clients（荷主マスタ）
-- ================================================================
CREATE TABLE clients (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name        TEXT         NOT NULL,
  contact_name        TEXT,
  phone               TEXT,
  email               TEXT,
  closing_day         TEXT         NOT NULL DEFAULT '月末',
  payment_site        INTEGER      NOT NULL DEFAULT 30,
  tax_type            TEXT         NOT NULL DEFAULT 'exclusive',
  invoice_registered  BOOLEAN      NOT NULL DEFAULT FALSE,
  bank_name           TEXT,
  bank_branch         TEXT,
  account_type        TEXT,
  account_number      TEXT,
  account_holder      TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- contractors（委託先マスタ）
-- withholding_tax_flag  : 源泉徴収フラグ（凍結中・将来拡張用）
-- detailed_input_switch : 詳細入力切り替えスイッチ（多段階委託）
-- same_person_id        : 同一人物ID（インボイス登録名義が異なる場合）
-- ================================================================
CREATE TABLE contractors (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        TEXT         NOT NULL,
  phone                       TEXT,
  email                       TEXT,
  payment_method              TEXT         NOT NULL DEFAULT 'bank_transfer',
  payment_site                INTEGER      NOT NULL DEFAULT 30,
  tax_type                    TEXT         NOT NULL DEFAULT 'exclusive',
  invoice_registration_type   TEXT         NOT NULL DEFAULT 'unregistered',
  invoice_registration_number TEXT,
  withholding_tax_flag        BOOLEAN      NOT NULL DEFAULT FALSE,
  detailed_input_switch       BOOLEAN      NOT NULL DEFAULT FALSE,
  same_person_id              UUID,
  contractor_type             TEXT         NOT NULL DEFAULT 'sole_proprietor',
  bank_name                   TEXT,
  bank_branch                 TEXT,
  account_type                TEXT,
  account_number              TEXT,
  account_holder              TEXT,
  login_email                 TEXT         UNIQUE,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- users（ユーザー・権限管理）
-- ================================================================
CREATE TABLE users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT         UNIQUE NOT NULL,
  role          TEXT         NOT NULL DEFAULT 'contractor',
  contractor_id UUID         REFERENCES contractors(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- projects（案件マスタ）
-- ================================================================
CREATE TABLE projects (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code TEXT         UNIQUE NOT NULL,
  project_name TEXT         NOT NULL,
  client_id    UUID         NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  unit_type    TEXT         NOT NULL DEFAULT 'quantity',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- price_rules（単価ルール）金額はすべて税抜き
-- ================================================================
CREATE TABLE price_rules (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sale_unit_price  INTEGER      NOT NULL DEFAULT 0,
  buy_unit_price   INTEGER      NOT NULL DEFAULT 0,
  calc_type        TEXT         NOT NULL DEFAULT 'quantity',
  effective_from   DATE,
  effective_to     DATE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- project_payees（案件支払先）
-- ================================================================
CREATE TABLE project_payees (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  via_contractor_id   UUID         REFERENCES contractors(id) ON DELETE SET NULL,
  payee_contractor_id UUID         NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- work_records（勤務記録）金額はすべて税抜き
-- spot_generic_id : 汎用スポットID（正式マスタ登録前の一時識別子）
-- ================================================================
CREATE TABLE work_records (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id        UUID         NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  project_id           UUID         REFERENCES projects(id) ON DELETE SET NULL,
  spot_generic_id      TEXT,
  work_date            DATE         NOT NULL,
  quantity             INTEGER      NOT NULL DEFAULT 0,
  tax_excluded_sales   INTEGER      NOT NULL DEFAULT 0,
  tax_excluded_payment INTEGER      NOT NULL DEFAULT 0,
  approval_status      TEXT         NOT NULL DEFAULT 'pending',
  memo                 TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- expense_records（立替金・経費記録）
-- amount_actual       : 実費金額（税込・子分が入力する値）
-- amount_tax_excluded : 税抜き金額（DB保存値・実費÷1.1で四捨五入）
-- tax_category        : 消費税区分（taxable_10 / exempt）
-- ================================================================
CREATE TABLE expense_records (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id       UUID         NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  expense_date        DATE         NOT NULL,
  expense_type        TEXT         NOT NULL,
  amount_actual       INTEGER      NOT NULL DEFAULT 0,
  amount_tax_excluded INTEGER      NOT NULL DEFAULT 0,
  tax_category        TEXT         NOT NULL DEFAULT 'taxable_10',
  remarks             TEXT,
  receipt_url         TEXT,
  approval_status     TEXT         NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- payment_notices（支払通知書）金額はすべて税抜き基準で保持
-- ================================================================
CREATE TABLE payment_notices (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id        UUID          NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  notice_month         DATE          NOT NULL,
  labor_tax_excluded   INTEGER       NOT NULL DEFAULT 0,
  labor_tax            INTEGER       NOT NULL DEFAULT 0,
  deduction_rate       NUMERIC(5,4)  NOT NULL DEFAULT 0,
  deduction            INTEGER       NOT NULL DEFAULT 0,
  expense_tax_excluded INTEGER       NOT NULL DEFAULT 0,
  expense_tax          INTEGER       NOT NULL DEFAULT 0,
  total_amount         INTEGER       NOT NULL DEFAULT 0,
  approval_status      TEXT          NOT NULL DEFAULT 'pending',
  locked               BOOLEAN       NOT NULL DEFAULT FALSE,
  locked_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (contractor_id, notice_month)
);

-- ================================================================
-- invoices（請求書）金額はすべて税抜き基準
-- ================================================================
CREATE TABLE invoices (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID         NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_month      DATE         NOT NULL,
  total_tax_excluded INTEGER      NOT NULL DEFAULT 0,
  consumption_tax    INTEGER      NOT NULL DEFAULT 0,
  total_amount       INTEGER      NOT NULL DEFAULT 0,
  due_date           DATE,
  status             TEXT         NOT NULL DEFAULT 'draft',
  issued_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, invoice_month)
);

-- ================================================================
-- payments（支払明細）
-- ================================================================
CREATE TABLE payments (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_notice_id  UUID         REFERENCES payment_notices(id) ON DELETE SET NULL,
  contractor_id      UUID         NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  payment_month      DATE         NOT NULL,
  total_amount       INTEGER      NOT NULL DEFAULT 0,
  payment_date       DATE,
  status             TEXT         NOT NULL DEFAULT 'unpaid',
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- approval_history（承認履歴）
-- 追記専用（UPDATE/DELETE はトリガーで禁止）
-- updated_at は意図的に持たせない
-- ================================================================
CREATE TABLE approval_history (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   TEXT         NOT NULL,
  target_id     TEXT         NOT NULL,
  action_type   TEXT         NOT NULL,
  operator_id   TEXT         NOT NULL,
  amount_before INTEGER,
  amount_after  INTEGER,
  memo          TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- billing_records（課金管理）
-- ================================================================
CREATE TABLE billing_records (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_month           DATE         NOT NULL UNIQUE,
  active_contractor_count INTEGER      NOT NULL DEFAULT 0,
  base_fee                INTEGER      NOT NULL DEFAULT 2980,
  per_contractor_fee      INTEGER      NOT NULL DEFAULT 980,
  total_fee               INTEGER      NOT NULL DEFAULT 0,
  status                  TEXT         NOT NULL DEFAULT 'pending',
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- approval_history: UPDATE・DELETE 禁止トリガー
-- ================================================================
CREATE OR REPLACE FUNCTION prevent_approval_history_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '承認履歴（approval_history）の変更・削除は禁止されています。';
END;
$$;

CREATE TRIGGER trg_approval_history_no_update
  BEFORE UPDATE ON approval_history
  FOR EACH ROW EXECUTE FUNCTION prevent_approval_history_modification();

CREATE TRIGGER trg_approval_history_no_delete
  BEFORE DELETE ON approval_history
  FOR EACH ROW EXECUTE FUNCTION prevent_approval_history_modification();

-- ================================================================
-- updated_at 自動更新トリガー（approval_history を除く全テーブル）
-- ================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clients_updated_at           BEFORE UPDATE ON clients           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_contractors_updated_at       BEFORE UPDATE ON contractors       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated_at             BEFORE UPDATE ON users             FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_projects_updated_at          BEFORE UPDATE ON projects          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_project_payees_updated_at    BEFORE UPDATE ON project_payees    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_work_records_updated_at      BEFORE UPDATE ON work_records      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_expense_records_updated_at   BEFORE UPDATE ON expense_records   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payment_notices_updated_at   BEFORE UPDATE ON payment_notices   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoices_updated_at          BEFORE UPDATE ON invoices          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payments_updated_at          BEFORE UPDATE ON payments          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_billing_records_updated_at   BEFORE UPDATE ON billing_records   FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- インデックス
-- ================================================================
CREATE INDEX idx_work_records_contractor_id    ON work_records(contractor_id);
CREATE INDEX idx_work_records_project_id       ON work_records(project_id);
CREATE INDEX idx_work_records_work_date        ON work_records(work_date);
CREATE INDEX idx_work_records_spot_generic_id  ON work_records(spot_generic_id) WHERE spot_generic_id IS NOT NULL;
CREATE INDEX idx_expense_records_contractor_id ON expense_records(contractor_id);
CREATE INDEX idx_expense_records_expense_date  ON expense_records(expense_date);
CREATE INDEX idx_approval_history_target       ON approval_history(target_type, target_id);
CREATE INDEX idx_payment_notices_contractor    ON payment_notices(contractor_id, notice_month);
CREATE INDEX idx_invoices_client_month         ON invoices(client_id, invoice_month);
