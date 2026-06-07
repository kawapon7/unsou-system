-- ================================================================
-- contractors テーブル：サーバーサイド（service_role）専用アクセスに変更
-- フロントエンド（anon / authenticated）からの直接アクセスを全面禁止
-- v1.9 口座情報暗号化対応に伴うセキュリティ強化
-- ================================================================

-- 既存ポリシーをすべて削除
DROP POLICY IF EXISTS "contractors_owner_all" ON contractors;
DROP POLICY IF EXISTS "contractors_self_select" ON contractors;
DROP POLICY IF EXISTS "Allow server-side access only" ON contractors;

-- RLS有効化（既に有効でも冪等）
ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;

-- Next.jsのサーバーサイド（service_roleキー）のみアクセスを許可し、フロントエンドからは全面遮断するポリシー
CREATE POLICY "Allow server-side access only"
ON contractors
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
