# 本番エラー監視 第1段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番の Server Action / API route / 画面境界で起きたエラーを `error_logs` に記録し、critical は即時メール、全件は日次まとめメールで管理者に届ける。

**Architecture:** `web/src/utils/error-monitor/` に純関数（mask / classify / fingerprint）と `ErrorSink` interface、`captured()` ラッパーを置く。Server Action は export を素の async 関数のままにし、本体だけを `captured()` で包む（方式イ）。記録は service_role で `error_logs` へ RPC UPSERT。通知は既存 `emailCore.ts` の Resend 送信を使う。

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase (Postgres RPC, service_role), Resend (fetch API), vitest 4, @opennextjs/cloudflare 1.20

仕様書: `docs/superpowers/specs/2026-09-02-error-monitoring-design.md`（以下「spec」）

## Global Constraints

- `'use server'` ファイルは async 関数しか export しない。`export const x = captured(...)` 禁止（`utils/use-server-exports.test.ts` が監視）
- 記録・通知の失敗は業務処理の結果を一切変えない（握りつぶして `console.error`）
- 例外時の UI 文言は固定「処理に失敗しました」。生メッセージを UI に出さない
- Action の引数は保存しない。message 2,000 字 / stack 4,000 字で切る
- `error_logs` の書き込みは service_role のみ。クライアント直クエリ禁止
- `approval_history` / `notification_logs` には触れない
- 新規 env は追加しない。即時メールは `NODE_ENV === 'production'` かつ `ADMIN_ALERT_EMAIL` 設定時のみ
- 本番 URL の直書き禁止（workflow は `vars.APP_BASE_URL` 経由）
- コミット前3ステップ（hibiki-security #4）: `git status` で `.next/` `.open-next/` 不在確認 → `git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"` が空 → ファイル明示 add
- コミット末尾: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- テスト実行: `cd web && npx vitest run <path>`（Node は mise 管理。Bash では `eval "$(mise activate bash --shims)"` を先に通す）
- 本番 DB マイグレーション適用と本番デプロイは**1コマンドずつ提示しユーザー確認**（CLAUDE.md §2）

## File Structure

```
web/src/utils/error-monitor/
  types.ts             ErrorEvent / ErrorSink / Severity / Source / ErrorRecordResult
  critical-actions.ts  CRITICAL_ACTIONS 定数
  classify.ts          isSystemError(), severityFor()
  mask.ts              mask()
  fingerprint.ts       normalizeMessage(), fingerprint()
  sink.ts              SupabaseSink（RPC record_error_log / mark_error_notified）, NULL_TENANT_ID
  notify.ts            shouldNotifyImmediately(), buildImmediateMail(), buildDigestMail()
  captured.ts          captured(), capturedRoute(), reportError()（内部: mask→classify→fingerprint→sink→notify）
  *.test.ts            各ファイルに対応
web/src/app/_actions/emailCore.ts        sendAdminAlertEmail() 追加（'use server' なしのプレーンモジュール）
web/src/app/_actions/errorReportActions.ts  reportClientError()（'use server'）
web/src/app/admin/error.tsx, app/driver/error.tsx, app/global-error.tsx
web/src/app/api/cron/error-digest/route.ts
supabase/migrations/20260902000000_error_logs.sql
.github/workflows/defensive-alerts-cron.yml  step 追加
```

---

### Task 1: 型・critical 定数・classify

**Files:**
- Create: `web/src/utils/error-monitor/types.ts`
- Create: `web/src/utils/error-monitor/critical-actions.ts`
- Create: `web/src/utils/error-monitor/classify.ts`
- Test: `web/src/utils/error-monitor/classify.test.ts`

**Interfaces:**
- Produces: `type Source = 'action'|'route'|'cron'|'boundary'`, `type Severity = 'critical'|'normal'`, `type ErrorEvent`, `interface ErrorSink { record(e: ErrorEvent): Promise<ErrorRecordResult>; markNotified(id: string): Promise<void> }`, `isSystemError(msg: string): boolean`, `severityFor(source: Source, actionName: string): Severity`, `CRITICAL_ACTIONS: ReadonlySet<string>`

- [ ] **Step 1: 型を書く**

```ts
// web/src/utils/error-monitor/types.ts
export type Source   = 'action' | 'route' | 'cron' | 'boundary'
export type Severity = 'critical' | 'normal'

/** 整形後（マスク済み）のイベント。sink に渡す直前の形 */
export type ErrorEvent = {
  fingerprint:  string
  source:       Source
  actionName:   string
  severity:     Severity
  message:      string        // マスク後・2,000字以内
  stack:        string | null // マスク後・4,000字以内
  path:         string | null
  tenantId:     string | null
  userId:       string | null
  contractorId: string | null
}

export type ErrorRecordResult = {
  id:         string
  count:      number
  notifiedAt: string | null   // ISO
}

/** 記録先の抽象。第1実装は SupabaseSink。将来 SentrySink 等を足す */
export interface ErrorSink {
  record(event: ErrorEvent): Promise<ErrorRecordResult>
  markNotified(id: string): Promise<void>
}

/** captured() に呼び出し元が任意で渡す文脈（getAuthContext を呼び直さない） */
export type CaptureContext = {
  tenantId?:     string | null
  userId?:       string | null
  contractorId?: string | null
  path?:         string | null
}
```

- [ ] **Step 2: critical 定数**

```ts
// web/src/utils/error-monitor/critical-actions.ts
/**
 * 業務が止まる Server Action。ここに含まれる action_name（と source='cron'）は
 * severity='critical' となり即時メールの対象になる。spec §6。
 * ⚠️ 名前は export された関数名と完全一致させる（captured の第1引数）。
 */
export const CRITICAL_ACTIONS: ReadonlySet<string> = new Set([
  'login',
  'upsertSchedule',
  'bulkUpsertSchedules',
  'submitWorkRecord',
  'generatePaymentNotice',
  'generateAllPaymentNotices',
])
```

- [ ] **Step 3: 失敗するテスト**

```ts
// web/src/utils/error-monitor/classify.test.ts
import { describe, it, expect } from 'vitest'
import { isSystemError, severityFor } from './classify'

describe('isSystemError', () => {
  it.each([
    'PGRST301: JWT expired',
    'duplicate key value violates unique constraint "schedules_pkey"',
    'new row violates row-level security policy',
    'connection refused',
    'ECONNRESET',
    'Request timed out',
    'fetch failed',
    'Failed to fetch',
    'permission denied for table users',
    'relation "public.foo" does not exist',
    'column "bar" does not exist',
    'invalid token',
    'Internal Server Error',
    '502 Bad Gateway',
  ])('system: %s', (m) => expect(isSystemError(m)).toBe(true))

  it.each([
    '委託先が見つかりません',
    '未ログインです',
    'メールアドレスまたはパスワードが正しくありません',
    'clientId と month は必須です',
    '',
  ])('business: %s', (m) => expect(isSystemError(m)).toBe(false))
})

describe('severityFor', () => {
  it('critical action', () => expect(severityFor('action', 'upsertSchedule')).toBe('critical'))
  it('cron is always critical', () => expect(severityFor('cron', 'anything')).toBe('critical'))
  it('other action normal', () => expect(severityFor('action', 'listUsers')).toBe('normal'))
  it('boundary normal', () => expect(severityFor('boundary', 'admin')).toBe('normal'))
})
```

- [ ] **Step 4: 実行して失敗を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/classify.test.ts`
Expected: FAIL（`./classify` が見つからない）

- [ ] **Step 5: 実装**

```ts
// web/src/utils/error-monitor/classify.ts
import type { Severity, Source } from './types'
import { CRITICAL_ACTIONS } from './critical-actions'

/**
 * 戻り値 {error} の文字列がシステム由来（DB/PostgREST/接続/認証基盤）かを判定する。
 * 一致しないものは業務メッセージ（「委託先が見つかりません」等）として記録しない。spec §3。
 * ⚠️ パターン追加時はテストに一致例・不一致例を両方足す。
 */
