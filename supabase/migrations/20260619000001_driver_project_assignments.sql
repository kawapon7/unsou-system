-- ドライバーごとの案件割り当てテーブル
-- contractor_id × project_id の多対多（管理者が設定）
CREATE TABLE IF NOT EXISTS driver_project_assignments (
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id)    ON DELETE CASCADE,
  tenant_id     uuid NOT NULL,
  PRIMARY KEY (contractor_id, project_id)
);

ALTER TABLE driver_project_assignments ENABLE ROW LEVEL SECURITY;

-- サービスロール（管理者操作）のみアクセス許可
CREATE POLICY "service role full access" ON driver_project_assignments
  FOR ALL USING (true) WITH CHECK (true);
