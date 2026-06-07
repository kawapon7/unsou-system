-- expense_records は initial_schema で作成済みのため、
-- ここではRLSポリシーの service_role 専用化のみ実施する

-- 既存ポリシーを削除（rls_policies.sqlで設定されたものも含む）
DROP POLICY IF EXISTS "expense_records_owner_all" ON expense_records;
DROP POLICY IF EXISTS "expense_records_self_select" ON expense_records;
DROP POLICY IF EXISTS "Allow server-side access only for expense_records" ON expense_records;

-- RLS有効化（冪等）
ALTER TABLE expense_records ENABLE ROW LEVEL SECURITY;

-- Next.jsサーバーサイド（service_role）のみアクセスを許可し、フロントエンドからは全面遮断するポリシー
CREATE POLICY "Allow server-side access only for expense_records"
ON expense_records
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
