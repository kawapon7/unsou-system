-- SCAN オプション: AI請求書解析ジョブ管理テーブル
-- HIBIKI コアテーブルへの依存は最小限（work_records への参照のみ）

CREATE TABLE scan_jobs (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            TEXT         NOT NULL UNIQUE,
  user_id           UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status            TEXT         NOT NULL DEFAULT 'queued'
                                 CHECK (status IN ('queued','processing','completed','failed')),
  file_name         TEXT,
  file_type         TEXT,
  work_record_id    UUID         REFERENCES work_records(id) ON DELETE SET NULL,
  extracted_data    JSONB,
  error_message     TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 最新状態を素早く取得するためのインデックス
CREATE INDEX idx_scan_jobs_job_id    ON scan_jobs(job_id);
CREATE INDEX idx_scan_jobs_user_id   ON scan_jobs(user_id, created_at DESC);
CREATE INDEX idx_scan_jobs_work_rec  ON scan_jobs(work_record_id) WHERE work_record_id IS NOT NULL;

-- RLS: service_role のみ書き込み可能（HIBIKI コアと同方針）
ALTER TABLE scan_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scan_jobs_service_role_all"
  ON scan_jobs
  FOR ALL
  USING (auth.role() = 'service_role');

-- 所有ユーザーは自分のジョブを読み取り可能
CREATE POLICY "scan_jobs_owner_read"
  ON scan_jobs
  FOR SELECT
  USING (auth.uid() = user_id);
