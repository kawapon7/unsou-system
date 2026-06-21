-- ================================================================
-- project_payees: 支払計算ルール拡張
-- 再委託・端数調整金・件数単価に対応
-- ================================================================

ALTER TABLE project_payees
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'per_unit'
    CHECK (payment_type IN ('per_unit', 'fixed_monthly')),
  ADD COLUMN IF NOT EXISTS unit_price INTEGER,
  ADD COLUMN IF NOT EXISTS work_source_contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payee_tier TEXT NOT NULL DEFAULT 'primary'
    CHECK (payee_tier IN ('primary', 'sub')),
  ADD COLUMN IF NOT EXISTS tax_method TEXT NOT NULL DEFAULT 'exclusive'
    CHECK (tax_method IN ('inclusive', 'exclusive')),
  ADD COLUMN IF NOT EXISTS rounding_rule TEXT NOT NULL DEFAULT 'round'
    CHECK (rounding_rule IN ('round', 'floor', 'ceil')),
  ADD COLUMN IF NOT EXISTS adjustment_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- contractors: 再委託関係（業者X → 個人事業主Y）
ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS parent_contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL;

COMMENT ON COLUMN project_payees.payment_type IS '支払タイプ: per_unit=件数×単価, fixed_monthly=月額固定';
COMMENT ON COLUMN project_payees.unit_price IS '件数単価（税抜、円）';
COMMENT ON COLUMN project_payees.work_source_contractor_id IS '稼働件数カウント対象の委託先（NULL=自身）。再委託ケース: 業者XがYの稼働分で請求する場合はYのIDを指定';
COMMENT ON COLUMN project_payees.payee_tier IS '支払階層: primary=直接委託先, sub=再委託先';
COMMENT ON COLUMN project_payees.tax_method IS '業者の税計算方式: inclusive=税込思考（単価×1.1を端数処理）, exclusive=税抜思考（標準）';
COMMENT ON COLUMN project_payees.rounding_rule IS '端数処理: round=四捨五入, floor=切り捨て, ceil=切り上げ';
COMMENT ON COLUMN project_payees.adjustment_enabled IS '調整金有効フラグ: trueのとき端数差額を adjustment_amount に計上';
COMMENT ON COLUMN contractors.parent_contractor_id IS '上位業者ID（再委託の場合: 個人事業主Yの上位業者XのID）';
