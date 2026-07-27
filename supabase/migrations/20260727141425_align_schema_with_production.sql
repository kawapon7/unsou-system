-- ================================================================
-- マイグレーション群と本番実スキーマの差分を埋める（事後追認）
--
-- 背景:
--   HIBIKIのDBはダッシュボードで先に作られ、マイグレーションが後追いで
--   書かれてきた。その結果、本番に存在するがマイグレーション群のどこにも
--   現れない列が15列残っていた（2026-07-27に本番の information_schema を
--   introspectして特定）。このままマイグレーションから新DBを作ると
--   これらの列が欠けたDBができる。
--
-- ⚠️ このファイルは「本番に合わせて書いた」ものであり、その逆ではない。
--    型・NULL可否・DEFAULT はすべて本番の実値をそのまま写している。
--    本番に対しては IF NOT EXISTS により完全な no-op になる。
--
-- ⚠️ 空テーブルへの ADD COLUMN ... NOT NULL（DEFAULTなし）は成功する。
--    既存行があるテーブルに対しては失敗するため、新DB構築時にのみ
--    通ることを前提とする（本番では既に列があるので no-op）。
-- ================================================================

-- ── アプリが実際に依存している列（欠けると機能が壊れる） ──────────

-- clients.is_invoice_registered
--   admin/partners/page.tsx が保存時にこの列名で書き込んでいる
--   （読み出しは invoice_registered / is_invoice_registered の両対応）
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_invoice_registered boolean NOT NULL DEFAULT false;

-- expense_records.category
--   pdfActions.ts が .select() で名指ししている。欠けると 42703 でPDFが停止。
--   ⚠️ NOT NULL かつ DEFAULT なし。driver/dashboard・voice-actions の
--      INSERT はこの列を渡していないため、新DBでは立替金登録が
--      NOT NULL 違反(23502)で失敗する。別タスクで要修正（下部の注記参照）。
ALTER TABLE public.expense_records
  ADD COLUMN IF NOT EXISTS category text NOT NULL;

-- invoices.total_amount_ex_tax
--   pdfActions.ts が .select() で名指ししている。
--   ⚠️ NOT NULL かつ DEFAULT なし。billing-actions.ts の invoices upsert は
--      この列を渡していない（別タスクで要修正・下部の注記参照）。
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS total_amount_ex_tax numeric(12,2) NOT NULL;

-- work_records.raw_spot_text
--   workRecordActions.ts が INSERT 時に書き込んでいる
ALTER TABLE public.work_records
  ADD COLUMN IF NOT EXISTS raw_spot_text text;

-- ── コード未参照だが本番に存在する列（完全一致のため追認） ──────────

ALTER TABLE public.expense_records
  ADD COLUMN IF NOT EXISTS is_approved_by_master boolean NOT NULL DEFAULT false;

ALTER TABLE public.work_records
  ADD COLUMN IF NOT EXISTS is_approved_by_master boolean NOT NULL DEFAULT false;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS is_issued boolean NOT NULL DEFAULT false;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS default_margin_rate numeric(5,2) DEFAULT 10.00;

ALTER TABLE public.project_payees
  ADD COLUMN IF NOT EXISTS share_rate numeric(5,2);

-- billing_records / payments はアプリから一度も参照されていない（0件ヒット）。
-- 将来の判断のため列だけ本番に合わせて追認しておく。
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS active_contractors_count integer NOT NULL,
  ADD COLUMN IF NOT EXISTS contractor_fee_total     integer NOT NULL,
  ADD COLUMN IF NOT EXISTS total_billing_amount     integer NOT NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS reward_amount_ex_tax  numeric(12,2) NOT NULL,
  ADD COLUMN IF NOT EXISTS expense_amount_total  numeric(12,2) NOT NULL,
  ADD COLUMN IF NOT EXISTS tax_amount            numeric(12,2) NOT NULL;

-- ── 制約名の一致（機能差はなく名前だけの差分） ──────────────────
-- 本番の payment_notices の UNIQUE(contractor_id, notice_month) は
-- `payment_notices_contractor_notice_month_uniq` という明示名で存在する。
-- initial_schema のインライン UNIQUE から作ると Postgres が
-- `payment_notices_contractor_id_notice_month_key` と自動命名するため、
-- 名前だけズレる。upsert は列名指定（onConflict: 'contractor_id,notice_month'）
-- なので機能影響はないが、以後の差分検出のノイズになるので揃えておく。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'payment_notices_contractor_id_notice_month_key')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'payment_notices_contractor_notice_month_uniq')
  THEN
    ALTER TABLE public.payment_notices
      RENAME CONSTRAINT payment_notices_contractor_id_notice_month_key
                     TO payment_notices_contractor_notice_month_uniq;
  END IF;
END $$;

-- ================================================================
-- ⚠️ このファイルでは直していない既知の不具合（本番にも存在する）
--
-- (A) invoices の upsert が壊れている（billing-actions.ts:149-162）
--     ① total_amount_ex_tax が NOT NULL / DEFAULTなし なのに渡していない
--        → 23502 not-null violation
--     ② onConflict: 'client_id,invoice_month' を指定しているが、本番の
--        invoices に UNIQUE(client_id, invoice_month) が存在しない
--        → 42P10 no unique constraint matching
--     本番の invoices は 0件。請求書生成は一度も成功していない可能性が高い。
--     支払通知書側で 2026-07-27 に直したのと同型の不具合。
--
-- (B) expense_records.category が NOT NULL / DEFAULTなし なのに
--     driver/dashboard/actions.ts と voice-actions.ts の INSERT が渡していない
--     → 新DBでは立替金登録が失敗する（現本番の19件は seed 経由で入っている）
--
-- どちらもスキーマ整合の問題ではなくコード側の不具合のため、別タスクとする。
-- ================================================================
