-- 支払通知書の「調整」を手入力できるようにする
--
-- 実物の支払明細書には「調整」の行がある。システムには税込思考業者向けの自動端数補正
-- （calcPayeeAmount / project_payees.adjustment_enabled）しか無く、親分が手で ±円 を
-- 入れる手段が無かった（書き込みは 0 固定）。
--
-- ⚠️ adjustment_amount には「実際に適用した調整（自動＋手動）」を入れる。
--    PDF・一覧・total_amount はこの列だけを見ればよい（計算式を分岐させない）。
-- ⚠️ manual_adjustment は手動分だけを残す監査・再編集用。合計計算には直接使わない。

ALTER TABLE public.payment_notices
  ADD COLUMN IF NOT EXISTS manual_adjustment numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payment_notices.manual_adjustment IS
  '手入力の調整額（±）。adjustment_amount には自動端数補正と合算した実適用額が入る';
