-- マルチテナント論理分離用 tenant_id カラムを主要テーブルに追加
-- DEFAULT 'local-dev' により既存レコードは自動的に単一テナント扱いになる

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'local-dev';

ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'local-dev';

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'local-dev';

ALTER TABLE work_records
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'local-dev';

ALTER TABLE expense_records
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'local-dev';

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'local-dev';
