-- 運送保険料（委託先負担・全社一律）の相殺に対応する
--
-- 実物の支払明細書には「相殺額」の中に「運送保険（非課税）」の行があり、
-- 全委託先が一律 1,000 円を負担している（保険契約者は自社）。
-- この項目はコード上に存在せず（`insurance` の一致は0件）、支払額が実物と食い違っていた。
--
-- ⚠️ 非課税項目なので消費税の対象にしない。相殺額合計【③】にのみ積む。
-- ⚠️ 経過措置（2%等）の計算基準にも含めない。基準は労務報酬の税込額。

-- 自社ごとの設定。0 にすれば運送保険の相殺を無効化できる。
-- ⚠️ DEFAULT を変えるときは utils/company.ts の DEFAULT_TRANSPORT_INSURANCE も必ず揃えること。
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS transport_insurance_amount numeric NOT NULL DEFAULT 1000;

COMMENT ON COLUMN public.companies.transport_insurance_amount IS
  '運送保険料（月額・委託先負担・非課税）。支払通知書の相殺額に計上する。0で無効';

-- 支払通知書に実際に相殺した額のスナップショットを残す。
-- ⚠️ 設定値を後から変えても、確定済みの通知書の金額が動いてはいけないため、
--    companies を参照するのではなく行ごとに保存する（deduction 等と同じ方針）。
ALTER TABLE public.payment_notices
  ADD COLUMN IF NOT EXISTS insurance_deduction numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payment_notices.insurance_deduction IS
  '運送保険の相殺額（非課税）。total_deduction に含まれる';
