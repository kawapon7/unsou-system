-- projects テーブルに extend_projects.sql の未適用カラムを安全に追加
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contractor_id    UUID         REFERENCES contractors(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS operation_start  TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS operation_end    TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin           TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS destination      TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sale_amount      INTEGER      NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS buy_amount       INTEGER;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status           TEXT         NOT NULL DEFAULT 'accepted';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS unit_type        TEXT         NOT NULL DEFAULT 'quantity';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW();

COMMENT ON COLUMN projects.status IS 'accepted | dispatched | in_transit | completed | cancelled';
