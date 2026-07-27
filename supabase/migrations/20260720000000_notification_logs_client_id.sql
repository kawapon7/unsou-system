-- ================================================================
-- notification_logs.client_id 追加（荷主向けアラートの記録に対応）
--
-- ⚠️ このファイルは事後復元されたものである。
--    本番DB(hbpnhbsmsuhjyrohpluu)には version=20260720000000 として
--    適用済みだが、リポジトリにファイルが存在しなかった。
--    2026-07-27、本番の information_schema / pg_constraint / pg_indexes を
--    直接introspectして実スキーマから内容を再構成した。
--    したがって「本番に合わせて書いた」ファイルであり、その逆ではない。
--
-- 変更内容（4点。いずれも本番の実スキーマに一致）:
--   1. contractor_id の NOT NULL を解除（荷主宛ログは contractor_id を持たない）
--   2. client_id UUID を追加（clients(id) 参照・ON DELETE CASCADE）
--   3. 送信先の排他制約: contractor_id と client_id はどちらか一方のみ NOT NULL
--   4. client_id の索引を追加
--
-- 不変ログ設計（INSERTのみ許可 / UPDATE・DELETE は全ロール禁止）は変更しない。
-- RLSポリシー・不変トリガー（trg_notification_logs_no_update / _no_delete）は
-- 20260627000001 のまま維持する。
-- ================================================================

-- 1. contractor_id を NULL 許容へ（荷主宛ログのため）
ALTER TABLE notification_logs
  ALTER COLUMN contractor_id DROP NOT NULL;

-- 2. client_id 列を追加
ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE;

-- 3. 送信先の排他制約（contractor_id / client_id のどちらか一方だけが入る）
--    ⚠️ 既存行が両方NULL・両方NOT NULLだとここで失敗する。
--       本番適用時点では違反行なしを確認済み。新規DBでは空テーブルのため問題なし。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_logs_subject_check'
  ) THEN
    ALTER TABLE notification_logs
      ADD CONSTRAINT notification_logs_subject_check
      CHECK (
        (contractor_id IS NOT NULL AND client_id IS NULL)
        OR
        (contractor_id IS NULL AND client_id IS NOT NULL)
      );
  END IF;
END $$;

-- 4. 索引
CREATE INDEX IF NOT EXISTS idx_notification_logs_client_id
  ON notification_logs (client_id);
