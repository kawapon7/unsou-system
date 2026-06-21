-- ドライバー予定入力画面での案件表示フラグ
-- true(デフォルト): ドライバーの案件選択に表示
-- false: ドライバー画面から非表示（管理者のみ閲覧可能）
ALTER TABLE projects ADD COLUMN IF NOT EXISTS driver_visible boolean NOT NULL DEFAULT true;
