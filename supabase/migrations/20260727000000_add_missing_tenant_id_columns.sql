-- a7d937d（2026-07-02 セキュリティ監査P0-P2修正）で漏れた tenant_id 列を追加する。
--
-- 背景:
--   a7d937d はテナント分離のため各クエリへ tenant_id フィルタ／INSERT値を追加したが、
--   列を持たない3テーブルへの列追加マイグレーションが作られなかった。
--   結果、以下が本番で 7/2 以降ずっと失敗していた（今日まで気付かれなかったのは
--   これらの経路がUI経由で一度も実行されていなかったため）:
--     - project_payees  : 支払通知書の生成、案件の支払先の一覧/更新/削除
--                         （projects/actions.ts:166,236,257 / billing/actions.ts:279,563）
--                         症状: column project_payees.tenant_id does not exist
--     - invoices        : 請求書の作成（sales/actions.ts:738 / scan-actions.ts:93 のINSERT）
--     - payment_notices : 支払通知書の保存（sales/actions.ts:759 のINSERT）
--
-- 設計:
--   定義は既存のA群（clients / contractors / projects / work_records /
--   expense_records / schedules、20260614000002）と完全に揃える。
--   ⚠️ uuid ではなく text にすること。アプリの getCurrentTenantId() は現状 'local-dev'
--      という文字列を返すため、uuid にすると 2026-07-26 の
--      driver_project_assignments と同じ型不一致で全書き込みが失敗する。
--      uuid への統一はテナント分離フェーズ0でA群と一括して行う
--      （docs/superpowers/plans/2026-07-27-tenant-isolation-phase0.md）。
--
-- 安全性:
--   列の追加のみ。既存行は DEFAULT 'local-dev' で埋まる（現在の全データはA社のため正しい）。
--   不変ログ（approval_history / notification_logs）は対象外のため、
--   UPDATE もトリガーの無効化も一切発生しない。

BEGIN;

ALTER TABLE public.project_payees
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'local-dev';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'local-dev';

ALTER TABLE public.payment_notices
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'local-dev';

COMMIT;
