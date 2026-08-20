-- align_with_production_actual: 空DBへ56本適用した結果と本番実スキーマの差分を是正する。
-- 全操作はガード付き。既に目標状態のDB(=現行本番)に流れた場合は no-op になる。
-- ⚠️ 型変更の USING NULL は「型が違うときだけ」実行される設計。データのある本番では型が既に一致しているため走らない。
BEGIN;

-- 1) 本番に存在しないトリガーの削除
DROP TRIGGER IF EXISTS trg_billing_records_updated_at ON public.billing_records;
DROP TRIGGER IF EXISTS trg_clients_updated_at ON public.clients;
DROP TRIGGER IF EXISTS trg_contractors_updated_at ON public.contractors;
DROP TRIGGER IF EXISTS trg_expense_records_updated_at ON public.expense_records;
DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
DROP TRIGGER IF EXISTS trg_project_payees_updated_at ON public.project_payees;
DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
DROP TRIGGER IF EXISTS trg_work_records_updated_at ON public.work_records;

-- 2) 本番に存在しないポリシーの削除
DROP POLICY IF EXISTS project_payees_contractor_select ON public.project_payees;

-- 3) 本番に存在しない制約の削除
ALTER TABLE public.approval_history DROP CONSTRAINT IF EXISTS approval_history_action_by_fkey;
ALTER TABLE public.billing_records DROP CONSTRAINT IF EXISTS billing_records_billing_month_key;
ALTER TABLE public.contractors DROP CONSTRAINT IF EXISTS contractors_login_email_key;
ALTER TABLE public.payment_notices DROP CONSTRAINT IF EXISTS payment_notices_status_check;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_notice_id_fkey;
ALTER TABLE public.project_payees DROP CONSTRAINT IF EXISTS project_payees_payee_contractor_id_fkey;
ALTER TABLE public.project_payees DROP CONSTRAINT IF EXISTS project_payees_via_contractor_id_fkey;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_project_code_key;
ALTER TABLE public.work_records DROP CONSTRAINT IF EXISTS work_records_project_id_fkey;

-- 4) 本番に存在しないインデックスの削除
DROP INDEX IF EXISTS public.billing_records_billing_month_key;
DROP INDEX IF EXISTS public.contractors_login_email_key;
DROP INDEX IF EXISTS public.idx_expense_records_contractor_id;
DROP INDEX IF EXISTS public.idx_expense_records_expense_date;
DROP INDEX IF EXISTS public.idx_invoices_client_month;
DROP INDEX IF EXISTS public.idx_payment_notices_contractor;
DROP INDEX IF EXISTS public.idx_work_records_contractor_id;
DROP INDEX IF EXISTS public.idx_work_records_project_id;
DROP INDEX IF EXISTS public.idx_work_records_spot_generic_id;
DROP INDEX IF EXISTS public.idx_work_records_work_date;
DROP INDEX IF EXISTS public.projects_project_code_key;

-- 5) 本番に存在しない列の削除（ダッシュボードで削除済みだった旧列）
ALTER TABLE public.billing_records DROP COLUMN IF EXISTS active_contractor_count;
ALTER TABLE public.billing_records DROP COLUMN IF EXISTS billing_month;
ALTER TABLE public.billing_records DROP COLUMN IF EXISTS per_contractor_fee;
ALTER TABLE public.billing_records DROP COLUMN IF EXISTS status;
ALTER TABLE public.billing_records DROP COLUMN IF EXISTS total_fee;
ALTER TABLE public.billing_records DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.clients DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.contractors DROP COLUMN IF EXISTS detailed_input_switch;
ALTER TABLE public.contractors DROP COLUMN IF EXISTS invoice_registration_number;
ALTER TABLE public.contractors DROP COLUMN IF EXISTS login_email;
ALTER TABLE public.contractors DROP COLUMN IF EXISTS payment_method;
ALTER TABLE public.contractors DROP COLUMN IF EXISTS tax_type;
ALTER TABLE public.contractors DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.contractors DROP COLUMN IF EXISTS withholding_tax_flag;
ALTER TABLE public.expense_records DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.payments DROP COLUMN IF EXISTS payment_date;
ALTER TABLE public.payments DROP COLUMN IF EXISTS payment_month;
ALTER TABLE public.payments DROP COLUMN IF EXISTS payment_notice_id;
ALTER TABLE public.payments DROP COLUMN IF EXISTS status;
ALTER TABLE public.payments DROP COLUMN IF EXISTS total_amount;
ALTER TABLE public.payments DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.price_rules DROP COLUMN IF EXISTS buy_unit_price;
ALTER TABLE public.price_rules DROP COLUMN IF EXISTS calc_type;
ALTER TABLE public.price_rules DROP COLUMN IF EXISTS effective_from;
ALTER TABLE public.price_rules DROP COLUMN IF EXISTS effective_to;
ALTER TABLE public.price_rules DROP COLUMN IF EXISTS sale_unit_price;
ALTER TABLE public.project_payees DROP COLUMN IF EXISTS payee_contractor_id;
ALTER TABLE public.project_payees DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.project_payees DROP COLUMN IF EXISTS via_contractor_id;
ALTER TABLE public.users DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.work_records DROP COLUMN IF EXISTS approval_status;
ALTER TABLE public.work_records DROP COLUMN IF EXISTS memo;
ALTER TABLE public.work_records DROP COLUMN IF EXISTS quantity;
ALTER TABLE public.work_records DROP COLUMN IF EXISTS spot_generic_id;
ALTER TABLE public.work_records DROP COLUMN IF EXISTS tax_excluded_payment;
ALTER TABLE public.work_records DROP COLUMN IF EXISTS tax_excluded_sales;
ALTER TABLE public.work_records DROP COLUMN IF EXISTS updated_at;