export const SYSTEM_ERROR_PATTERNS: readonly RegExp[] = [
  /PGRST\d+/,
  /duplicate key/i,
  /violates .*(constraint|policy)/i,
  /connection|ECONN|timeout|timed out/i,
  /fetch failed|Failed to fetch/i,
  /permission denied/i,
  /(relation|column) .* does not exist/i,
  /JWT|invalid token/i,
  /Internal Server Error|^5\d\d\b/,
]

export function isSystemError(message: string): boolean {
  if (!message) return false
  return SYSTEM_ERROR_PATTERNS.some((re) => re.test(message))
}

export function severityFor(source: Source, actionName: string): Severity {
  if (source === 'cron') return 'critical'
  if (source === 'action' && CRITICAL_ACTIONS.has(actionName)) return 'critical'
  return 'normal'
}
```

- [ ] **Step 6: 実行して成功を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/classify.test.ts`
Expected: PASS（全件）

- [ ] **Step 7: コミット**

```bash
git add web/src/utils/error-monitor/types.ts web/src/utils/error-monitor/critical-actions.ts web/src/utils/error-monitor/classify.ts web/src/utils/error-monitor/classify.test.ts
git commit -m "feat(error-monitor): 型・critical定数・システムエラー判定を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: マスキング

**Files:**
- Create: `web/src/utils/error-monitor/mask.ts`
- Test: `web/src/utils/error-monitor/mask.test.ts`

**Interfaces:**
- Produces: `mask(text: string, maxLen: number): string`, `MESSAGE_MAX = 2000`, `STACK_MAX = 4000`

- [ ] **Step 1: 失敗するテスト**

```ts
// web/src/utils/error-monitor/mask.test.ts
import { describe, it, expect } from 'vitest'
import { mask, MESSAGE_MAX, STACK_MAX } from './mask'

describe('mask', () => {
  it('Postgres の Failing row を丸ごと落とす', () => {
    const s = 'duplicate key\nDETAIL: Failing row contains (a1, みずほ, 1234567, タナカ).\nHINT: x'
    const out = mask(s, 2000)
    expect(out).toContain('DETAIL: [row omitted]')
    expect(out).not.toContain('1234567')
    expect(out).toContain('HINT: x')
  })
  it('6桁以上の数字列（ハイフン区切り含む）を [digits] にする', () => {
    expect(mask('口座 1234567 支店 001', 2000)).toBe('口座 [digits] 支店 001')
    expect(mask('tel 090-1234-5678', 2000)).toBe('tel [digits]')
    expect(mask('12345', 2000)).toBe('12345')
  })
  it('メールはドメインだけ残す', () => {
    expect(mask('user taro.k@example.co.jp failed', 2000)).toBe('user ***@example.co.jp failed')
  })
  it('JWT と API キーを [token] にする', () => {
    expect(mask('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc', 2000)).toBe('jwt [token]')
    expect(mask('key re_AbC123xyz', 2000)).toBe('key [token]')
    expect(mask('key sk_live_9zz', 2000)).toBe('key [token]')
    expect(mask('key AIzaSyD-abc', 2000)).toBe('key [token]')
  })
  it('maxLen で切る', () => {
    expect(mask('a'.repeat(50), 10)).toHaveLength(10)
  })
  it('定数', () => {
    expect(MESSAGE_MAX).toBe(2000)
    expect(STACK_MAX).toBe(4000)
  })
})
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/mask.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// web/src/utils/error-monitor/mask.ts
/**
 * error_logs 保存前のマスキング。spec §4。
 * 口座情報・個人情報・トークンが平文で残らないようにする。順序は重要:
 * 行データ除去 → トークン → メール → 数字列（数字列を先にやるとメール/トークン判定が崩れる）。
 */
export const MESSAGE_MAX = 2000
export const STACK_MAX   = 4000

const FAILING_ROW = /DETAIL:\s*Failing row contains \([^)]*\)\.?/g
const JWT         = /\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}\b/g
const API_KEY     = /\b(?:re_|sk_|AIza)[A-Za-z0-9_-]+\b/g
const EMAIL       = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g
const DIGITS      = /\d(?:[\d-]*\d)?/g

export function mask(text: string, maxLen: number): string {
  let out = text
    .replace(FAILING_ROW, 'DETAIL: [row omitted]')
    .replace(JWT, '[token]')
    .replace(API_KEY, '[token]')
    .replace(EMAIL, '***@$1')
    .replace(DIGITS, (m) => (m.replace(/-/g, '').length >= 6 ? '[digits]' : m))
  if (out.length > maxLen) out = out.slice(0, maxLen)
  return out
}
```

- [ ] **Step 4: 実行して成功を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/mask.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add web/src/utils/error-monitor/mask.ts web/src/utils/error-monitor/mask.test.ts
git commit -m "feat(error-monitor): 保存前マスキング（行データ・数字列・メール・トークン）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 指紋

**Files:**
- Create: `web/src/utils/error-monitor/fingerprint.ts`
- Test: `web/src/utils/error-monitor/fingerprint.test.ts`

**Interfaces:**
- Produces: `normalizeMessage(msg: string): string`, `fingerprint(source: Source, actionName: string, message: string): string`（16桁 hex）

- [ ] **Step 1: 失敗するテスト**

```ts
// web/src/utils/error-monitor/fingerprint.test.ts
import { describe, it, expect } from 'vitest'
import { fingerprint, normalizeMessage } from './fingerprint'

describe('normalizeMessage', () => {
  it('UUID と数字列を潰し空白を圧縮する', () => {
    expect(normalizeMessage('row 3f2a1b7c-1234-4bcd-9e0f-aabbccddeeff  count 42')).toBe('row <uuid> count <n>')
  })
})

describe('fingerprint', () => {
  it('16桁 hex', () => {
    expect(fingerprint('action', 'upsertSchedule', 'x')).toMatch(/^[0-9a-f]{16}$/)
  })
  it('数字・UUID 違いは同一', () => {
    const a = fingerprint('action', 'a', 'id 111 failed')
    const b = fingerprint('action', 'a', 'id 222 failed')
    expect(a).toBe(b)
  })
  it('action 名が違えば別', () => {
    expect(fingerprint('action', 'a', 'm')).not.toBe(fingerprint('action', 'b', 'm'))
  })
  it('source が違えば別', () => {
    expect(fingerprint('action', 'a', 'm')).not.toBe(fingerprint('route', 'a', 'm'))
  })
})
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/fingerprint.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// web/src/utils/error-monitor/fingerprint.ts
import { createHash } from 'node:crypto'
import type { Source } from './types'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const NUM  = /\d+/g

/** 同一原因を同一指紋にまとめるための正規化。spec §5 */
export function normalizeMessage(message: string): string {
  return message.replace(UUID, '<uuid>').replace(NUM, '<n>').replace(/\s+/g, ' ').trim()
}

/** sha256(source|actionName|正規化message) の先頭16桁 */
export function fingerprint(source: Source, actionName: string, message: string): string {
  return createHash('sha256')
    .update(`${source}|${actionName}|${normalizeMessage(message)}`)
    .digest('hex')
    .slice(0, 16)
}
```

- [ ] **Step 4: 実行して成功を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/fingerprint.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add web/src/utils/error-monitor/fingerprint.ts web/src/utils/error-monitor/fingerprint.test.ts
git commit -m "feat(error-monitor): 指紋生成（UUID・数字の正規化）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: マイグレーション `error_logs` + RPC

**Files:**
- Create: `supabase/migrations/20260902000000_error_logs.sql`

**Interfaces:**
- Produces: テーブル `public.error_logs`、RPC `record_error_log(...) RETURNS TABLE(id uuid, count int, notified_at timestamptz)`、RPC `mark_error_notified(p_id uuid)`、RPC `purge_error_logs(p_days int) RETURNS int`

- [ ] **Step 1: マイグレーションを書く**

```sql
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
```

- [ ] **Step 2: テスト環境（kawapon7's Org 側プロジェクト）に適用して確認**

Supabase MCP `apply_migration`（name: `error_logs`）でテスト側に適用。次に `execute_sql`:
```sql
SELECT * FROM public.record_error_log('abc','2026-09-02','00000000-0000-0000-0000-000000000000','action','x','normal','m',null,null,null,null);
SELECT * FROM public.record_error_log('abc','2026-09-02','00000000-0000-0000-0000-000000000000','action','x','normal','m2',null,null,null,null);
SELECT count, message FROM public.error_logs WHERE fingerprint='abc';
DELETE FROM public.error_logs WHERE fingerprint='abc';
```
Expected: 2回目の `count` が 2、`message` が `m2`。
⚠️ **本番（hibiki-production-org）への適用はこのタスクでは行わない**。Task 13 でユーザー確認後に1コマンドで行う。

- [ ] **Step 3: コミット**

```bash
git add supabase/migrations/20260902000000_error_logs.sql
git commit -m "feat(db): error_logs テーブルと record/mark/purge RPC を追加（service_role専用）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: SupabaseSink

