-- price_rules テーブルに selling_price エイリアスを追加
-- REMOTE DB では selling_price が実カラムとして存在するため、ローカル DB に合わせる
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 既存データがある場合は sales_price の値を引き継ぐ
UPDATE price_rules SET selling_price = sales_price WHERE selling_price = 0 AND sales_price > 0;
