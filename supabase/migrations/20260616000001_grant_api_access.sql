-- ================================================================
-- APIアクセス権付与（auto_expose_new_tables=false 対応）
-- Supabase 2026-05-30 以降、新規テーブルは自動公開されなくなったため
-- service_role / authenticated / anon への明示的GRANT が必要。
-- GRANT は冪等（重複実行しても安全）
-- ================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- service_role: Server Actions / API Routes から全操作（RLSでは制限しない）
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- authenticated: RLSポリシーが制限を担う
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- anon: 原則アクセス不可（各テーブルのRLSでブロック）
-- 明示的なGRANTは付与しない
