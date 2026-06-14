-- ================================================================
-- v2.0 防衛設計拡張: schedules / notification_logs テーブル追加
-- schedules        : 子分の月次稼働予定管理・未入力アラートの検知元
-- notification_logs: メール/SMS催促の送信履歴（不変ログ）
--
-- リモートDB実スキーマ準拠:
--   users.role = 'master'（親分）
--   contractors.user_id = auth.uid()（子分の自己参照）
-- ================================================================

-- ----------------------------------------------------------------
-- RLS ヘルパー関数（冪等: CREATE OR REPLACE で既存を上書き）
-- ローカルマイグレーション定義とリモート実スキーマの差異を吸収する
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_owner()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role = 'master'
  );
$$;

CREATE OR REPLACE FUNCTION my_contractor_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.contractors
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- ================================================================
-- schedules（予定管理）
-- ================================================================
CREATE TABLE IF NOT EXISTS schedules (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID         NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  project_id    UUID         NOT NULL REFERENCES projects(id)    ON DELETE CASCADE,
  date          DATE         NOT NULL,
  status        TEXT         NOT NULL DEFAULT 'scheduled'
                             CHECK (status IN ('scheduled', 'absent', 'completed')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 一意制約: 同一ドライバー×同一日に予定は1件のみ
ALTER TABLE schedules
  ADD CONSTRAINT schedules_contractor_date_unique
  UNIQUE (contractor_id, date);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_schedules_contractor_id
  ON schedules (contractor_id);

CREATE INDEX IF NOT EXISTS idx_schedules_date
  ON schedules (date);

-- 未入力アラート検知用: scheduled 行を日付降順で高速スキャン
CREATE INDEX IF NOT EXISTS idx_schedules_status_date
  ON schedules (status, date DESC)
  WHERE status = 'scheduled';

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_schedules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedules_updated_at ON schedules;
CREATE TRIGGER trg_schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION update_schedules_updated_at();

-- ================================================================
-- schedules RLS
-- 親分(is_owner): 全行・全操作
-- 子分          : 自身の contractor_id の行のみ SELECT・INSERT
--                 UPDATE/DELETE は Server Actions (service_role) 経由
-- anon          : アクセス不可（RLS 有効 + ポリシー未定義 = 全拒否）
-- ================================================================
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedules_owner_all"         ON schedules;
DROP POLICY IF EXISTS "schedules_contractor_select" ON schedules;
DROP POLICY IF EXISTS "schedules_contractor_insert" ON schedules;

CREATE POLICY "schedules_owner_all" ON schedules
  FOR ALL TO authenticated
  USING    (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "schedules_contractor_select" ON schedules
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND contractor_id = my_contractor_id()
  );

CREATE POLICY "schedules_contractor_insert" ON schedules
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT is_owner()
    AND contractor_id = my_contractor_id()
  );

-- ================================================================
-- notification_logs（催促履歴ログ）
-- 不変ログ設計:
--   INSERT のみ許可（UPDATE/DELETE ポリシー未定義 → 全ロール拒否）
--   INSERT の実行は Server Actions (service_role) のみ
--             → authenticated へのINSERTポリシーなし
--   READ      : 親分（is_owner）のみ
--   子分      : アクセス全面禁止
-- ================================================================
CREATE TABLE IF NOT EXISTS notification_logs (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID         NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  type          TEXT         NOT NULL
                             CHECK (type IN ('email', 'sms', 'import_log', 'reminder')),
  destination   TEXT         NOT NULL,
  status        TEXT         NOT NULL DEFAULT 'sent'
                             CHECK (status IN ('sent', 'failed', 'delivered')),
  message_id    TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  -- updated_at は意図的に省略（不変ログにつき更新不要）
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_notification_logs_contractor_id
  ON notification_logs (contractor_id);

CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
  ON notification_logs (created_at DESC);

-- 長期未承認アラート用: type + status の複合インデックス
CREATE INDEX IF NOT EXISTS idx_notification_logs_type_status
  ON notification_logs (type, status, created_at DESC);

-- ================================================================
-- notification_logs RLS
-- ================================================================
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_logs_owner_select" ON notification_logs;

CREATE POLICY "notification_logs_owner_select" ON notification_logs
  FOR SELECT TO authenticated
  USING (is_owner());
