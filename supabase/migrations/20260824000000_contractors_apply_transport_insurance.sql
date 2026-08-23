-- 委託先ごとに運送保険（荷物保険）−1,000円の控除を適用するかどうか（2026-08-24）
-- 作業系（デバンニング等）の委託先は荷物を運ばないため保険の控除が無い。
-- 既定 true: 既存委託先は従来どおり全員控除（挙動を変えない）。作業系だけ画面で false にする。
-- 金額自体は companies.transport_insurance_amount（全社一律）のまま。
-- ⚠️ 本番適用後、確定済み payment_notices.insurance_deduction（スナップショット）は変わらない。
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS apply_transport_insurance BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.contractors.apply_transport_insurance IS
  '運送保険（荷物保険）の控除を支払通知書に適用するか。作業系委託先は false';
