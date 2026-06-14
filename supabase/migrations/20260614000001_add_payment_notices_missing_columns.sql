-- payment_noticesテーブルの不足カラムを追加
-- 初期スキーマ定義との差分を埋めるパッチマイグレーション

ALTER TABLE payment_notices
  ADD COLUMN IF NOT EXISTS notice_month         DATE          NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS labor_tax_excluded   INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_tax            INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_rate       NUMERIC(5,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction            INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_tax_excluded INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_tax          INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount         INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approval_status      TEXT          NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS locked               BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS locked_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_payment_notices_updated_at'
  ) THEN
    CREATE TRIGGER trg_payment_notices_updated_at
      BEFORE UPDATE ON payment_notices
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;
