-- ================================================================
-- invoices に UNIQUE(client_id, invoice_month) を追加
-- ----------------------------------------------------------------
-- 背景:
--   billing-actions.ts の請求書生成は
--     .upsert(..., { onConflict: 'client_id,invoice_month' })
--   を使っているが、invoices には対応する一意制約が存在しなかったため
--   42P10 (no unique or exclusion constraint matching the ON CONFLICT
--   specification) で必ず失敗していた。本番の invoices は 0 行で、
--   UI 経由で一度も成功していない。
--
--   同時に target_month / total_amount_ex_tax / total_tax（旧列・NOT NULL・
--   DEFAULT なし）を渡していなかったため 23502 にもなっていた。
--   そちらはコード側（billing-actions.ts）で修正済み。
--
-- 安全性:
--   適用時点で invoices は 0 行のため、重複による制約追加失敗は起きない。
--   ⚠️ 将来この行が増えた状態で再適用する場合は、先に重複を確認すること。
--
--   ADD CONSTRAINT は IF NOT EXISTS を取れないため DO ブロックでガードする。
--   （ガード無しの ADD CONSTRAINT は再適用で必ず失敗する。2026-07-27 の
--     companies_tenant_id_unique で同じ問題を踏んでいる）
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname  = 'invoices_client_id_invoice_month_key'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_client_id_invoice_month_key
      UNIQUE (client_id, invoice_month);
  END IF;
END $$;