-- 6) 本番にあるがマイグレーション未記録だった列の追加
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS target_month date NOT NULL;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS target_month date NOT NULL;
ALTER TABLE public.project_payees ADD COLUMN IF NOT EXISTS contractor_id uuid NOT NULL;
ALTER TABLE public.work_records ADD COLUMN IF NOT EXISTS piece_count integer DEFAULT 0;

-- 7) 型・デフォルト・NOT NULL の是正（型変更は現在型が違うときのみ実行）
ALTER TABLE public.approval_history ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.billing_records ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='clients' AND column_name='closing_day') <> 'integer' THEN
    ALTER TABLE public.clients ALTER COLUMN closing_day DROP DEFAULT;
    ALTER TABLE public.clients ALTER COLUMN closing_day TYPE integer USING NULL::integer;
  END IF;
END $$;
ALTER TABLE public.clients ALTER COLUMN closing_day DROP DEFAULT;
ALTER TABLE public.clients ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.clients ALTER COLUMN invoice_registered DROP DEFAULT;
ALTER TABLE public.clients ALTER COLUMN invoice_registered DROP NOT NULL;
ALTER TABLE public.clients ALTER COLUMN payment_site DROP DEFAULT;
ALTER TABLE public.clients ALTER COLUMN tax_type DROP DEFAULT;
ALTER TABLE public.contractors ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.contractors ALTER COLUMN email SET NOT NULL;
ALTER TABLE public.contractors ALTER COLUMN invoice_registration_type DROP DEFAULT;
ALTER TABLE public.contractors ALTER COLUMN payment_site DROP DEFAULT;
ALTER TABLE public.contractors ALTER COLUMN payment_type DROP DEFAULT;
ALTER TABLE public.contractors ALTER COLUMN tax_category DROP DEFAULT;
ALTER TABLE public.expense_records ALTER COLUMN amount DROP DEFAULT;
ALTER TABLE public.expense_records ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.expense_records ALTER COLUMN expense_type SET DEFAULT 'other'::text;
ALTER TABLE public.expense_records ALTER COLUMN tax_category SET DEFAULT 'exclusive'::text;
ALTER TABLE public.invoices ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.invoices ALTER COLUMN invoice_month SET DEFAULT CURRENT_DATE;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='invoices' AND column_name='target_month') <> 'date' THEN
    ALTER TABLE public.invoices ALTER COLUMN target_month DROP DEFAULT;
    ALTER TABLE public.invoices ALTER COLUMN target_month TYPE date USING NULL::date;
  END IF;
END $$;
ALTER TABLE public.invoices ALTER COLUMN target_month DROP DEFAULT;
ALTER TABLE public.invoices ALTER COLUMN target_month SET NOT NULL;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='invoices' AND column_name='total_amount') <> 'numeric' THEN
    ALTER TABLE public.invoices ALTER COLUMN total_amount DROP DEFAULT;
    ALTER TABLE public.invoices ALTER COLUMN total_amount TYPE numeric USING NULL::numeric;
  END IF;
