-- ================================================================
-- 帳票発行の土台: 採番・発行控え・取消/再発行履歴
-- 要件: docs/superpowers/specs/2026-08-23-client-format-documents-design.md §4 §5 §7-1
-- 計画: docs/superpowers/plans/2026-08-23-document-issuance-foundation.md
-- ⚠️ DDL は MCP からブロックされる。Supabase ダッシュボード SQL Editor で手動適用し、
--    supabase_migrations.schema_migrations に version を記録すること。
-- ================================================================
BEGIN;

-- 1. 会社設定: 採番書式と標準様式キー
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS invoice_number_format text NOT NULL DEFAULT 'INV-{YYYY}{MM}-{SEQ:4}',
  ADD COLUMN IF NOT EXISTS document_format_key  text NOT NULL DEFAULT 'standard';

-- 2. 荷主設定: 荷主指定様式（NULL = 会社の標準様式を使う）
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS document_format_key text;

-- 3. 採番カウンタ（テナント×種別×期間）
CREATE TABLE IF NOT EXISTS public.document_sequences (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id),
  kind       text NOT NULL CHECK (kind IN ('invoice','payment_notice')),
  period_key text NOT NULL,
  last_no    integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind, period_key)
);
ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;
-- authenticated 向けポリシーを置かない = service_role（Server Action）専用

-- 原子的に次番号を返す。同時発行でも重複しない（行ロック）。
CREATE OR REPLACE FUNCTION public.next_document_sequence(
  p_tenant_id uuid, p_kind text, p_period_key text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_no integer;
BEGIN
  INSERT INTO public.document_sequences (tenant_id, kind, period_key, last_no)
  VALUES (p_tenant_id, p_kind, p_period_key, 1)
  ON CONFLICT (tenant_id, kind, period_key)
  DO UPDATE SET last_no = public.document_sequences.last_no + 1, updated_at = now()
  RETURNING last_no INTO v_no;
  RETURN v_no;
END;
$$;
REVOKE ALL ON FUNCTION public.next_document_sequence(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_document_sequence(uuid, text, text) TO service_role;

-- 4. 発行控え（電帳法: 日付・相手先・金額で検索可能。様式キー・版を記録）
CREATE TABLE IF NOT EXISTS public.issued_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
  kind            text NOT NULL CHECK (kind IN ('invoice','payment_notice')),
  source_id       uuid NOT NULL,          -- invoices.id または payment_notices.id
  contractor_id   uuid REFERENCES public.contractors(id),  -- 支払通知書のみ。ドライバー本人閲覧用
  document_number text NOT NULL,
  format_key      text NOT NULL,
  format_version  integer NOT NULL,
  status          text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','cancelled')),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  issued_by       uuid NOT NULL REFERENCES public.users(id),
  cancelled_at    timestamptz,
  cancelled_by    uuid REFERENCES public.users(id),
  cancel_reason   text,
  superseded_by   uuid REFERENCES public.issued_documents(id),
  party_name      text NOT NULL,          -- 相手先名（検索用）
  document_date   date NOT NULL,          -- 発行日（検索用）
  total_amount    numeric NOT NULL,       -- 税込合計（検索用）
  snapshot        jsonb NOT NULL,         -- 描画用データ（InvoicePdfData / PaymentNoticePdfData）
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);
-- 同じ元データに有効な控えは1件まで（取消してから再発行する）
CREATE UNIQUE INDEX IF NOT EXISTS issued_documents_active_source
  ON public.issued_documents (tenant_id, kind, source_id) WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS idx_issued_documents_tenant_date  ON public.issued_documents (tenant_id, document_date);
CREATE INDEX IF NOT EXISTS idx_issued_documents_tenant_party ON public.issued_documents (tenant_id, party_name);

-- 控えは「取消」以外の更新と削除を禁止（全ロール）
CREATE OR REPLACE FUNCTION public.guard_issued_documents_modification()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '発行控え（issued_documents）の削除は禁止されています。取消で対応してください。';
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind
     OR NEW.source_id <> OLD.source_id OR NEW.document_number <> OLD.document_number
     OR NEW.format_key <> OLD.format_key OR NEW.format_version <> OLD.format_version
     OR NEW.issued_at <> OLD.issued_at OR NEW.issued_by <> OLD.issued_by
     OR NEW.party_name <> OLD.party_name OR NEW.document_date <> OLD.document_date
     OR NEW.total_amount <> OLD.total_amount OR NEW.snapshot <> OLD.snapshot
     OR OLD.status = 'cancelled' THEN
    RAISE EXCEPTION '発行控え（issued_documents）は取消以外の変更が禁止されています。';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_issued_documents_guard_update ON public.issued_documents;
DROP TRIGGER IF EXISTS trg_issued_documents_guard_delete ON public.issued_documents;
CREATE TRIGGER trg_issued_documents_guard_update BEFORE UPDATE ON public.issued_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_issued_documents_modification();
CREATE TRIGGER trg_issued_documents_guard_delete BEFORE DELETE ON public.issued_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_issued_documents_modification();

ALTER TABLE public.issued_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS issued_documents_owner_select ON public.issued_documents;
CREATE POLICY issued_documents_owner_select ON public.issued_documents
  FOR SELECT TO authenticated USING (internal.is_owner());
DROP POLICY IF EXISTS issued_documents_contractor_select ON public.issued_documents;
CREATE POLICY issued_documents_contractor_select ON public.issued_documents
  FOR SELECT TO authenticated
  USING ((NOT internal.is_owner()) AND kind = 'payment_notice' AND contractor_id = internal.my_contractor_id());
-- INSERT/UPDATE は service_role（Server Action）のみ

-- 5. 発行履歴（不変ログ: INSERT のみ）
CREATE TABLE IF NOT EXISTS public.document_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id),
  issued_document_id uuid NOT NULL REFERENCES public.issued_documents(id),
  action_type        text NOT NULL CHECK (action_type IN ('issued','cancelled','reissued')),
  action_by          uuid NOT NULL REFERENCES public.users(id),
  reason             text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_document_history_doc ON public.document_history (issued_document_id);
CREATE OR REPLACE FUNCTION public.prevent_document_history_modification()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '発行履歴（document_history）の変更・削除は禁止されています。';
END;
$$;
DROP TRIGGER IF EXISTS trg_document_history_no_update ON public.document_history;
DROP TRIGGER IF EXISTS trg_document_history_no_delete ON public.document_history;
CREATE TRIGGER trg_document_history_no_update BEFORE UPDATE ON public.document_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_document_history_modification();
CREATE TRIGGER trg_document_history_no_delete BEFORE DELETE ON public.document_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_document_history_modification();
ALTER TABLE public.document_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_history_owner_select ON public.document_history;
CREATE POLICY document_history_owner_select ON public.document_history
  FOR SELECT TO authenticated USING (internal.is_owner());

COMMIT;