**Files:**
- Create: `web/src/utils/error-monitor/sink.ts`
- Test: `web/src/utils/error-monitor/sink.test.ts`

**Interfaces:**
- Consumes: `ErrorEvent`, `ErrorSink`, `ErrorRecordResult`（Task 1）、RPC 名（Task 4）
- Produces: `NULL_TENANT_ID = '00000000-0000-0000-0000-000000000000'`, `jstDay(now?: Date): string`（`YYYY-MM-DD`）, `class SupabaseSink implements ErrorSink`（コンストラクタ引数 `rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>`）, `createSupabaseSink(): SupabaseSink`

- [ ] **Step 1: 失敗するテスト**

```ts
// web/src/utils/error-monitor/sink.test.ts
import { describe, it, expect, vi } from 'vitest'
import { SupabaseSink, NULL_TENANT_ID, jstDay } from './sink'
import type { ErrorEvent } from './types'

const ev: ErrorEvent = {
  fingerprint: 'f', source: 'action', actionName: 'a', severity: 'normal',
  message: 'm', stack: null, path: null, tenantId: null, userId: null, contractorId: null,
}

describe('jstDay', () => {
  it('UTC 15:00 は JST 翌日', () => {
    expect(jstDay(new Date('2026-09-02T15:00:00Z'))).toBe('2026-09-03')
    expect(jstDay(new Date('2026-09-02T14:59:59Z'))).toBe('2026-09-02')
  })
})

describe('SupabaseSink.record', () => {
  it('record_error_log を呼び、tenant NULL は固定値に写像する', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'id1', count: 3, notified_at: null }], error: null })
    const sink = new SupabaseSink(rpc)
    const r = await sink.record(ev)
    expect(rpc).toHaveBeenCalledWith('record_error_log', expect.objectContaining({
      p_fingerprint: 'f', p_tenant_id: NULL_TENANT_ID, p_source: 'action', p_action_name: 'a',
    }))
    expect(r).toEqual({ id: 'id1', count: 3, notifiedAt: null })
  })
  it('RPC エラーは throw', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(new SupabaseSink(rpc).record(ev)).rejects.toThrow('boom')
  })
  it('markNotified は mark_error_notified を呼ぶ', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    await new SupabaseSink(rpc).markNotified('id1')
    expect(rpc).toHaveBeenCalledWith('mark_error_notified', { p_id: 'id1' })
  })
})
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/sink.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// web/src/utils/error-monitor/sink.ts
import { createServiceClient } from '@/utils/supabase/service'
import type { ErrorEvent, ErrorRecordResult, ErrorSink } from './types'

/** tenant が取れないイベントの集約キー（UNIQUE で NULL は別行になるため固定値に写像） */
export const NULL_TENANT_ID = '00000000-0000-0000-0000-000000000000'

type RpcFn = (fn: string, args: Record<string, unknown>) =>
  PromiseLike<{ data: unknown; error: { message: string } | null }>

/** JST の YYYY-MM-DD（Workers の TZ は UTC のため手計算） */
export function jstDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export class SupabaseSink implements ErrorSink {
  constructor(private readonly rpc: RpcFn) {}

  async record(e: ErrorEvent): Promise<ErrorRecordResult> {
    const { data, error } = await this.rpc('record_error_log', {
      p_fingerprint:   e.fingerprint,
      p_day:           jstDay(),
      p_tenant_id:     e.tenantId ?? NULL_TENANT_ID,
      p_source:        e.source,
      p_action_name:   e.actionName,
      p_severity:      e.severity,
      p_message:       e.message,
      p_stack:         e.stack,
      p_path:          e.path,
      p_user_id:       e.userId,
      p_contractor_id: e.contractorId,
    })
    if (error) throw new Error(error.message)
    const row = (Array.isArray(data) ? data[0] : data) as { id: string; count: number; notified_at: string | null }
    return { id: row.id, count: row.count, notifiedAt: row.notified_at }
  }

  async markNotified(id: string): Promise<void> {
    const { error } = await this.rpc('mark_error_notified', { p_id: id })
    if (error) throw new Error(error.message)
  }
}

export function createSupabaseSink(): SupabaseSink {
  const db = createServiceClient() as any
  return new SupabaseSink((fn, args) => db.rpc(fn, args))
}
```

- [ ] **Step 4: 実行して成功を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/sink.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add web/src/utils/error-monitor/sink.ts web/src/utils/error-monitor/sink.test.ts
git commit -m "feat(error-monitor): SupabaseSink（RPC経由のUPSERT記録）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 通知（判定・本文・管理者宛て送信）

**Files:**
- Modify: `web/src/app/_actions/emailCore.ts`（末尾に `sendAdminAlertEmail` を追加。このファイルは `'use server'` なしのプレーンモジュール）
- Create: `web/src/utils/error-monitor/notify.ts`
- Test: `web/src/utils/error-monitor/notify.test.ts`

**Interfaces:**
- Consumes: `ErrorEvent`, `ErrorRecordResult`（Task 1）、`sendViaResend`（emailCore 内 private）
- Produces: `sendAdminAlertEmail(subject: string, text: string): Promise<{ ok: true } | { ok: false; error: string }>`, `shouldNotifyImmediately(e: ErrorEvent, r: ErrorRecordResult, now?: Date): boolean`, `NOTIFY_SUPPRESS_MS = 60*60*1000`, `buildImmediateMail(e: ErrorEvent, r: ErrorRecordResult, now?: Date): { subject: string; text: string }`, `buildDigestMail(day: string, rows: DigestRow[]): { subject: string; text: string }`, `type DigestRow = { severity: string; tenant_id: string; action_name: string; source: string; count: number; message: string }`

- [ ] **Step 1: emailCore に管理者宛て送信を追加**

`web/src/app/_actions/emailCore.ts` の末尾に追記:
```ts
/**
 * 管理者（ADMIN_ALERT_EMAIL）宛ての運用通知。エラー監視の即時メール・日次まとめが使う。
 * 認可チェックは行わない（呼び出し元はサーバー内部のみ）。notification_logs には記録しない
 * （委託先向け通知の台帳であり、運用通知を混ぜない）。
 */
export async function sendAdminAlertEmail(
  subject: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const to = process.env.ADMIN_ALERT_EMAIL?.trim()
  if (!to) return { ok: false, error: 'ADMIN_ALERT_EMAIL が未設定です' }
  const r = await sendViaResend(to, subject, text)
  return 'error' in r ? { ok: false, error: r.error } : { ok: true }
}
```

- [ ] **Step 2: 失敗するテスト**

