-- ================================================================
-- スキーマ正規化補正マイグレーション
-- 目的: クラウドDBで手動定義されたスキーマとマイグレーション履歴の乖離を解消する
-- 冪等性: すべての変更は IF NOT EXISTS / IF EXISTS で保護
-- ================================================================

-- ----------------------------------------------------------------
-- 1. approval_history テーブル列名の正規化
--    初期マイグレーション(20260605000000)が旧列名で適用された場合の救済
--    新列追加 → 旧列削除の順で実行（FK違反を避けるため段階的に）
-- ----------------------------------------------------------------

-- 旧列が残っている場合のみ新列を追加
ALTER TABLE approval_history
  ADD COLUMN IF NOT EXISTS payment_notice_id UUID REFERENCES payment_notices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS action_by         UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS unlock_reason     TEXT;

-- 旧スキーマでデータが入っている場合の最善マッピング
-- (新規DBでは不要。クラウドDBでは旧列が存在しないため no-op)
DO $$
BEGIN
  -- operator_id → action_by への移行（型変換が安全な場合のみ）
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'approval_history'
      AND column_name  = 'operator_id'
  ) THEN
    UPDATE approval_history
      SET action_by = operator_id::uuid
      WHERE action_by IS NULL
        AND operator_id IS NOT NULL
        AND operator_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  END IF;

  -- memo → unlock_reason への移行
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'approval_history'
      AND column_name  = 'memo'
  ) THEN
    UPDATE approval_history
      SET unlock_reason = memo
      WHERE unlock_reason IS NULL AND memo IS NOT NULL;
  END IF;
END;
$$;

-- NOT NULL 制約付与（行データが揃った後に設定）
-- payment_notice_id: すでに NOT NULL なら no-op
DO $$
BEGIN
  -- payment_notice_id が nullable のままなら NOT NULL 化（データが0行 or 全行に値あり前提）
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'approval_history'
      AND column_name  = 'payment_notice_id'
      AND is_nullable  = 'YES'
  ) AND NOT EXISTS (
    SELECT 1 FROM approval_history WHERE payment_notice_id IS NULL
  ) THEN
    ALTER TABLE approval_history ALTER COLUMN payment_notice_id SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'approval_history'
      AND column_name  = 'action_by'
      AND is_nullable  = 'YES'
  ) AND NOT EXISTS (
    SELECT 1 FROM approval_history WHERE action_by IS NULL
  ) THEN
    ALTER TABLE approval_history ALTER COLUMN action_by SET NOT NULL;
  END IF;
END;
$$;

-- 旧列の削除（存在する場合のみ）
ALTER TABLE approval_history
  DROP COLUMN IF EXISTS target_type,
  DROP COLUMN IF EXISTS target_id,
  DROP COLUMN IF EXISTS operator_id,
  DROP COLUMN IF EXISTS amount_before,
  DROP COLUMN IF EXISTS amount_after,
  DROP COLUMN IF EXISTS memo;

-- 旧インデックスが残っている場合は削除
DROP INDEX IF EXISTS idx_approval_history_target;

-- 新インデックス（存在しない場合のみ）
CREATE INDEX IF NOT EXISTS idx_approval_history_notice ON approval_history(payment_notice_id);

-- ----------------------------------------------------------------
-- 2. payment_notices テーブル
-- ----------------------------------------------------------------

-- status カラム追加（有効値: 'locked' | 'approved'）
ALTER TABLE payment_notices
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'locked'
  CHECK (status IN ('locked', 'approved'));

