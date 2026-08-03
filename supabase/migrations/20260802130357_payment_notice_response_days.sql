-- 支払通知書の「返事を待つ日数」を会社ごとに設定できるようにする
--
-- 背景（2026-08-02）:
-- 設計書 §2-3-9 の備考は「タイムリミット後は確定ロック」だが、実装には日付の判定が
-- まったく無く、支払通知書を作った直後でも親分が「未応答のまま確定」を立てられた。
-- 子分に返事の機会が無いまま「返事がなかった」という証跡が残るのは、
-- 合意証跡としての意味を損なう。
--
-- ⚠️ 何日待つかは会社ごとのローカルルール（ボス判断）。ハードコードしないこと。
--    起算日は「支払通知書を作った日」（payment_notices.created_at）。
--    子分は生成された時点でドライバー画面から見られるため、
--    「見られるようになってから N 日」と一致する。再生成しても起算日は動かない。
--
-- 0 を許すのは「待たない運用」を選べるようにするため（従来どおりの挙動）。
-- 上限 90 日は入力ミスで実質ロック不能になるのを防ぐためのガード。

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS payment_notice_response_days integer NOT NULL DEFAULT 7;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_payment_notice_response_days_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_payment_notice_response_days_check
      CHECK (payment_notice_response_days BETWEEN 0 AND 90);
  END IF;
END $$;

COMMENT ON COLUMN companies.payment_notice_response_days IS
  '支払通知書を作ってから、子分の返事を待つ日数。'
  'この日数を過ぎるまで「未応答のまま確定」はできない（0 なら待たない）。'
  '⚠️ 会社ごとのローカルルール。コード側にハードコードしないこと。';
