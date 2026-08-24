-- payment_notices.status の段階的廃止 Phase 2（2026-08-24 決定）。
-- status は approval_status + locked から導ける派生値で、読む側のコードは既に無い（Phase 1 で撤去済み）。
-- 列が NOT NULL・DEFAULT なしのままだと INSERT 側コードから status を外せないため、DEFAULT を付与する。
-- ⚠️ 本番適用の順序: このマイグレーションを適用してから、INSERT の status 書き込みを削除したコードをデプロイすること。
--    逆にすると「null value in column "status" violates not-null constraint」で通知書生成が全停止する。
-- 列 DROP は Phase 3（全書き込み削除後・別マイグレーション）。
ALTER TABLE public.payment_notices ALTER COLUMN status SET DEFAULT 'unapproved';