```ts
// web/src/utils/error-monitor/notify.test.ts
import { describe, it, expect } from 'vitest'
import { shouldNotifyImmediately, buildImmediateMail, buildDigestMail, NOTIFY_SUPPRESS_MS } from './notify'
import type { ErrorEvent } from './types'

const base: ErrorEvent = {
  fingerprint: 'f', source: 'action', actionName: 'upsertSchedule', severity: 'critical',
  message: 'duplicate key', stack: null, path: null, tenantId: 't1', userId: 'u', contractorId: null,
}
const now = new Date('2026-09-02T03:00:00Z')

describe('shouldNotifyImmediately', () => {
  it('normal は送らない', () => {
    expect(shouldNotifyImmediately({ ...base, severity: 'normal' }, { id: 'i', count: 1, notifiedAt: null }, now)).toBe(false)
  })
  it('critical・未通知は送る', () => {
    expect(shouldNotifyImmediately(base, { id: 'i', count: 1, notifiedAt: null }, now)).toBe(true)
  })
  it('60分以内に通知済みなら送らない', () => {
    const recent = new Date(now.getTime() - NOTIFY_SUPPRESS_MS + 1000).toISOString()
    expect(shouldNotifyImmediately(base, { id: 'i', count: 5, notifiedAt: recent }, now)).toBe(false)
  })
  it('60分を超えていれば送る', () => {
    const old = new Date(now.getTime() - NOTIFY_SUPPRESS_MS - 1000).toISOString()
    expect(shouldNotifyImmediately(base, { id: 'i', count: 5, notifiedAt: old }, now)).toBe(true)
  })
})

describe('buildImmediateMail', () => {
  it('件名に action 名、本文に severity/tenant/count/message', () => {
    const m = buildImmediateMail(base, { id: 'i', count: 3, notifiedAt: null }, now)
    expect(m.subject).toContain('upsertSchedule')
    expect(m.text).toContain('critical')
    expect(m.text).toContain('t1')
    expect(m.text).toContain('3')
    expect(m.text).toContain('duplicate key')
  })
  it('message は 300 字で切る', () => {
    const m = buildImmediateMail({ ...base, message: 'x'.repeat(500) }, { id: 'i', count: 1, notifiedAt: null }, now)
    expect(m.text).not.toContain('x'.repeat(301))
  })
})

describe('buildDigestMail', () => {
  it('0件でも件名に 0件 と出す', () => {
    const m = buildDigestMail('2026-09-01', [])
    expect(m.subject).toContain('0件')
    expect(m.text).toContain('エラーはありませんでした')
  })
  it('行を列挙し message は 120 字で切る', () => {
    const m = buildDigestMail('2026-09-01', [
      { severity: 'critical', tenant_id: 't1', action_name: 'a', source: 'action', count: 7, message: 'y'.repeat(200) },
    ])
    expect(m.subject).toContain('1件')
    expect(m.text).toContain('critical')
    expect(m.text).toContain('×7')
    expect(m.text).not.toContain('y'.repeat(121))
  })
})
```

- [ ] **Step 3: 実行して失敗を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/notify.test.ts`
Expected: FAIL

- [ ] **Step 4: 実装**

```ts
// web/src/utils/error-monitor/notify.ts
import type { ErrorEvent, ErrorRecordResult } from './types'

/** 同一指紋の即時メールは60分に1通。spec §6 */
export const NOTIFY_SUPPRESS_MS = 60 * 60 * 1000

export type DigestRow = {
  severity:    string
  tenant_id:   string
  action_name: string
  source:      string
  count:       number
  message:     string
}

export function shouldNotifyImmediately(e: ErrorEvent, r: ErrorRecordResult, now: Date = new Date()): boolean {
  if (e.severity !== 'critical') return false
  if (!r.notifiedAt) return true
  return now.getTime() - new Date(r.notifiedAt).getTime() > NOTIFY_SUPPRESS_MS
}

export function buildImmediateMail(e: ErrorEvent, r: ErrorRecordResult, now: Date = new Date()): { subject: string; text: string } {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
  return {
    subject: `【HIBIKI】エラー検知: ${e.actionName}`,
    text: [
      `HIBIKI 本番でエラーを検知しました。`,
      ``,
      `action   : ${e.actionName} (${e.source})`,
      `severity : ${e.severity}`,
      `tenant   : ${e.tenantId ?? '(none)'}`,
      `時刻(JST) : ${jst}`,
      `当日件数 : ${r.count}`,
      `path     : ${e.path ?? '-'}`,
      ``,
      `message:`,
      e.message.slice(0, 300),
      ``,
      `※ 同一エラーの即時通知は60分に1通に抑制されます。詳細は Supabase の error_logs を確認してください。`,
    ].join('\n'),
  }
}

export function buildDigestMail(day: string, rows: DigestRow[]): { subject: string; text: string } {
  const total = rows.reduce((s, r) => s + r.count, 0)
  const subject = `【HIBIKI】エラー日次まとめ ${day}: ${rows.length}種 / ${total}件`
  if (rows.length === 0) {
    return { subject: `【HIBIKI】エラー日次まとめ ${day}: 0件`, text: `${day} のエラーはありませんでした。（監視は稼働中）` }
  }
  const lines = rows.map((r) =>
    `[${r.severity}] ${r.action_name} (${r.source}) tenant=${r.tenant_id} ×${r.count}\n    ${r.message.slice(0, 120)}`,
  )
  return { subject, text: [`${day} に発生したエラー（種類別・件数順）`, ``, ...lines].join('\n') }
}
```

- [ ] **Step 5: 実行して成功を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/notify.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add web/src/app/_actions/emailCore.ts web/src/utils/error-monitor/notify.ts web/src/utils/error-monitor/notify.test.ts
git commit -m "feat(error-monitor): 即時通知判定・メール本文・管理者宛て送信

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `captured()` / `capturedRoute()` / `reportError()`

**Files:**
- Create: `web/src/utils/error-monitor/captured.ts`
- Test: `web/src/utils/error-monitor/captured.test.ts`

**Interfaces:**
- Consumes: Task 1〜6 の全 export
- Produces:
  - `captured<T>(actionName: string, fn: () => Promise<T>, ctx?: CaptureContext): Promise<T | { data: null; error: string }>`
  - `capturedRoute<A extends unknown[]>(routeName: string, handler: (...a: A) => Promise<Response>, source?: 'route'|'cron'): (...a: A) => Promise<Response>`
  - `reportError(input: { source: Source; actionName: string; message: string; stack?: string | null; ctx?: CaptureContext }, deps?: Deps): Promise<void>`
  - `GENERIC_ERROR_MESSAGE = '処理に失敗しました'`
  - テスト差し替え用 `type Deps = { sink: ErrorSink; send: (subject: string, text: string) => Promise<unknown>; isProduction: boolean; now?: () => Date }`

- [ ] **Step 1: 失敗するテスト**

```ts
// web/src/utils/error-monitor/captured.test.ts
import { describe, it, expect, vi } from 'vitest'
import { captured, capturedRoute, GENERIC_ERROR_MESSAGE, type Deps } from './captured'
import type { ErrorSink } from './types'

function makeDeps(over: Partial<Deps> = {}): Deps & { sink: ErrorSink & { record: ReturnType<typeof vi.fn>; markNotified: ReturnType<typeof vi.fn> } } {
  const sink = {
    record: vi.fn().mockResolvedValue({ id: 'i', count: 1, notifiedAt: null }),
    markNotified: vi.fn().mockResolvedValue(undefined),
  }
  return { sink, send: vi.fn().mockResolvedValue({ ok: true }), isProduction: true, ...over }
}

