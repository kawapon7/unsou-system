-- advisor WARN: prevent_notification_logs_modification の search_path 未固定を是正。
-- internal.is_owner / my_contractor_id と同じ形式に揃える。挙動は不変(例外を投げるだけの関数)。
ALTER FUNCTION public.prevent_notification_logs_modification()
  SET search_path TO 'public', 'pg_temp';
