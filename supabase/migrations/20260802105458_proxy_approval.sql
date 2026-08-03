-- 支払通知書の「代理承認（口頭確認）」を仕様として正式に持つ
--
-- 背景（2026-08-02）:
-- 設計書 §2-3-9 は支払通知書の承認者を「子分（委託先）」と定め、目的を「支払金額の合意証跡」
-- としている。ところが親分側の確定処理（finalizePaymentNotice）が approval_status='approved'
-- を書いており、**子分の承認なしに合意証跡が作られる**状態だった。
--
-- 一方、実運用では「電話で口頭確認して親分が代わりに承認する」ケースが多いことが判明。
-- これは正当な業務なので、無かったことにせず**別の状態として記録する**方針にした。
--
--   pending           返事待ち（生成直後）
--   approved          子分がアプリで承認した（最も強い証跡）
--   approved_by_proxy 親分が口頭等で確認して代理承認した（確認記録の入力が必須）
--   no_response       連絡がつかないまま支払日が来て親分が締めた
--
-- ⚠️ approval_status にはこれまで CHECK 制約が無く、タイポが素通りしていた。ここで付ける。

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_notices_approval_status_check'
  ) THEN
    ALTER TABLE payment_notices
      ADD CONSTRAINT payment_notices_approval_status_check
      CHECK (approval_status IN ('pending', 'approved', 'approved_by_proxy', 'no_response'));
  END IF;
END $$;

COMMENT ON COLUMN payment_notices.approval_status IS
  '子分（委託先）の合意状態。pending/approved/approved_by_proxy/no_response。'
  '⚠️ approved を書けるのは子分の承認経路だけ。親分側のコードから書かないこと。';

-- ── 代理承認の確認記録 ────────────────────────────────────
-- approval_history は UPDATE/DELETE 禁止の不変ログ。代理承認の証跡もここに刻む。
-- 「誰が・いつ・どうやって・誰に確認したか」を残せないと、代理承認は証跡として機能しない。

ALTER TABLE approval_history
  ADD COLUMN IF NOT EXISTS confirmation_method TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_party     TEXT,
  ADD COLUMN IF NOT EXISTS note                TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'approval_history_confirmation_method_check'
  ) THEN
    ALTER TABLE approval_history
      ADD CONSTRAINT approval_history_confirmation_method_check
      CHECK (confirmation_method IS NULL OR confirmation_method IN ('phone', 'in_person', 'sms', 'email', 'line'));
  END IF;
END $$;

COMMENT ON COLUMN approval_history.confirmation_method IS
  '代理承認時の確認方法（phone/in_person/sms/email/line）。action_type=proxy_approval のとき必須';
COMMENT ON COLUMN approval_history.confirmed_party IS
  '代理承認時に確認した相手（self=本人 / family_or_staff=家族・事務担当）';
COMMENT ON COLUMN approval_history.note IS
  '自由記述メモ。代理承認では必須（例: 8/2 15時 本人に架電、金額合意）';
