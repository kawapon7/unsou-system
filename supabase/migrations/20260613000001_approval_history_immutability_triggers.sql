-- ================================================================
-- approval_history 不変性トリガー
-- 初期マイグレーション(20260605000000)がリモートDBに未適用のため
-- 別マイグレーションとして追加する
-- ================================================================

-- UPDATE/DELETE 禁止関数
CREATE OR REPLACE FUNCTION prevent_approval_history_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '承認履歴（approval_history）の変更・削除は禁止されています。';
END;
$$;

-- 既存トリガーが存在する場合は上書き
DROP TRIGGER IF EXISTS trg_approval_history_no_update ON approval_history;
DROP TRIGGER IF EXISTS trg_approval_history_no_delete ON approval_history;

CREATE TRIGGER trg_approval_history_no_update
  BEFORE UPDATE ON approval_history
  FOR EACH ROW EXECUTE FUNCTION prevent_approval_history_modification();

CREATE TRIGGER trg_approval_history_no_delete
  BEFORE DELETE ON approval_history
  FOR EACH ROW EXECUTE FUNCTION prevent_approval_history_modification();
