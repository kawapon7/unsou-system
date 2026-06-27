-- ================================================================
-- notification_logs 不変性トリガー
-- ----------------------------------------------------------------
-- 背景:
--   notification_logs は「不変ログ（INSERTのみ）」設計だが、これまで
--   UPDATE/DELETE ポリシー未定義（RLS deny）のみで担保していた。
--   しかし Server Actions は service_role を多用しており、service_role は
--   RLS をバイパスするため UPDATE/DELETE が素通りしてしまう。
--   approval_history（20260613000001）と同様、RLSではなくトリガーで
--   全ロールに対し UPDATE/DELETE を物理的に禁止する。
--   ※ CLAUDE.md §2.4「不変ログの保護」準拠。
-- ================================================================

-- UPDATE/DELETE 禁止関数
CREATE OR REPLACE FUNCTION prevent_notification_logs_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '通知ログ（notification_logs）の変更・削除は禁止されています。';
END;
$$;

-- 既存トリガーが存在する場合は上書き
DROP TRIGGER IF EXISTS trg_notification_logs_no_update ON notification_logs;
DROP TRIGGER IF EXISTS trg_notification_logs_no_delete ON notification_logs;

CREATE TRIGGER trg_notification_logs_no_update
  BEFORE UPDATE ON notification_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_notification_logs_modification();

CREATE TRIGGER trg_notification_logs_no_delete
  BEFORE DELETE ON notification_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_notification_logs_modification();
