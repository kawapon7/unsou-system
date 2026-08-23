-- 委託先マスタに「自社区分」を追加（2026-08-23）
-- is_internal = true: 代表者・従業員など自社の人員。
--   税務上、自社への支払は外注費ではない（法人: 役員給与=法人税法34条、消費税: 給与等は課税仕入れ外=消費税法2条1項12号）。
--   よって支払通知書・インボイス警告・支払(OUT)集計・経過措置計算の対象外にする。
--   予定・実績・売上(IN)には通常どおり載せる（荷主への請求は自社売上）。
-- 根拠: docs/research/2026-08-22-owner-driver-tax-treatment.md
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contractors.is_internal IS
  '自社区分（代表者・従業員）。true の場合は支払通知書・OUT集計の対象外';
