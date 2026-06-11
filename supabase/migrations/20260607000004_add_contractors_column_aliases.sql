-- contractors テーブルのカラム名エイリアス追加
-- REMOTE DB では tax_type → tax_category、payment_method → payment_type として運用されているため
-- ローカル DB にエイリアスカラムを追加して整合させる

-- tax_category エイリアス（スキーマの tax_type に対応）
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS tax_category TEXT NOT NULL DEFAULT 'exclusive';
UPDATE contractors SET tax_category = tax_type WHERE tax_category = 'exclusive' AND tax_type IS NOT NULL;

-- payment_type エイリアス（スキーマの payment_method に対応）
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'bank_transfer';
UPDATE contractors SET payment_type = payment_method WHERE payment_type = 'bank_transfer' AND payment_method IS NOT NULL;
