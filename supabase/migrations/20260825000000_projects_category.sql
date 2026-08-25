-- 案件の区分（2026-08-25）
-- 従来 web/src/utils/ooba-invoice-lines.ts が案件名に「作業」「デバンニング」「荷役」を
-- 含むかで作業系を判定していた。案件名を変えただけで帳票の並び順と
-- 「※人員結果は別紙参照」の出し分けが変わる状態を解消するための列。
-- 既定 'transport': 未設定の案件は輸送系として扱う（従来の判定で false だった側と一致）。
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'transport';

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_category_check;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_category_check CHECK (category IN ('transport', 'work'));

-- 既存行を従来ルールと同じ基準でバックフィルし、移行前後で帳票の出力を変えない
UPDATE public.projects
SET category = 'work'
WHERE category = 'transport'
  AND (project_name LIKE '%作業%'
    OR project_name LIKE '%デバンニング%'
    OR project_name LIKE '%荷役%');

COMMENT ON COLUMN public.projects.category IS
  '案件の区分。transport=輸送系 / work=作業系（デバンニング・荷役等）。帳票の並び順と別紙注記の判定に使う';
