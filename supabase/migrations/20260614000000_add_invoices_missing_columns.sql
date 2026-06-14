-- invoicesテーブルの不足カラムを追加
-- 初期スキーマ定義との差分を埋めるパッチマイグレーション

-- set_updated_at() が未適用の環境向けにここで定義（CREATE OR REPLACE で冪等）
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_month      DATE         NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS total_tax_excluded INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consumption_tax    INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date           DATE,
  ADD COLUMN IF NOT EXISTS status             TEXT         NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS issued_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW();

COMMENT ON COLUMN invoices.status IS 'draft | issued | paid';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_invoices_updated_at'
  ) THEN
    CREATE TRIGGER trg_invoices_updated_at
      BEFORE UPDATE ON invoices
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;
