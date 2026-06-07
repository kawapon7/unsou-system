-- ================================================================
-- スキーマ整合性修正マイグレーション v1.9
-- Actions実装とinitial_schemaのカラム名・不足カラムを解消する
-- ================================================================

-- ----------------------------------------------------------------
-- contractors テーブル
-- ----------------------------------------------------------------
-- show_detail_switch → detailed_input_switch のエイリアス追加
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS show_detail_switch BOOLEAN NOT NULL DEFAULT FALSE;
-- invoice_status / invoice_number エイリアス追加
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS invoice_status TEXT;
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS invoice_number TEXT;
-- has_withholding エイリアス追加
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS has_withholding BOOLEAN NOT NULL DEFAULT FALSE;
-- branch_name エイリアス追加（スキーマは bank_branch）
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS branch_name TEXT;
-- email エイリアス追加（スキーマは login_email）
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS email TEXT;

-- ----------------------------------------------------------------
-- clients テーブル
-- ----------------------------------------------------------------
-- name エイリアス追加（スキーマは company_name NOT NULL）
ALTER TABLE clients ADD COLUMN IF NOT EXISTS name TEXT;
-- tax_treatment エイリアス追加（スキーマは tax_type）
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_treatment TEXT;
-- has_invoice エイリアス追加（スキーマは invoice_registered）
ALTER TABLE clients ADD COLUMN IF NOT EXISTS has_invoice BOOLEAN NOT NULL DEFAULT FALSE;
-- branch_name エイリアス追加（スキーマは bank_branch）
ALTER TABLE clients ADD COLUMN IF NOT EXISTS branch_name TEXT;
-- closing_day を INTEGER でも受け付けられるよう INTEGER カラム追加
ALTER TABLE clients ADD COLUMN IF NOT EXISTS closing_day_int INTEGER;

-- ----------------------------------------------------------------
-- projects テーブル
-- ----------------------------------------------------------------
-- name エイリアス追加（スキーマは project_name NOT NULL）
ALTER TABLE projects ADD COLUMN IF NOT EXISTS name TEXT;
-- project_code が存在する場合はDEFAULTを設定、存在しない場合はNULLABLEで追加
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_code TEXT;

-- ----------------------------------------------------------------
-- price_rules テーブル
-- ----------------------------------------------------------------
-- sales_price / buying_price / calculation_type エイリアス追加
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS sales_price NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS buying_price NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS calculation_type TEXT;
-- margin系カラム追加
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS margin_rate NUMERIC(5,2) NOT NULL DEFAULT 10;
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS margin_fixed NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------
-- work_records テーブル
-- ----------------------------------------------------------------
-- date エイリアス追加（スキーマは work_date NOT NULL）
ALTER TABLE work_records ADD COLUMN IF NOT EXISTS date DATE;
-- status エイリアス追加（スキーマは approval_status）
ALTER TABLE work_records ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
-- note エイリアス追加（スキーマは memo）
ALTER TABLE work_records ADD COLUMN IF NOT EXISTS note TEXT;
-- 時刻・休憩カラム追加（子分アプリ用）
ALTER TABLE work_records ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE work_records ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE work_records ADD COLUMN IF NOT EXISTS break_minutes INTEGER NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------
-- expense_records テーブル（初期スキーマ vs 新マイグレーション vs Actions の差異）
-- ----------------------------------------------------------------
-- Actions/driverが使うカラム名に合わせてエイリアス追加
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- ----------------------------------------------------------------
-- invoices テーブル（Actions が使う集計カラムを追加）
-- ----------------------------------------------------------------
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS target_month TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal_registered NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_registered NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal_unregistered NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_unregistered NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deduction_unregistered NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal_exempt NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_excluding_tax NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_tax NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_deduction NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------
-- payment_notices テーブル（Actions が使う集計カラムを追加）
-- ----------------------------------------------------------------
ALTER TABLE payment_notices ADD COLUMN IF NOT EXISTS target_month TEXT;
ALTER TABLE payment_notices ADD COLUMN IF NOT EXISTS subtotal_registered NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_notices ADD COLUMN IF NOT EXISTS tax_registered NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_notices ADD COLUMN IF NOT EXISTS subtotal_unregistered NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_notices ADD COLUMN IF NOT EXISTS tax_unregistered NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_notices ADD COLUMN IF NOT EXISTS deduction_unregistered NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_notices ADD COLUMN IF NOT EXISTS subtotal_exempt NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_notices ADD COLUMN IF NOT EXISTS total_excluding_tax NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_notices ADD COLUMN IF NOT EXISTS total_tax NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_notices ADD COLUMN IF NOT EXISTS total_deduction NUMERIC(12,2) NOT NULL DEFAULT 0;
