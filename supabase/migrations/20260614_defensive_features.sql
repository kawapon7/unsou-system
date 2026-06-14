-- ================================================================
-- 防衛機能: schedules / notification_logs テーブルと RLS ポリシー
-- ================================================================

-- ================================================================
-- schedules（予定管理）
-- ================================================================
CREATE TABLE IF NOT EXISTS schedules (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID         NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  project_id    UUID         NOT NULL REFERENCES projects(id)    ON DELETE CASCADE,
  date          DATE         NOT NULL,
  status        TEXT         NOT NULL DEFAULT 'scheduled',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedules_contractor_date_unique'
  ) THEN
    ALTER TABLE schedules
      ADD CONSTRAINT schedules_contractor_date_unique
      UNIQUE (contractor_id, date);
  END IF;
END $$;

-- ================================================================
-- notification_logs（催促・監査履歴ログ）
-- ================================================================
CREATE TABLE IF NOT EXISTS notification_logs (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID         NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  type          TEXT         NOT NULL,
  destination   TEXT         NOT NULL,
  status        TEXT         NOT NULL,
  message_id    TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- RLS
-- ================================================================
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除して仕様どおり再作成
DROP POLICY IF EXISTS "schedules_owner_all"              ON schedules;
DROP POLICY IF EXISTS "schedules_contractor_select"    ON schedules;
DROP POLICY IF EXISTS "schedules_contractor_insert"    ON schedules;
DROP POLICY IF EXISTS "schedules_authenticated_all"    ON schedules;

DROP POLICY IF EXISTS "notification_logs_owner_select" ON notification_logs;
DROP POLICY IF EXISTS "notification_logs_authenticated_select" ON notification_logs;
DROP POLICY IF EXISTS "notification_logs_authenticated_insert" ON notification_logs;

CREATE POLICY "schedules_authenticated_all" ON schedules
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "notification_logs_authenticated_select" ON notification_logs
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "notification_logs_authenticated_insert" ON notification_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);
