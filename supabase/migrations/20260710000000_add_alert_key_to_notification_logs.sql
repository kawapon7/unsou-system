-- ================================================================
-- notification_logs.alert_key 追加
-- 5大防衛アラートのメール自動送信復活: 重複防止キー
-- 同一アラート（missing_input:{scheduleId} / pending_notice:{noticeId}）への
-- 自動再送信を防ぐため使用。既存の不変ログ設計（INSERTのみ）は変更しない。
-- ================================================================

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS alert_key TEXT;

CREATE INDEX IF NOT EXISTS idx_notification_logs_alert_key
  ON notification_logs (alert_key);
