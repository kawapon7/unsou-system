-- ================================================================
-- project_payees: payment_type に 'per_piece'（個数単価制）を追加
-- 変更理由: 配達個数（work_records.piece_count）× 単価 の計算モードを解禁
-- ================================================================

-- 既存 CHECK 制約を DROP して再作成（ADD COLUMN 時のインライン制約は名前変更不可のため）
ALTER TABLE project_payees
  DROP CONSTRAINT IF EXISTS project_payees_payment_type_check;

ALTER TABLE project_payees
  ADD CONSTRAINT project_payees_payment_type_check
    CHECK (payment_type IN ('per_unit', 'fixed_monthly', 'per_piece'));

COMMENT ON COLUMN project_payees.payment_type IS
  '支払タイプ: per_unit=件数×単価, fixed_monthly=月額固定, per_piece=個数（piece_count）×単価';
