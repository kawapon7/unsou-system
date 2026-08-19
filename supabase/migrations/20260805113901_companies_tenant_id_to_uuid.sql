-- companies.tenant_id を text → uuid へ変換し、tenants(id) を参照させる。
--
-- 背景: companies は 2026-07-26 の自社マスタ実装で tenant_id text UNIQUE を得たが、
--       テナント統一(uuid)より前に作られたため型が揃っていない。
-- 安全性: 行が存在する場合も値は 'local-dev' のみの想定のため、先にA社UUIDへ書き換えてから変換する
--         （0行なら UPDATE は空振りするだけで無害）。
BEGIN;

UPDATE public.companies
SET tenant_id = '00000000-0000-0000-0000-0000000000a1'
WHERE tenant_id = 'local-dev';

ALTER TABLE public.companies
  ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

COMMIT;