describe('captured', () => {
  it('正常は透過し記録しない', async () => {
    const d = makeDeps()
    const r = await captured('listUsers', async () => ({ data: [1], error: null }), undefined, d)
    expect(r).toEqual({ data: [1], error: null })
    expect(d.sink.record).not.toHaveBeenCalled()
  })
  it('業務 {error} は透過し記録しない', async () => {
    const d = makeDeps()
    const r = await captured('listUsers', async () => ({ data: null, error: '委託先が見つかりません' }), undefined, d)
    expect(r).toEqual({ data: null, error: '委託先が見つかりません' })
    expect(d.sink.record).not.toHaveBeenCalled()
  })
  it('システム {error} は透過し記録する（message はマスク済み）', async () => {
    const d = makeDeps()
    const r = await captured('listUsers', async () => ({ data: null, error: 'duplicate key 1234567 a@b.jp' }), { tenantId: 't1' }, d)
    expect(r).toEqual({ data: null, error: 'duplicate key 1234567 a@b.jp' })
    expect(d.sink.record).toHaveBeenCalledTimes(1)
    const ev = d.sink.record.mock.calls[0][0]
    expect(ev.message).toBe('duplicate key [digits] ***@b.jp')
    expect(ev.tenantId).toBe('t1')
    expect(ev.severity).toBe('normal')
  })
  it('例外は固定文言に変換して記録する', async () => {
    const d = makeDeps()
    const r = await captured('upsertSchedule', async () => { throw new Error('connection refused') }, undefined, d)
    expect(r).toEqual({ data: null, error: GENERIC_ERROR_MESSAGE })
    expect(d.sink.record.mock.calls[0][0].severity).toBe('critical')
  })
  it('critical 例外は即時メールを送り markNotified する', async () => {
    const d = makeDeps()
    await captured('upsertSchedule', async () => { throw new Error('x') }, undefined, d)
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.sink.markNotified).toHaveBeenCalledWith('i')
  })
  it('60分以内に通知済みなら送らない', async () => {
    const d = makeDeps()
    d.sink.record.mockResolvedValue({ id: 'i', count: 2, notifiedAt: new Date().toISOString() })
    await captured('upsertSchedule', async () => { throw new Error('x') }, undefined, d)
    expect(d.send).not.toHaveBeenCalled()
  })
  it('production でなければ記録はするがメールは送らない', async () => {
    const d = makeDeps({ isProduction: false })
    await captured('upsertSchedule', async () => { throw new Error('x') }, undefined, d)
    expect(d.sink.record).toHaveBeenCalledTimes(1)
    expect(d.send).not.toHaveBeenCalled()
  })
  it('Next の redirect/notFound は再スローする（記録しない）', async () => {
    const d = makeDeps()
    const redirectErr = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/admin;307;' })
    await expect(captured('login', async () => { throw redirectErr }, undefined, d)).rejects.toBe(redirectErr)
    expect(d.sink.record).not.toHaveBeenCalled()
  })
  it('sink が例外を投げても戻り値は変わらない', async () => {
    const d = makeDeps()
    d.sink.record.mockRejectedValue(new Error('db down'))
    const r = await captured('upsertSchedule', async () => { throw new Error('x') }, undefined, d)
    expect(r).toEqual({ data: null, error: GENERIC_ERROR_MESSAGE })
    const r2 = await captured('listUsers', async () => ({ data: null, error: 'PGRST301' }), undefined, d)
    expect(r2).toEqual({ data: null, error: 'PGRST301' })
  })
})

describe('capturedRoute', () => {
  it('例外を記録し 500 JSON を返す。cron は critical', async () => {
    const d = makeDeps()
    const h = capturedRoute('cron/defensive-alerts', async () => { throw new Error('boom') }, 'cron', d)
    const res = await h()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE })
    expect(d.sink.record.mock.calls[0][0]).toMatchObject({ source: 'cron', severity: 'critical', actionName: 'cron/defensive-alerts' })
  })
  it('正常は透過', async () => {
    const d = makeDeps()
    const h = capturedRoute('x', async () => new Response('ok'), 'route', d)
    expect(await (await h()).text()).toBe('ok')
    expect(d.sink.record).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/captured.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// web/src/utils/error-monitor/captured.ts
import { mask, MESSAGE_MAX, STACK_MAX } from './mask'
import { isSystemError, severityFor } from './classify'
import { fingerprint } from './fingerprint'
import { createSupabaseSink } from './sink'
import { shouldNotifyImmediately, buildImmediateMail } from './notify'
import { sendAdminAlertEmail } from '@/app/_actions/emailCore'
import type { CaptureContext, ErrorEvent, ErrorSink, Source } from './types'

export const GENERIC_ERROR_MESSAGE = '処理に失敗しました'

export type Deps = {
  sink:         ErrorSink
  send:         (subject: string, text: string) => Promise<unknown>
  isProduction: boolean
  now?:         () => Date
}

let defaultDeps: Deps | null = null
function getDeps(): Deps {
  if (!defaultDeps) {
    defaultDeps = {
      sink:         createSupabaseSink(),
      send:         sendAdminAlertEmail,
      isProduction: process.env.NODE_ENV === 'production',
    }
  }
  return defaultDeps
}

/** Next.js 内部の制御フロー例外（redirect / notFound）。捕まえてはいけない */
function isNextControlFlow(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND') || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK'))
}

function hasErrorString(v: unknown): v is { error: string } {
  return typeof v === 'object' && v !== null && typeof (v as { error?: unknown }).error === 'string' && (v as { error: string }).error !== ''
}

/**
 * Cloudflare Workers では応答後の処理を waitUntil に載せる。取れない環境（vitest / next dev）は await。
 * ⚠️ @opennextjs/cloudflare の getCloudflareContext は Workers 外で throw するため try で囲む（未検証: Workers 実機で waitUntil が取れるかは Task 13 の導通で確認）。
 */
async function runAfterResponse(task: () => Promise<void>): Promise<void> {
  try {
    const mod = await import('@opennextjs/cloudflare')
    const ctx = (mod as { getCloudflareContext?: () => { ctx?: { waitUntil?: (p: Promise<unknown>) => void } } }).getCloudflareContext?.()
    if (ctx?.ctx?.waitUntil) { ctx.ctx.waitUntil(task()); return }
  } catch { /* Workers 外 */ }
  await task()
}

/**
 * エラー1件を 整形→記録→（critical なら）即時通知 する。失敗は握りつぶす。
 * 業務処理の結果を変えないため、ここから例外を外に出してはならない。
 */
export async function reportError(
  input: { source: Source; actionName: string; message: string; stack?: string | null; ctx?: CaptureContext },
  deps: Deps = getDeps(),
): Promise<void> {
  try {
    const message = mask(input.message || '(no message)', MESSAGE_MAX)
    const stack   = input.stack ? mask(input.stack, STACK_MAX) : null
    const event: ErrorEvent = {
      fingerprint:  fingerprint(input.source, input.actionName, message),
      source:       input.source,
      actionName:   input.actionName,
      severity:     severityFor(input.source, input.actionName),
      message,
      stack,
      path:         input.ctx?.path ?? null,
      tenantId:     input.ctx?.tenantId ?? null,
      userId:       input.ctx?.userId ?? null,
      contractorId: input.ctx?.contractorId ?? null,
    }
    const rec = await deps.sink.record(event)
    const now = deps.now?.() ?? new Date()
    if (deps.isProduction && shouldNotifyImmediately(event, rec, now)) {
      const mail = buildImmediateMail(event, rec, now)
      await deps.send(mail.subject, mail.text)
      await deps.sink.markNotified(rec.id)
    }
  } catch (e) {
    console.error('[error-monitor] 記録/通知に失敗:', e instanceof Error ? e.message : e)
  }
}

/**
 * Server Action の本体を包む。spec §3。
 *   export async function foo(...) { return captured('foo', async () => { ...本体... }, ctx) }
 * - 例外 → 記録して { data: null, error: '処理に失敗しました' }
 * - 戻り値 {error} がシステム由来 → 記録して戻り値はそのまま
 * - 業務 {error} / 正常 → 何もしない
 * - redirect()/notFound() は再スロー
 */
export async function captured<T>(
  actionName: string,
  fn: () => Promise<T>,
  ctx?: CaptureContext,
  deps: Deps = getDeps(),
): Promise<T | { data: null; error: string }> {
  let result: T
  try {
    result = await fn()
  } catch (e) {
    if (isNextControlFlow(e)) throw e
    const err = e instanceof Error ? e : new Error(String(e))
    await runAfterResponse(() => reportError({ source: 'action', actionName, message: err.message, stack: err.stack ?? null, ctx }, deps))
    return { data: null, error: GENERIC_ERROR_MESSAGE }
  }
  if (hasErrorString(result) && isSystemError(result.error)) {
    await runAfterResponse(() => reportError({ source: 'action', actionName, message: result.error, ctx }, deps))
  }
  return result
}

