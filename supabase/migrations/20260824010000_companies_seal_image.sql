-- 自社情報に印影（社判）画像を持たせる。請求書（導入先様式）に印字する。
-- 形式: data URL（'data:image/png;base64,...'）。Storage ではなく列に持つ理由:
--   ①1テナント1枚・数十KBで、テナント隔離は companies の既存RLSがそのまま効く
--   ②PDF はブラウザ描画のため data URL をそのまま <img> に渡せる（署名URL発行が要らない）
--   ③発行控えのスナップショットに当時の印影が含まれる（後から差し替えても控えは変わらない）
-- ⚠️ サイズ上限（約300KB）はサーバー側（settings/company/actions.ts）で検証する。
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS seal_image text;
COMMENT ON COLUMN public.companies.seal_image IS '印影（社判）PNG の data URL。請求書に印字。NULL は未登録';
