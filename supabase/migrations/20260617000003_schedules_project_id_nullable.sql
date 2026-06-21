-- schedules.project_id を nullable に変更
-- 休み登録時は project_id が不要なため
ALTER TABLE schedules ALTER COLUMN project_id DROP NOT NULL;