/** API route handler を包む。例外を記録し 500 を返す */
export function capturedRoute<A extends unknown[]>(
  routeName: string,
  handler: (...args: A) => Promise<Response>,
  source: 'route' | 'cron' = 'route',
  deps: Deps = getDeps(),
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args)
    } catch (e) {
      if (isNextControlFlow(e)) throw e
      const err = e instanceof Error ? e : new Error(String(e))
      const req = args[0] as { nextUrl?: { pathname?: string } } | undefined
      await runAfterResponse(() => reportError({ source, actionName: routeName, message: err.message, stack: err.stack ?? null, ctx: { path: req?.nextUrl?.pathname ?? null } }, deps))
      return Response.json({ error: GENERIC_ERROR_MESSAGE }, { status: 500 })
    }
  }
}
```

- [ ] **Step 4: 実行して成功を確認**

Run: `cd web && npx vitest run src/utils/error-monitor/`
Expected: PASS（全ファイル）。`@opennextjs/cloudflare` の動的 import が vitest で失敗する場合は catch に落ちて await 経路になるので、テストは通る。

- [ ] **Step 5: 既存テスト全体と型チェック**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: 全 PASS、型エラー 0

- [ ] **Step 6: コミット**

```bash
git add web/src/utils/error-monitor/captured.ts web/src/utils/error-monitor/captured.test.ts
git commit -m "feat(error-monitor): captured/capturedRoute ラッパーと reportError

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: critical Server Action 6本に `captured` を適用

**Files:**
- Modify: `web/src/app/login/actions.ts`（`login`）
- Modify: `web/src/app/_actions/scheduleActions.ts:267`（`upsertSchedule`）、`:309`（`bulkUpsertSchedules`）
- Modify: `web/src/app/_actions/workRecordActions.ts:281`（`submitWorkRecord`）
- Modify: `web/src/app/admin/billing/actions.ts:635`（`generatePaymentNotice`）、`:771`（`generateAllPaymentNotices`）

**Interfaces:**
- Consumes: `captured` (Task 7)

適用パターン（全6本で同じ）: export 行と戻り値型はそのまま。本体を `return captured('<関数名>', async () => { ...元の本体... })` で包む。文脈は元の本体で `tenantId` / `user.id` / `contractorId` が取れているが、それらは本体内部の変数で `captured` の第3引数に渡せない。**第1段では ctx を渡さない**（tenant は第2段で `captured` の内部から `getCurrentTenantId()` を try で引く改良を検討。今回は記録の有無を優先）。

- [ ] **Step 1: `login` を包む**

`web/src/app/login/actions.ts`:
```ts
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { captured } from '@/utils/error-monitor/captured'

export async function login(formData: FormData) {
  return captured('login', async () => {
    const supabase = await createClient()

    const { error } = await supabase.auth.signInWithPassword({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    })

    if (error) {
      const msg = error.message === 'Invalid login credentials'
        ? 'メールアドレスまたはパスワードが正しくありません'
        : error.message
      return { error: msg }
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { error: '認証に失敗しました。' }
    }

    // ⚠️ anonキー(RLS経由)ではなく service_role で直接引く（middleware.ts と同じ判定に揃える）
    const service = createServiceClient()
    const { data: userData } = await service
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    const role = userData?.role ?? user.user_metadata?.role

    // ⚠️ redirect() は例外（NEXT_REDIRECT）で制御を移す。captured は digest を見て再スローする
    if (role === 'master') {
      redirect('/admin')
    } else {
      redirect('/driver/schedule')
    }
  })
}
```

- [ ] **Step 2: 残り5本を同じ形で包む**

各関数について: `export async function X(...): Promise<ActionResult<...>> {` の直後に `return captured('X', async () => {` を挿入し、関数末尾の `}` の直前に `})` を追加。本体のインデントは既存に合わせて1段深くする（機械的な編集。差分は本体の字下げのみになるよう `git diff -w` で確認）。import 行 `import { captured } from '@/utils/error-monitor/captured'` を各ファイル先頭の import 群に追加。

対象と `captured` 第1引数:
| ファイル | 関数 | 第1引数 |
|---|---|---|
| `_actions/scheduleActions.ts` | `upsertSchedule` | `'upsertSchedule'` |
| `_actions/scheduleActions.ts` | `bulkUpsertSchedules` | `'bulkUpsertSchedules'` |
| `_actions/workRecordActions.ts` | `submitWorkRecord` | `'submitWorkRecord'` |
| `admin/billing/actions.ts` | `generatePaymentNotice` | `'generatePaymentNotice'` |
| `admin/billing/actions.ts` | `generateAllPaymentNotices` | `'generateAllPaymentNotices'` |

⚠️ 第1引数は `CRITICAL_ACTIONS`（Task 1）の文字列と完全一致させること。一致しないと severity が normal になる。

- [ ] **Step 3: 型チェック・既存テスト・`use-server-exports` テスト**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: 型エラー 0（`captured` の戻り値 `T | {data:null; error:string}` は `ActionResult<T>` に代入可能）。`use-server-exports.test.ts` PASS（export 形式は変えていない）。

- [ ] **Step 4: ローカル動作確認**

`preview_start`（`.claude/launch.json` の既存設定）で dev サーバー起動 → ログイン → ドライバーでスケジュール1件登録 → `read_page` で成功表示を確認。`preview_logs` に `[error-monitor]` のエラーが出ていないこと。

- [ ] **Step 5: `git diff -w` で本体の変更がないことを目視**

Run: `git diff -w --stat && git diff -w web/src/app/_actions/scheduleActions.ts | head -60`
Expected: 各関数で追加は import 1行・`return captured(...)` 1行・`})` 1行のみ。

- [ ] **Step 6: コミット**

