-- ================================================================
-- notification_logs.client_id 追加
-- 督促・延滞管理アラート（⑥延滞請求書）: contractorを持たずclientのみを
-- 持つアラート種別を記録できるようにする。
-- contractor_id は NOT NULL REFERENCES contractors(id) のため、
-- そのままでは client 起点のアラートを記録できない。
-- ================================================================

alter table notification_logs
  alter column contractor_id drop not null;

alter table notification_logs
  add column if not exists client_id uuid references clients(id) on delete cascade;

alter table notification_logs
  add constraint notification_logs_subject_check
  check (
    (contractor_id is not null and client_id is null) or
    (contractor_id is null and client_id is not null)
  );

create index if not exists idx_notification_logs_client_id
  on notification_logs (client_id);
