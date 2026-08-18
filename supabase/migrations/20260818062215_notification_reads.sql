-- ドライバー向けアプリ内お知らせの既読管理
--
-- ⚠️ notification_logs は不変ログ（INSERTのみ・UPDATE/DELETE 全ロール禁止）のため、
--    既読フラグをあの表に持たせられない。規約を曲げず別表で管理する。
-- ⚠️ tenant_id は F0 で DEFAULT を撤去済み。INSERT 時に明示的に渡すこと
--    （渡さないと NOT NULL 違反になる）。

create table if not exists public.notification_reads (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id),
  notification_id uuid not null references public.notification_logs(id) on delete cascade,
  contractor_id   uuid not null references public.contractors(id) on delete cascade,
  read_at         timestamptz not null default now(),
  -- 同じ通知を二重に既読化しても1行に保つ
  unique (notification_id, contractor_id)
);

create index if not exists idx_notification_reads_contractor
  on public.notification_reads (contractor_id, notification_id);

-- クライアントからの直接アクセスは禁止（データアクセスは Server Actions の service_role 経由）
alter table public.notification_reads enable row level security;

comment on table public.notification_reads is
  'ドライバーがアプリ内お知らせを既読にした記録。notification_logs が不変ログのため分離した表。';
