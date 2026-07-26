-- 自社（請求書発行元）マスタ: companies テーブルの拡張。
--
-- 背景:
--   請求書・支払通知書PDFの発行元情報が各テンプレートに定数でハードコードされ、
--   NEXT_PUBLIC_COMPANY_* 環境変数でのみ上書きできる作りだった。
--   1) 未設定のため本番で仮の登録番号 T0000000000000 が印字されていた
--   2) NEXT_PUBLIC_* はビルド時に焼き込まれるため1デプロイ＝1社分しか持てず、
--      B社導入時にA社の会社名がB社の請求書に出る
--   これを解消するため、自社情報をDBに持たせる。
--
-- 設計書: docs/superpowers/specs/2026-07-26-company-master-design.md
--
-- 1テナント＝1社。tenant_id の UNIQUE 制約で2行目を作れないようにする。
-- 口座情報（bank_name / bank_branch / account_number / account_holder）は
-- アプリ側で AES-256-GCM 暗号化してから保存する。
-- account_type は utils/crypto.ts の BANK_FIELD_KEYS 対象外のため平文保存
-- （既存の clients / contractors と同じ扱い）。
--
-- 安全性: 適用時点でレコード0件のため、列追加によるデータ変換は発生しない。

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS tenant_id          text,
  ADD COLUMN IF NOT EXISTS invoice_reg_number text,
  ADD COLUMN IF NOT EXISTS postal_code        text,
  ADD COLUMN IF NOT EXISTS address            text,
  ADD COLUMN IF NOT EXISTS phone              text,
  ADD COLUMN IF NOT EXISTS email              text,
  ADD COLUMN IF NOT EXISTS bank_name          text,
  ADD COLUMN IF NOT EXISTS bank_branch        text,
  ADD COLUMN IF NOT EXISTS account_type       text,
  ADD COLUMN IF NOT EXISTS account_number     text,
  ADD COLUMN IF NOT EXISTS account_holder     text,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz DEFAULT now();

ALTER TABLE public.companies
  ADD CONSTRAINT companies_tenant_id_unique UNIQUE (tenant_id);
