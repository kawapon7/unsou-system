-- テナント（契約している会社アカウント）の正体を持つマスタ。
-- 全テナント対象テーブルの tenant_id はこの id を参照する。
--
-- 設計判断（2026-07-27）:
--   companies は「自社＝請求書の発行元情報」の表であり、テナントそのものではない。
--   companies をテナントマスタ兼用にすると
--     1) 契約はしたが自社情報未登録のテナントを表現できない
--     2) 契約プラン・停止フラグなどテナント単位の情報の置き場が無い
--   ため、テナントの正体は独立した表に持たせる。
--   「1テナント＝1社」は companies.tenant_id の UNIQUE 制約で引き続き保証する。
BEGIN;

CREATE TABLE IF NOT EXISTS public.tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- アプリは service_role で動くため RLS は素通りするが、
-- anon/authenticated からの直接アクセスを塞ぐため有効化しておく（F1でポリシーを本格化）。
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- A社（既存の単一テナント）。id は固定値で発番する。
INSERT INTO public.tenants (id, name)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'A社')
ON CONFLICT (id) DO NOTHING;

COMMIT;
