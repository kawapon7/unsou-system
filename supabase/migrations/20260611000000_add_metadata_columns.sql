-- ================================================================
-- SCAN / VOICE 拡張オプション向け metadata カラム追加
-- 各拡張オプションは "scan::" / "voice::" 等の名前空間プレフィックスを
-- キーに付与して格納すること（例: { "scan::job_id": "xxx" }）
-- ================================================================

ALTER TABLE clients        ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE work_records   ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

-- オプションごとの絞り込み検索を高速化するための GIN インデックス
CREATE INDEX IF NOT EXISTS idx_clients_metadata        ON clients        USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_work_records_metadata   ON work_records   USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_expense_records_metadata ON expense_records USING gin (metadata);