END $$;
ALTER TABLE public.invoices ALTER COLUMN total_amount SET DEFAULT 0;
ALTER TABLE public.invoices ALTER COLUMN total_tax DROP DEFAULT;
ALTER TABLE public.payment_notices ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.payment_notices ALTER COLUMN notice_month SET DEFAULT CURRENT_DATE;
ALTER TABLE public.payment_notices ALTER COLUMN status DROP DEFAULT;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='payment_notices' AND column_name='target_month') <> 'date' THEN
    ALTER TABLE public.payment_notices ALTER COLUMN target_month DROP DEFAULT;
    ALTER TABLE public.payment_notices ALTER COLUMN target_month TYPE date USING NULL::date;
  END IF;
END $$;
ALTER TABLE public.payment_notices ALTER COLUMN target_month DROP DEFAULT;
ALTER TABLE public.payment_notices ALTER COLUMN target_month SET NOT NULL;
ALTER TABLE public.payments ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.price_rules ALTER COLUMN buying_price DROP DEFAULT;
ALTER TABLE public.price_rules ALTER COLUMN calculation_type SET NOT NULL;
ALTER TABLE public.price_rules ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.price_rules ALTER COLUMN selling_price DROP DEFAULT;
ALTER TABLE public.project_payees ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.projects ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.projects ALTER COLUMN project_code DROP NOT NULL;
ALTER TABLE public.users ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.work_records ALTER COLUMN break_minutes DROP NOT NULL;
ALTER TABLE public.work_records ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='work_records' AND column_name='end_time') <> 'timestamp with time zone' THEN
    ALTER TABLE public.work_records ALTER COLUMN end_time DROP DEFAULT;
    ALTER TABLE public.work_records ALTER COLUMN end_time TYPE timestamp with time zone USING NULL::timestamp with time zone;
  END IF;
END $$;
ALTER TABLE public.work_records ALTER COLUMN end_time DROP DEFAULT;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='work_records' AND column_name='start_time') <> 'timestamp with time zone' THEN
    ALTER TABLE public.work_records ALTER COLUMN start_time DROP DEFAULT;
    ALTER TABLE public.work_records ALTER COLUMN start_time TYPE timestamp with time zone USING NULL::timestamp with time zone;
  END IF;
END $$;
ALTER TABLE public.work_records ALTER COLUMN start_time DROP DEFAULT;

-- 8) 本番にある制約の追加
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approval_history_action_by_fkey'
                 AND conrelid='public.approval_history'::regclass) THEN
    ALTER TABLE public.approval_history ADD CONSTRAINT approval_history_action_by_fkey FOREIGN KEY (action_by) REFERENCES users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clients_tax_type_check'
                 AND conrelid='public.clients'::regclass) THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_tax_type_check CHECK ((tax_type = ANY (ARRAY['exclusive'::text, 'inclusive'::text, 'tax_exempt'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contractors_user_id_fkey'
                 AND conrelid='public.contractors'::regclass) THEN
    ALTER TABLE public.contractors ADD CONSTRAINT contractors_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payment_notices_status_check'
                 AND conrelid='public.payment_notices'::regclass) THEN
    ALTER TABLE public.payment_notices ADD CONSTRAINT payment_notices_status_check CHECK ((status = ANY (ARRAY['unapproved'::text, 'approved'::text, 'locked'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='price_rules_calculation_type_check'
                 AND conrelid='public.price_rules'::regclass) THEN
    ALTER TABLE public.price_rules ADD CONSTRAINT price_rules_calculation_type_check CHECK ((calculation_type = ANY (ARRAY['hourly'::text, 'piece'::text, 'fixed'::text, 'hybrid'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='project_payees_contractor_id_fkey'
                 AND conrelid='public.project_payees'::regclass) THEN
    ALTER TABLE public.project_payees ADD CONSTRAINT project_payees_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES contractors(id) ON DELETE RESTRICT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_role_check'
                 AND conrelid='public.users'::regclass) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['master'::text, 'sub'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='work_records_project_id_fkey'
                 AND conrelid='public.work_records'::regclass) THEN
    ALTER TABLE public.work_records ADD CONSTRAINT work_records_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 9) 本番にあるポリシーの追加（drop→create で冪等化）
DROP POLICY IF EXISTS notification_logs_authenticated_insert ON public.notification_logs;
CREATE POLICY notification_logs_authenticated_insert ON public.notification_logs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS notification_logs_authenticated_select ON public.notification_logs;
CREATE POLICY notification_logs_authenticated_select ON public.notification_logs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS project_payees_contractor_select ON public.project_payees;
CREATE POLICY project_payees_contractor_select ON public.project_payees FOR SELECT TO authenticated USING ((NOT internal.is_owner()));
DROP POLICY IF EXISTS schedules_authenticated_all ON public.schedules;
CREATE POLICY schedules_authenticated_all ON public.schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
