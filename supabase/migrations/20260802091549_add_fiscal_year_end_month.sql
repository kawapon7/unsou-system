-- 自社の決算月を companies に追加する。
--
-- 目的: 委託先ごとの「その事業年度にいくら払ったか」を集計するため。
--       インボイス経過措置の控除限度額（一の免税事業者等からの課税仕入れが
--       その年又は事業年度で税込1億円超）の判定単位が事業年度であることによる。
--
-- 1〜12 の月番号で持つ。事業年度 = 決算月の翌月1日 〜 決算月末日。
-- 例: 3 なら 4月1日〜翌年3月31日。
--
-- ⚠️ NULL 許容にする。未設定のうちは暦年（1月〜12月）で集計し、画面にその旨を表示する。
--    未設定を理由に PDF 生成などを止めることはしない（fail-closed にするほどの実害がない）。

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS fiscal_year_end_month integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_fiscal_year_end_month_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_fiscal_year_end_month_check
      CHECK (fiscal_year_end_month IS NULL OR fiscal_year_end_month BETWEEN 1 AND 12);
  END IF;
END $$;

COMMENT ON COLUMN public.companies.fiscal_year_end_month IS
  '決算月（1〜12）。事業年度 = 決算月の翌月1日〜決算月末日。NULL なら暦年で集計する。';
