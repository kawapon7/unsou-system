-- projects テーブルに配車・運行管理用カラムを追加

ALTER TABLE projects
  ADD COLUMN contractor_id    UUID         REFERENCES contractors(id) ON DELETE SET NULL,
  ADD COLUMN operation_start  TIMESTAMPTZ,
  ADD COLUMN operation_end    TIMESTAMPTZ,
  ADD COLUMN origin           TEXT,
  ADD COLUMN destination      TEXT,
  ADD COLUMN sale_amount      INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN buy_amount       INTEGER,
  ADD COLUMN status           TEXT         NOT NULL DEFAULT 'accepted';

COMMENT ON COLUMN projects.status IS '受託 | 配車済 | 運行中 | 完了 | キャンセル';
