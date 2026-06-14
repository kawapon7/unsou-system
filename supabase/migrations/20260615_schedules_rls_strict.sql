-- ================================================================
-- schedules RLS 厳格化
-- INSERT: 管理者は全員分 / ドライバーは自身の contractor_id のみ
-- UPDATE: ドライバーからの直接 UPDATE は禁止（ポリシー未定義 = 拒否）
--         管理者は is_owner() 経由、または service_role Server Actions
-- ================================================================

CREATE OR REPLACE FUNCTION is_owner()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role IN ('master', 'owner')
  );
$$;

CREATE OR REPLACE FUNCTION my_contractor_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT contractor_id FROM public.users
  WHERE id = auth.uid()
  LIMIT 1;
$$;

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedules_authenticated_all"     ON schedules;
DROP POLICY IF EXISTS "schedules_owner_all"             ON schedules;
DROP POLICY IF EXISTS "schedules_owner_select"          ON schedules;
DROP POLICY IF EXISTS "schedules_owner_insert"          ON schedules;
DROP POLICY IF EXISTS "schedules_owner_update"          ON schedules;
DROP POLICY IF EXISTS "schedules_owner_delete"          ON schedules;
DROP POLICY IF EXISTS "schedules_contractor_select"     ON schedules;
DROP POLICY IF EXISTS "schedules_contractor_insert"     ON schedules;
DROP POLICY IF EXISTS "schedules_contractor_update"    ON schedules;

-- 管理者: 全行参照
CREATE POLICY "schedules_owner_select" ON schedules
  FOR SELECT TO authenticated
  USING (is_owner());

-- 管理者: 全員分の INSERT（配車・予定登録）
CREATE POLICY "schedules_owner_insert" ON schedules
  FOR INSERT TO authenticated
  WITH CHECK (is_owner());

-- 管理者: UPDATE（Server Actions 経由の status 変更を許可）
CREATE POLICY "schedules_owner_update" ON schedules
  FOR UPDATE TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

-- 管理者: DELETE
CREATE POLICY "schedules_owner_delete" ON schedules
  FOR DELETE TO authenticated
  USING (is_owner());

-- ドライバー: 自身の予定のみ参照
CREATE POLICY "schedules_contractor_select" ON schedules
  FOR SELECT TO authenticated
  USING (
    NOT is_owner()
    AND contractor_id = my_contractor_id()
  );

-- ドライバー: 自身の contractor_id のみ INSERT（自己申告シフト）
-- UPDATE ポリシーは意図的に作成しない → 一律拒否
CREATE POLICY "schedules_contractor_insert" ON schedules
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT is_owner()
    AND contractor_id = my_contractor_id()
  );
