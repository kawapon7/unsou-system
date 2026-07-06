-- 本番DBの users テーブルに contractor_id 列が実際には存在しないことが判明（初期スキーマ
-- 20260605000000_initial_schema.sql には定義があるが、本番には未適用のまま運用されていた）。
-- getAuthContext() / driver側 dashboard actions が `select('role, contractor_id')` 等で
-- この列を前提にクエリしており、列欠落によりクエリ自体が失敗 → role判定が常に
-- 'contractor' にフォールバックしていた（本番ログイン後の権限誤判定の直接原因）。

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL;

COMMIT;
