-- 取引先の部署分割対応。
--
-- 背景:
--   取引先（株式会社エス.アール.シー）が同一会社でありながら部署ごとに
--   請求書を分けて提出することを求めている。
--   部署ごとに異なるのは担当者・連絡先のみで、締め日・支払サイト・振込先口座・
--   インボイス登録番号・税区分はすべて会社で共通（ボス確認済み 2026-07-29）。
--   そのため部署は clients の複製ではなく、独立した子テーブルとして持つ。
--
-- 安全性: 追加のみ。既存の荷主・案件・請求書は
--   use_departments = false / department_id = NULL のまま従来どおり動作する。
--   データ移行は発生しない。
--
-- ⚠️ tenant_id は text。uuid にしてはならない。
--   （2026-07-26 に driver_project_assignments を uuid で作り、
--     'local-dev' の INSERT が invalid input syntax for type uuid で
--     必ず失敗した事故と同型）

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_departments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  name         text NOT NULL,
  contact_name text,
  email        text,
  phone        text,
  sort_order   int  NOT NULL DEFAULT 0,
  tenant_id    text NOT NULL DEFAULT 'local-dev',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_departments_client_id_idx
  ON public.client_departments (client_id);

-- RLS: deny-by-default（ポリシーを 1 件も作らない）。
--   アプリのDBアクセスは全て Server Actions のサービスロール経由で、
--   service_role は RLS を常にバイパスするため service 用ポリシーは不要。
--   ⚠️ 計画書には "service role full access" FOR ALL USING(true) を作る記述があるが、
--   これは role 指定が無いため public（anon/authenticated）に開いてしまい、
--   20260627000000_rls_tighten_5tables.sql で全廃した緩いポリシーと同型になる。
--   意図的に採用しない。
ALTER TABLE public.client_departments ENABLE ROW LEVEL SECURITY;

-- 部署分割を使うかどうかのフラグ（後から変更可能）
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS use_departments boolean NOT NULL DEFAULT false;

-- 案件がどの部署に属するか
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS department_id uuid
  REFERENCES public.client_departments(id) ON DELETE SET NULL;

-- 請求書がどの部署のものか。
-- ON DELETE RESTRICT: 確定済み請求書がぶら下がっている部署を消せなくする
-- （取引先に提出した紙の根拠が消えるのを防ぐ）
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS department_id uuid
  REFERENCES public.client_departments(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS projects_department_id_idx
  ON public.projects (department_id);
CREATE INDEX IF NOT EXISTS invoices_department_id_idx
  ON public.invoices (department_id);

COMMIT;
