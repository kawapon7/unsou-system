-- ================================================================
-- users.tenant_id の追加（RLS テナント基準化 P0）
-- 背景: docs/superpowers/specs/2026-08-23-rls-tenant-inventory.md
--   public.users に tenant_id が無く、owner（contractor_id NULL）はテナントを辿れなかった。
--   getCurrentTenantId() は app_metadata.tenant_id → users.tenant_id の順で解決するようにする。
-- ⚠️ 追加のみ（既存列の変更なし）。試験運用中に適用しても既存動作は壊れない。
-- ⚠️ DDL は MCP からブロックされる。Supabase ダッシュボード SQL Editor で手動適用し、
--    supabase_migrations.schema_migrations に version を記録すること。
-- ================================================================
BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users (tenant_id);

-- backfill 1: ドライバーは contractors 経由で確定
UPDATE public.users u
   SET tenant_id = c.tenant_id
  FROM public.contractors c
 WHERE u.contractor_id = c.id
   AND u.tenant_id IS NULL;

-- backfill 2: email で contractors と一致するもの（contractor_id 未設定のドライバー）
UPDATE public.users u
   SET tenant_id = c.tenant_id
  FROM public.contractors c
 WHERE u.tenant_id IS NULL
   AND c.email IS NOT NULL
   AND c.email = u.email;

-- backfill 3: テナントが 1 つしか無い間は、残り全員（owner）をそのテナントに紐づける
-- ⚠️ 2 テナント目を作った後にこの migration を初適用すると owner が未紐づけのまま残る。
--    その場合は web/scripts/set-production-tenant.mjs で app_metadata を設定するか、
--    UPDATE public.users SET tenant_id = '<uuid>' WHERE email = '<email>'; を手で流す。
UPDATE public.users
   SET tenant_id = (SELECT id FROM public.tenants LIMIT 1)
 WHERE tenant_id IS NULL
   AND (SELECT count(*) FROM public.tenants) = 1;

COMMIT;

-- 適用後の確認（未紐づけが 0 件であること）:
--   SELECT email, role, tenant_id FROM public.users WHERE tenant_id IS NULL;
