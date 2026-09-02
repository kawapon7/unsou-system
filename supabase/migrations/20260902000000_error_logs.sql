-- 本番エラー監視（2026-09-02） spec: docs/superpowers/specs/2026-09-02-error-monitoring-design.md
-- Server Action / API route / 画面境界のエラーを集約して記録する。
-- 同一 (fingerprint, day, tenant_id) は1行に集約し count を加算する。
-- tenant_id が取れない（ログイン前等）場合は NULL ではなく固定値 00000000-...-0000 を入れる
-- （UNIQUE 制約で NULL は別行扱いになり集約できないため）。
-- ⚠️ approval_history / notification_logs の不変ログ規約の対象外。UPDATE は count/notified_at のみ。
CREATE TABLE IF NOT EXISTS public.error_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint    text NOT NULL,
  day            date NOT NULL,
  tenant_id      uuid NOT NULL,
  source         text NOT NULL CHECK (source IN ('action','route','cron','boundary')),
  action_name    text NOT NULL,
  severity       text NOT NULL CHECK (severity IN ('critical','normal')),
  message        text NOT NULL,
  stack          text,
  path           text,
  user_id        text,
  contractor_id  uuid,
  count          integer NOT NULL DEFAULT 1,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  notified_at    timestamptz,
  UNIQUE (fingerprint, day, tenant_id)
);
CREATE INDEX IF NOT EXISTS error_logs_last_seen_idx ON public.error_logs (last_seen_at);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
-- ポリシーなし = service_role 専用
REVOKE ALL ON public.error_logs FROM PUBLIC, anon, authenticated;

-- 記録（UPSERT）。day は JST 日付で呼び出し側が渡す。
CREATE OR REPLACE FUNCTION public.record_error_log(
  p_fingerprint   text,
  p_day           date,
  p_tenant_id     uuid,
  p_source        text,
  p_action_name   text,
  p_severity      text,
  p_message       text,
  p_stack         text,
  p_path          text,
  p_user_id       text,
  p_contractor_id uuid
) RETURNS TABLE (id uuid, count integer, notified_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.error_logs
    (fingerprint, day, tenant_id, source, action_name, severity, message, stack, path, user_id, contractor_id)
  VALUES
    (p_fingerprint, p_day, p_tenant_id, p_source, p_action_name, p_severity, p_message, p_stack, p_path, p_user_id, p_contractor_id)
  ON CONFLICT (fingerprint, day, tenant_id) DO UPDATE SET
    count        = public.error_logs.count + 1,
    last_seen_at = now(),
    message      = EXCLUDED.message,
    stack        = COALESCE(EXCLUDED.stack, public.error_logs.stack)
  RETURNING public.error_logs.id, public.error_logs.count, public.error_logs.notified_at;
$$;

CREATE OR REPLACE FUNCTION public.mark_error_notified(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.error_logs SET notified_at = now() WHERE id = p_id;
$$;

-- 保持期限超の削除。戻り値は削除件数。
CREATE OR REPLACE FUNCTION public.purge_error_logs(p_days integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.error_logs WHERE last_seen_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.record_error_log(text,date,uuid,text,text,text,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_error_notified(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_error_logs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_error_log(text,date,uuid,text,text,text,text,text,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_error_notified(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_error_logs(integer) TO service_role;
