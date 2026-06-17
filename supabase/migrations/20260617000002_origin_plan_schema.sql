-- ================================================================
-- 原点回帰プラン スキーマ追加
-- ================================================================

-- clients: payment_site(日数)を廃止し、締め日・支払月・支払日の3フィールドで置き換え
-- ※ closing_day は既存カラム（TEXT, DEFAULT '月末'）。新規: payment_month_offset, payment_day
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS payment_month_offset INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS payment_day TEXT NOT NULL DEFAULT '月末';

-- contractors: 同様に締め日・支払月・支払日を追加
-- ※ payment_site は既存。新規: closing_day, payment_month_offset, payment_day
ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS closing_day TEXT NOT NULL DEFAULT '月末',
  ADD COLUMN IF NOT EXISTS payment_month_offset INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS payment_day TEXT NOT NULL DEFAULT '月末';

-- project_payees: マージン設定（金額ベース or ％ベース）
ALTER TABLE project_payees
  ADD COLUMN IF NOT EXISTS margin_type TEXT NOT NULL DEFAULT 'fixed'
    CHECK (margin_type IN ('fixed', 'percent')),
  ADD COLUMN IF NOT EXISTS margin_value NUMERIC NOT NULL DEFAULT 0;

-- payment_notices: 調整金フィールド（端数合わせ用）
ALTER TABLE payment_notices
  ADD COLUMN IF NOT EXISTS adjustment_amount INTEGER NOT NULL DEFAULT 0;

-- work_records: マスタ外突発案件フラグ
-- project_id を nullable 化（突発案件はプロジェクト未確定のため）
ALTER TABLE work_records
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE work_records
  ADD COLUMN IF NOT EXISTS is_off_master BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS off_master_job_name TEXT;

-- コメント
COMMENT ON COLUMN clients.payment_month_offset IS '支払月オフセット: 0=当月, 1=翌月, 2=翌々月, 3=3ヶ月後';
COMMENT ON COLUMN clients.payment_day IS '支払日: 1〜28の文字列, または 月末';
COMMENT ON COLUMN contractors.closing_day IS '締め日: 1〜28の文字列, または 月末';
COMMENT ON COLUMN contractors.payment_month_offset IS '支払月オフセット: 0=当月, 1=翌月, 2=翌々月, 3=3ヶ月後';
COMMENT ON COLUMN contractors.payment_day IS '支払日: 1〜28の文字列, または 月末';
COMMENT ON COLUMN project_payees.margin_type IS 'マージン計算方法: fixed=金額, percent=割合';
COMMENT ON COLUMN project_payees.margin_value IS 'マージン値（fixed: 円, percent: % × 100 → 例: 10%なら10を格納）';
COMMENT ON COLUMN payment_notices.adjustment_amount IS '調整金: 端数合わせ用（+/-両対応）';
COMMENT ON COLUMN work_records.is_off_master IS '突発案件フラグ（マスタ未登録の急な仕事）';
COMMENT ON COLUMN work_records.off_master_job_name IS '突発案件名（is_off_master=trueのときのみ使用）';