```bash
git add web/src/app/login/actions.ts web/src/app/_actions/scheduleActions.ts web/src/app/_actions/workRecordActions.ts web/src/app/admin/billing/actions.ts
git commit -m "feat(error-monitor): critical な Server Action 6本を captured で包む

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: API route 5本に `capturedRoute` を適用

**Files:**
- Modify: `web/src/app/api/cron/defensive-alerts/route.ts:24`（`GET`、source `'cron'`）
- Modify: `web/src/app/api/admin/defensive-alerts/route.ts:9`（`GET`）
- Modify: `web/src/app/api/scan/upload/route.ts:68,194`（`POST`, `GET`）
- Modify: `web/src/app/api/hibiki/voice/intent/route.ts:54`（`POST`）
- Modify: `web/src/app/api/hibiki/invoice/html/route.ts:12`（`GET`）

**Interfaces:**
- Consumes: `capturedRoute` (Task 7)

パターン: `export async function GET(req: NextRequest) {` を `async function handleGet(req: NextRequest) {` に改名し、末尾に `export const GET = capturedRoute('<route名>', handleGet)` を追加。route.ts は `'use server'` ではないので `export const` は問題ない。

- [ ] **Step 1: cron ルート**

`web/src/app/api/cron/defensive-alerts/route.ts`: import に `import { capturedRoute } from '@/utils/error-monitor/captured'` を追加。`export async function GET(req: NextRequest) {` → `async function handleGet(req: NextRequest) {`。ファイル末尾に:
```ts
// 予期しない例外（既存の try/catch を抜けるもの）を error_logs に critical で記録し 500 を返す
export const GET = capturedRoute('cron/defensive-alerts', handleGet, 'cron')
```

- [ ] **Step 2: 残り4ファイル**

| ファイル | 元 export | 改名 | 追加行 |
|---|---|---|---|
| `admin/defensive-alerts/route.ts` | `GET()` | `handleGet()` | `export const GET = capturedRoute('admin/defensive-alerts', handleGet)` |
| `scan/upload/route.ts` | `POST(req)` | `handlePost(req)` | `export const POST = capturedRoute('scan/upload:POST', handlePost)` |
| `scan/upload/route.ts` | `GET(req)` | `handleGet(req)` | `export const GET = capturedRoute('scan/upload:GET', handleGet)` |
| `hibiki/voice/intent/route.ts` | `POST(req)` | `handlePost(req)` | `export const POST = capturedRoute('hibiki/voice/intent', handlePost)` |
| `hibiki/invoice/html/route.ts` | `GET(req)` | `handleGet(req)` | `export const GET = capturedRoute('hibiki/invoice/html', handleGet)` |

各ファイルに `import { capturedRoute } from '@/utils/error-monitor/captured'` を追加。

- [ ] **Step 3: 型チェック・ビルド**

Run: `cd web && npx tsc --noEmit && npx next build 2>&1 | tail -15`
Expected: 型エラー 0。ビルド成功（`export const GET` は Next の route 規約で許容される）。
⚠️ `.next/` が生成される。コミット対象に含めないこと。

- [ ] **Step 4: ローカル導通**

dev サーバーで `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/cron/defensive-alerts`（secret なし）→ `401` のまま（ラッパーが正常経路を変えていない）。

- [ ] **Step 5: コミット**

```bash
git status --short   # .next/ が無いことを確認
git add web/src/app/api/cron/defensive-alerts/route.ts web/src/app/api/admin/defensive-alerts/route.ts web/src/app/api/scan/upload/route.ts web/src/app/api/hibiki/voice/intent/route.ts web/src/app/api/hibiki/invoice/html/route.ts
git commit -m "feat(error-monitor): API route 5本を capturedRoute で包む

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: エラー境界と `reportClientError`

**Files:**
- Create: `web/src/app/_actions/errorReportActions.ts`
- Create: `web/src/app/admin/error.tsx`
- Create: `web/src/app/driver/error.tsx`
- Create: `web/src/app/global-error.tsx`
- Create: `web/src/components/ErrorFallback.tsx`

**Interfaces:**
- Consumes: `reportError` (Task 7)
- Produces: Server Action `reportClientError(input: { message: string; digest?: string; path: string; segment: string }): Promise<void>`

- [ ] **Step 1: Server Action**

```ts
// web/src/app/_actions/errorReportActions.ts
'use server'

import { reportError } from '@/utils/error-monitor/captured'

/**
 * error.tsx / global-error.tsx から呼ばれる。ログイン前でも起きるため認可チェックはしない。
 * 受け取る文字列は長さを切り、reportError 側でマスクされる。
 * ⚠️ 公開 RPC になるため、入力は文字列3つに限定し、DB へは reportError 経由（service_role）でのみ書く。
 */
export async function reportClientError(input: { message: string; digest?: string; path: string; segment: string }): Promise<void> {
  const message = String(input.message ?? '').slice(0, 2000)
  const digest  = input.digest ? String(input.digest).slice(0, 100) : ''
  const path    = String(input.path ?? '').slice(0, 300)
  const segment = String(input.segment ?? 'root').slice(0, 30)
  await reportError({
    source:     'boundary',
    actionName: `boundary:${segment}`,
    message:    digest ? `${message} [digest ${digest}]` : message,
    ctx:        { path },
  })
}
```

- [ ] **Step 2: 共通 fallback コンポーネント**

```tsx
// web/src/components/ErrorFallback.tsx
'use client'

import { useEffect, useRef } from 'react'
import { reportClientError } from '@/app/_actions/errorReportActions'

type Props = {
  error:   Error & { digest?: string }
  reset:   () => void
  segment: string
}

/** error.tsx / global-error.tsx 共通。マウント時に1回だけサーバーへ報告する。生メッセージは表示しない */
export default function ErrorFallback({ error, reset, segment }: Props) {
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    reportClientError({
      message: error?.message ?? '',
      digest:  error?.digest,
      path:    typeof window !== 'undefined' ? window.location.pathname : '',
      segment,
    }).catch(() => { /* 報告失敗は無視 */ })
  }, [error, segment])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold">エラーが発生しました</p>
      <p className="text-sm text-gray-600">時間をおいて再度お試しください。続く場合は事務所へご連絡ください。</p>
      <button type="button" onClick={reset} className="rounded bg-gray-800 px-4 py-2 text-white">再読み込み</button>
    </div>
  )
}
```

- [ ] **Step 3: 境界3つ**

```tsx
// web/src/app/admin/error.tsx
'use client'
import ErrorFallback from '@/components/ErrorFallback'
export default function AdminError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorFallback {...props} segment="admin" />
}
```
```tsx
// web/src/app/driver/error.tsx
'use client'
import ErrorFallback from '@/components/ErrorFallback'
export default function DriverError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorFallback {...props} segment="driver" />
}
```
```tsx
// web/src/app/global-error.tsx
'use client'
import ErrorFallback from '@/components/ErrorFallback'
// ⚠️ global-error は root layout を置き換えるため <html><body> を自前で持つ必要がある
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body>
        <ErrorFallback {...props} segment="root" />
      </body>
    </html>
  )
}
```

- [ ] **Step 4: 型チェック・テスト**

Run: `cd web && npx tsc --noEmit && npx vitest run src/utils/use-server-exports.test.ts`
Expected: PASS（`errorReportActions.ts` は async 関数のみ export）

- [ ] **Step 5: ローカル導通**

一時的に `web/src/app/admin/page.tsx` の先頭で `throw new Error('boundary test 1234567')` を入れ dev で `/admin` を開く → `read_page` で「エラーが発生しました」表示を確認 → `preview_logs` に `[error-monitor]` の失敗が出ていないこと → テスト側 Supabase で `SELECT action_name, message FROM error_logs ORDER BY last_seen_at DESC LIMIT 1` が `boundary:admin` / `boundary test [digits]`。確認後 throw を**必ず削除**し `git diff web/src/app/admin/page.tsx` が空であること。

- [ ] **Step 6: コミット**

```bash
git add web/src/app/_actions/errorReportActions.ts web/src/components/ErrorFallback.tsx web/src/app/admin/error.tsx web/src/app/driver/error.tsx web/src/app/global-error.tsx
git commit -m "feat(error-monitor): error.tsx/global-error.tsx と reportClientError を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 日次まとめ cron + 保持期限 + workflow

**Files:**
- Create: `web/src/app/api/cron/error-digest/route.ts`
- Modify: `.github/workflows/defensive-alerts-cron.yml`

**Interfaces:**
- Consumes: `buildDigestMail`, `DigestRow` (Task 6)、`sendAdminAlertEmail` (Task 6)、`capturedRoute` (Task 7)、RPC `purge_error_logs` (Task 4)

- [ ] **Step 1: ルート**

```ts
// web/src/app/api/cron/error-digest/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/service'
import { capturedRoute } from '@/utils/error-monitor/captured'
import { buildDigestMail, type DigestRow } from '@/utils/error-monitor/notify'
import { sendAdminAlertEmail } from '@/app/_actions/emailCore'

/** error_logs の保持日数。spec §5 */
const RETENTION_DAYS = 90

/** JST 基準の「前日」を YYYY-MM-DD で返す */
function yesterdayJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000)
  jst.setUTCDate(jst.getUTCDate() - 1)
  return jst.toISOString().slice(0, 10)
}

// GitHub Actions（毎日 JST 9:00、defensive-alerts と同じ workflow）から x-cron-secret 付きで呼ばれる。
// fail-closed: シークレット不一致・未設定なら何もしない。
// 0件でも「0件」を送る（監視が生きていることの確認）。
async function handleGet(req: NextRequest) {
  const secret   = req.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db  = createServiceClient() as any
  const day = yesterdayJst()

  const { data, error } = await db
    .from('error_logs')
    .select('severity, tenant_id, action_name, source, count, message')
    .eq('day', day)
    .order('count', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as DigestRow[]
  const mail = buildDigestMail(day, rows)
  const sent = await sendAdminAlertEmail(mail.subject, mail.text)

  // 保持期限超の削除。失敗しても日次メールの結果は返す
  let purged: number | null = null
  try {
    const { data: n, error: pErr } = await db.rpc('purge_error_logs', { p_days: RETENTION_DAYS })
    purged = pErr ? null : (n as number)
  } catch { purged = null }

  return NextResponse.json({ day, groups: rows.length, sent: sent.ok, sendError: sent.ok ? null : sent.error, purged })
}

export const GET = capturedRoute('cron/error-digest', handleGet, 'cron')
```

- [ ] **Step 2: workflow に step 追加**

`.github/workflows/defensive-alerts-cron.yml` の末尾（既存 step の後）に:
```yaml
      # エラー監視の日次まとめ（前日分・0件でも送る）。URL は上と同じく APP_BASE_URL 変数経由。
      - name: Call error-digest cron endpoint
        if: always()
        env:
          BASE_URL: ${{ vars.APP_BASE_URL || 'https://unsou-system.hibiki-app.workers.dev' }}
        run: |
          curl -f -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
            "$BASE_URL/api/cron/error-digest"
```
`if: always()` で防御アラート側が失敗しても日次まとめは送る。

- [ ] **Step 3: ローカル導通**

dev サーバーで `.env.local` の `CRON_SECRET` を使い:
```bash
curl -s -H "x-cron-secret: $(grep '^CRON_SECRET=' web/.env.local | cut -d= -f2-)" http://localhost:3000/api/cron/error-digest
```
Expected: `{"day":"2026-09-01","groups":N,"sent":false,"sendError":"ADMIN_ALERT_EMAIL が未設定です",...}` または `RESEND_API_KEY` 未設定時はモック送信で `sent:true`。`preview_logs` に `[emailCore] メール送信（モック）` と件名「エラー日次まとめ」が出ること。

- [ ] **Step 4: 型チェック・コミット**

```bash
cd web && npx tsc --noEmit
cd .. && git add web/src/app/api/cron/error-digest/route.ts .github/workflows/defensive-alerts-cron.yml
git commit -m "feat(error-monitor): 日次まとめ cron ルートと保持期限削除、workflow step 追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: 引き継ぎドキュメント更新

**Files:**
- Modify: `docs/HANDOVER_MASTER.md` §5-5（ファイルマップ）、§5-7（テーブル）、§5-10 付近の env/cron 記述

⚠️ `docs/HANDOVER_MASTER.md` には前セッション由来の未コミット変更がある。`git stash` はしない。既存の変更は触らず、追記のみ行い、自分の追記分だけを `git add -p` で選んでコミットする。

- [ ] **Step 1: §5-5 ファイルマップに追記**

`└── utils/` ブロック内に:
```
    ├── error-monitor/                  ★ 本番エラー監視（2026-09-02）。captured() で Server Action 本体を包む
    │   ├── captured.ts                 captured / capturedRoute / reportError
    │   ├── critical-actions.ts         即時メール対象の Action 名（export 名と完全一致させる）
    │   ├── mask.ts / classify.ts / fingerprint.ts / sink.ts / notify.ts
```
`app/_actions/` ブロック内に `errorReportActions.ts  error.tsx からのクライアントエラー報告`、`app/api/cron/error-digest/route.ts  エラー日次まとめ + 90日保持削除` を追記。

- [ ] **Step 2: §5-7 テーブル表に行追加**

```
| `error_logs` | 本番エラー記録（fingerprint×日×tenant で集約） | service_role 専用（RLS有効・ポリシーなし）。書込は RPC record_error_log のみ。不変ログ規約の対象外。90日で削除 |
```

- [ ] **Step 3: 運用メモ**

§5-10 の env 一覧の `ADMIN_ALERT_EMAIL` 行に「エラー監視の即時メール・日次まとめの宛先でもある」を追記。cron の説明箇所に「同 workflow から `/api/cron/error-digest` も呼ぶ」を追記。仕様書パスへのリンクを1行添える。

- [ ] **Step 4: コミット（追記分だけ）**

```bash
git add -p docs/HANDOVER_MASTER.md   # 自分の追記ハンクだけ y
git diff --cached --stat
git commit -m "docs: HANDOVER に本番エラー監視（error-monitor / error_logs / error-digest）を追記

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: 本番導通確認（ユーザー確認を都度取る）

**Files:**
- 一時: `web/src/app/_actions/errorMonitorConductionActions.ts`（確認後に削除）

⚠️ 以下は本番 DB・本番デプロイに触れる。**各コマンドを1つずつ提示し、ユーザーの確認を得てから実行**（CLAUDE.md §2）。

- [ ] **Step 1: 本番マイグレーション適用**

hibiki-production-org のプロジェクトは MCP から見えないため、Supabase ダッシュボードの SQL Editor で `supabase/migrations/20260902000000_error_logs.sql` を実行してもらう（ユーザー操作）。確認: `SELECT to_regclass('public.error_logs'), to_regproc('public.record_error_log');` が両方非 NULL。

- [ ] **Step 2: 導通用 Action を一時追加**

```ts
// web/src/app/_actions/errorMonitorConductionActions.ts  ← 導通確認後に削除する
'use server'

import { requireOwner } from '@/utils/auth'
import { captured } from '@/utils/error-monitor/captured'

/** 導通確認専用。owner のみ。意図的に例外を投げて error_logs と即時メールを確認する */
export async function throwForConductionTest(): Promise<{ data: null; error: string }> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  return captured('upsertSchedule', async () => {
    throw new Error('conduction test 1234567 test@example.com')
  }) as Promise<{ data: null; error: string }>
}
```
`web/src/app/admin/settings/company/page.tsx` 等、owner のみが見る画面に一時的にボタンを置いて呼ぶ（差分は最小・確認後に戻す）。

- [ ] **Step 3: デプロイ**

既存の `.github/workflows/deploy.yml` の手順に従う（push → Actions）。コミット前3ステップを通す。

- [ ] **Step 4: 本番で1回実行して確認**

1. 本番でボタンを1回押す → 画面に「処理に失敗しました」
2. 本番 SQL Editor: `SELECT action_name, severity, message, count, notified_at FROM error_logs ORDER BY last_seen_at DESC LIMIT 3;` → `upsertSchedule` / `critical` / `conduction test [digits] ***@example.com` / `notified_at` 非 NULL
3. `ADMIN_ALERT_EMAIL` の受信箱に「【HIBIKI】エラー検知: upsertSchedule」が届く
4. もう1回押す → `count` が 2、メールは**届かない**（60分抑制）
5. GitHub Actions で `Defensive Alerts Cron` を `workflow_dispatch` → 「エラー日次まとめ」メールが届く（前日分なので 0件表記でよい）

`waitUntil` が取れず応答が遅い場合は `preview_logs` 相当（Cloudflare ダッシュボードの Workers ログ）で `[error-monitor]` を確認。

- [ ] **Step 5: 導通 Action とボタンを削除してデプロイ**

```bash
git rm web/src/app/_actions/errorMonitorConductionActions.ts
git checkout -- web/src/app/admin/settings/company/page.tsx   # ボタンを戻す
git commit -m "chore(error-monitor): 導通確認用 Action を削除

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
本番 `error_logs` の導通行は削除しない（記録として残す。90日で自動削除）。

- [ ] **Step 6: HANDOVER に導通結果を1行追記して `/clear` を提案**

---

## Self-Review

**Spec coverage**
- §1 方式A-2・本体ラップ → Task 7, 8
- §3 captured / isSystemError / capturedRoute / エラー境界 / reportClientError → Task 1, 7, 9, 10
- §4 マスキング6項目 → Task 2（引数不保存は captured の設計で担保、Task 7）
- §5 error_logs / RPC / RLS / 集約 / NULL tenant 写像 / 保持90日 → Task 4, 5, 11
- §6 severity / 即時60分抑制 / production 条件 / 日次まとめ0件送信 / workflow / waitUntil → Task 1, 6, 7, 11
- §7 第1段適用範囲 → Task 8, 9, 10
- §8 テスト・導通 → 各 Task のテスト、Task 13
- §9 セキュリティ → Task 4（REVOKE）, Task 10（公開 RPC の入力制限）, Global Constraints
- **spec からの差分**: 文脈（tenantId 等）を `captured` に渡す設計だったが、第1段の6本では本体内変数のため渡せない。第1段は文脈なしで記録し、第2段で改良（Task 8 に明記）。spec §3 に注記を追記すること（実装開始時に spec を1行修正）。

**Placeholder scan**: なし。

**Type consistency**: `Deps` は Task 7 のみ。`DigestRow` は Task 6 定義・Task 11 使用で列名一致（`severity, tenant_id, action_name, source, count, message`）。`ErrorRecordResult.notifiedAt` は sink で `notified_at` から写像、notify で参照。RPC 引数名 `p_*` は Task 4 と Task 5 で一致。
