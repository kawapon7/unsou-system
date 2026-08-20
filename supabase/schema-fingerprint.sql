-- スキーマ指紋: カテゴリ別に「件数」と「定義文のmd5」を出す。
-- 照合対象は public + internal のみ（backup_f0 と Supabase管理スキーマは除外）。
with sig as (
  select 'COL' k, table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'-') s
    from information_schema.columns where table_schema in ('public','internal')
  union all
  select 'CON', n.nspname||'.'||r.relname||'.'||c.conname||' '||pg_get_constraintdef(c.oid)
    from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=c.connamespace
    where n.nspname in ('public','internal')
  union all
  select 'IDX', schemaname||'.'||indexname||' '||indexdef from pg_indexes where schemaname in ('public','internal')
  union all
  select 'POL', schemaname||'.'||tablename||'.'||policyname||' '||cmd||' '||array_to_string(roles,',')
                ||' q='||coalesce(qual,'-')||' w='||coalesce(with_check,'-')
    from pg_policies where schemaname in ('public','internal')
  union all
  select 'TRG', n.nspname||'.'||r.relname||'.'||t.tgname||' '||pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace
    where n.nspname in ('public','internal') and not t.tgisinternal
  union all
  select 'FN', n.nspname||'.'||p.proname||' '||md5(pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','internal')
  union all
  select 'TBL', schemaname||'.'||tablename from pg_tables where schemaname in ('public','internal')
  union all
  -- GRA: Data API 経由のアクセス権。ここがズレると「指紋は一致するのにアプリが動かない」が起きる。
  -- 新プロジェクト作成時の "Automatically expose new tables" の設定に左右されるため必ず照合する。
  select 'GRA', grantee||' '||table_schema||'.'||table_name||' '||privilege_type
    from information_schema.role_table_grants
    where table_schema in ('public','internal')
      and grantee in ('anon','authenticated','service_role')
)
select k, count(*) n, md5(string_agg(s, E'\n' order by s)) fingerprint
from sig group by k order by k;
