# 5大防衛アラート：Resendメール通知の復活 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ①入力遅延・⑤長期未承認の2アラートに限り、Resend経由のメール自動送信（1日1回・未送信のみ）と管理者による手動再送信ボタンの両方を復活させる。あわせて`fetchLongPendingNotices()`のtenant_idフィルタ欠落バグを修正する。

**Architecture:** 実際のDB取得ロジック（`fetchMissingInputs`/`fetchLongPendingNotices`）とメール送信本体（`deliverAlertEmail`）を、認可チェックを持たない共通処理として新設する。`notification_logs.alert_key`（新設列）で「同一アラートへの既存レコードがあれば自動送信をスキップ」する重複防止を行う。GitHub Actions（毎日 JST 9:00）→シークレットヘッダーで保護されたNext.js APIルート（`/api/cron/defensive-alerts`）→全テナット横断ループ、という経路で自動送信し、管理画面の「📧 メール再送信」ボタンから同じ`alert_key`を使って手動再送信もできるようにする。

**Tech Stack:** Next.js App Router（Server Actions + Route Handler）, Supabase（service-role client）, Resend, GitHub Actions, Vitest（新規に導入されたユニットテスト基盤を流用）

## Global Constraints

- 対象アラートは①入力遅延・⑤長期未承認の2つのみ（②重複・③しきい値・④インボイス警告は対象外・変更なし）。
- 自動送信トリガーはGitHub Actions定期実行（`cron: '0 0 * * *'` = UTC 0:00 = JST 9:00）。Cloudflare Cron Triggerや`@opennextjs/cloudflare`のビルド生成物への直接介入は行わない（本番ビルド破損リスクのため不採用と確定済み）。
- 重複防止は`notification_logs.alert_key`列の「既存レコードがあれば自動送信をスキップ」方式。手動再送信ボタンは常に送信を実行する（dedupチェックをバイパスする）。
- `notification_logs`の不変ログ方針（`UPDATE`/`DELETE`全ロール禁止、`INSERT`のみ）は変更しない。列追加のみ。
- **設計書からの是正点（実装前に承認済み）：** 設計書§5は「`getMissingInputs()`に`tenantId`引数を追加してcronから呼ぶ」としていたが、この関数は`requireOwner()`（ログインセッション必須）でガードされており、GitHub Actionsからのcron呼び出しにはセッションが存在しないため、文字通り実装すると本番で必ず401相当のエラーになる。対策として、実際のDB取得ロジックを`'use server'`指定のない新規プレーンモジュール`web/src/app/_actions/defensiveAlertQueries.ts`に切り出し、①管理画面向けの既存関数（`requireOwner()`でガード）と②cronルート（シークレットヘッダーでガード）の両方がそこを呼ぶ形にする。外部から見た挙動（画面・権限）は変わらない。
- **テスト方針：** このリポジトリには自動テスト基盤がほぼ存在せず（`vitest`で検証済みなのは`crypto.test.ts`の1ファイルのみ）、DB/Resend/GitHub Actionsをモックする仕組みもない。設計書§9でも「実地確認（curlでの直接テスト・管理画面での実操作・本番メール受信確認）」を明示的な検証方法として選んでいる。よって本プランでは、**副作用のない純粋関数（`buildAlertKey`・`buildMissingInputMessage`・`buildPendingNoticeMessage`）のみTDDでユニットテストを書き**、DB・メール送信・cronルートについては各タスクの型チェックに加え、最終タスク（Task 10）で設計書§9の手順により実地検証する。

---

### Task 1: DBマイグレーション — `notification_logs.alert_key` 追加

**Files:**
- Create: `supabase/migrations/20260710000000_add_alert_key_to_notification_logs.sql`

**Interfaces:**
- Produces: `notification_logs`テーブルに`alert_key TEXT`列（NULL許容）と`idx_notification_logs_alert_key`インデックスが存在する状態。以降のタスクはこの列にINSERT/SELECTする。

- [ ] **Step 1: マイグレーションファイルを作成**

```sql
-- ================================================================
-- notification_logs.alert_key 追加
-- 5大防衛アラートのメール自動送信復活: 重複防止キー
-- 同一アラート（missing_input:{scheduleId} / pending_notice:{noticeId}）への
-- 自動再送信を防ぐため使用。既存の不変ログ設計（INSERTのみ）は変更しない。
-- ================================================================

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS alert_key TEXT;

CREATE INDEX IF NOT EXISTS idx_notification_logs_alert_key
  ON notification_logs (alert_key);
```

- [ ] **Step 2: マイグレーションを適用**

Run: `cd /Users/kawasakiatsushi/developer/unsou-system && npx supabase db push`

Expected: `Applying migration 20260710000000_add_alert_key_to_notification_logs.sql...` の後、`Finished supabase db push.` のような成功メッセージ。確認プロンプトが出た場合は`Y`で続行。

- [ ] **Step 3: 適用結果を確認**

Run: `npx supabase migration list`

Expected: JSON出力の末尾に `{"local":"20260710000000","remote":"20260710000000",...}` があり、local/remoteが一致していること。

- [ ] **Step 4: コミット**

```bash
git add supabase/migrations/20260710000000_add_alert_key_to_notification_logs.sql
git commit -m "feat: notification_logsにalert_key列を追加（防衛アラートメール重複防止用）"
```

---

### Task 2: `getAllTenantIds()` の追加

**Files:**
- Modify: `web/src/utils/tenant.ts`

**Interfaces:**
- Produces: `getAllTenantIds(): Promise<string[]>` — service_role・セッション不要で全テナントIDの重複なし一覧を返す。Task 7のcronルートが使用する。

- [ ] **Step 1: `getAllTenantIds()`を追加**

`web/src/utils/tenant.ts`の内容を以下に置き換える：

```ts
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'

export const DEV_TENANT_ID = 'local-dev'

/**
 * 現在のログインユーザーの tenant_id を返す。
 * - ALLOW_DEV_AUTH_BYPASS=true のときのみ 'local-dev' を返す（dev専用フラグ）。
 * - 本番では user_metadata.tenant_id を必須とし、未解決なら例外を投げる
 *   （静かにフォールバックすると全社データ混在の重大事故になるため）。
 */
export async function getCurrentTenantId(): Promise<string> {
  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    return DEV_TENANT_ID
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const tenantId = user?.user_metadata?.tenant_id
  if (typeof tenantId === 'string' && tenantId) return tenantId
  // ⚠️ フォールバック禁止: 本番ではテナント未解決を明示エラーにして fail-closed。
  throw new Error('テナントが解決できません（user_metadata.tenant_id が未設定です）。')
}

/**
 * 全テナントIDの一覧を返す（service_role・セッション不要）。
 * GitHub Actions等、ログインセッションを持たない定期実行処理専用。
 * ⚠️ 管理画面や通常のServer Actionからは絶対に呼ばないこと
 *    （テナント横断アクセスになるため。呼び出しはcronルートに限定する）。
 */
export async function getAllTenantIds(): Promise<string[]> {
  const db = createServiceClient() as any
  const { data, error } = await db.from('contractors').select('tenant_id')
  if (error) throw new Error(error.message)
  const ids = (data ?? [])
    .map((r: any) => r.tenant_id as string | null)
    .filter((id: string | null): id is string => Boolean(id))
  return [...new Set(ids)]
}
```

- [ ] **Step 2: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add web/src/utils/tenant.ts
git commit -m "feat: cron専用のgetAllTenantIds()を追加"
```

---

### Task 3: `defensiveAlertQueries.ts` 新設（共有クエリ・共有純粋関数）

**Files:**
- Create: `web/src/app/_actions/defensiveAlertQueries.ts`
- Test: `web/src/app/_actions/defensiveAlertQueries.test.ts`

**Interfaces:**
- Consumes: `createServiceClient()`（`@/utils/supabase/service`）
- Produces（Task 4〜7が使用する）:
  - `type EmailAlertStatus = 'sent' | 'failed' | 'not_sent'`
  - `type AlertKeyType = 'missing_input' | 'pending_notice'`
  - `type MissingInputRow = { scheduleId, contractorId, contractorName, contractorPhone, contractorEmail, projectId, projectName, date, emailStatus }`
  - `type PendingNoticeRow = { noticeId, contractorId, contractorName, phone, email, targetMonth, createdAt, hoursElapsed, projectNames, emailStatus }`
  - `buildAlertKey(type: AlertKeyType, entityId: string): string`
  - `buildMissingInputMessage(contractorName: string, projectName: string, date: string): string`
  - `buildPendingNoticeMessage(contractorName: string, targetMonth: string): string`
  - `fetchMissingInputs(tenantId: string): Promise<MissingInputRow[]>`
  - `fetchLongPendingNotices(tenantId: string): Promise<PendingNoticeRow[]>`（tenant_idフィルタ修正込み）

このファイルには`'use server'`を付けない。付けると、認可チェックを持たないエクスポート関数がNext.jsのServer Action RPCとして外部から直接呼び出し可能になってしまうため（Global Constraints参照）。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/app/_actions/defensiveAlertQueries.test.ts`を作成：

```ts
import { describe, it, expect } from 'vitest'
import {
  buildAlertKey,
  buildMissingInputMessage,
  buildPendingNoticeMessage,
} from './defensiveAlertQueries'

describe('buildAlertKey', () => {
  it('builds a missing_input key from a schedule id', () => {
    expect(buildAlertKey('missing_input', 'sched-123')).toBe('missing_input:sched-123')
  })

  it('builds a pending_notice key from a notice id', () => {
    expect(buildAlertKey('pending_notice', 'notice-456')).toBe('pending_notice:notice-456')
  })
})

describe('buildMissingInputMessage', () => {
  it('includes contractor name, project name, and date', () => {
    const msg = buildMissingInputMessage('山田太郎', '△△案件', '2026-07-10')
    expect(msg).toContain('山田太郎')
    expect(msg).toContain('△△案件')
    expect(msg).toContain('2026-07-10')
  })
})

describe('buildPendingNoticeMessage', () => {
  it('formats the target month as YYYY年MM月分', () => {
    const msg = buildPendingNoticeMessage('山田太郎', '2026-06-01')
    expect(msg).toContain('山田太郎')
    expect(msg).toContain('2026年06月分')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd web && npx vitest run src/app/_actions/defensiveAlertQueries.test.ts`

Expected: FAIL（`defensiveAlertQueries`モジュールが存在しない）。

- [ ] **Step 3: `defensiveAlertQueries.ts`を実装**

```ts
import { createServiceClient } from '@/utils/supabase/service'

// ── 型定義 ──────────────────────────────────────────────────

export type EmailAlertStatus = 'sent' | 'failed' | 'not_sent'
export type AlertKeyType     = 'missing_input' | 'pending_notice'

export type MissingInputRow = {
  scheduleId:      string
  contractorId:    string
  contractorName:  string
  contractorPhone: string | null
  contractorEmail: string | null
  projectId:       string
  projectName:     string
  date:            string   // 'YYYY-MM-DD'
  emailStatus:     EmailAlertStatus
}

export type PendingNoticeRow = {
  noticeId:       string
  contractorId:   string
  contractorName: string
  phone:          string | null
  email:          string | null
  targetMonth:    string
  createdAt:      string
  hoursElapsed:   number
  projectNames:   string[]
  emailStatus:    EmailAlertStatus
}

// ── 純粋関数（alert_key・メール本文） ─────────────────────────
// cronルート・手動再送信ボタンの両方が同じ関数を使うことで、
// キー／本文の食い違い（＝emailStatusバッジの不整合）を防ぐ。

export function buildAlertKey(type: AlertKeyType, entityId: string): string {
  return `${type}:${entityId}`
}

export function buildMissingInputMessage(
  contractorName: string,
  projectName:    string,
  date:           string,
): string {
  return `${contractorName} 様\n\n${date}（${projectName}）の稼働実績がまだ入力されていません。お手数ですが、HIBIKIにログインし、実績の入力をお願いいたします。\n\n※本メールは自動送信です。`
}

export function buildPendingNoticeMessage(
  contractorName: string,
  targetMonth:    string,
): string {
  const ym = targetMonth.slice(0, 7)
  const [y, m] = ym.split('-')
  return `${contractorName} 様\n\n${y}年${m}月分の支払通知書がまだご確認（承認）いただけておりません。内容をご確認のうえ、承認手続きをお願いいたします。\n\n※本メールは自動送信です。`
}

// ── notification_logs 突き合わせ（emailStatus 判定） ─────────
// alert_key ごとに最新の status（created_at 降順の先頭）を採用する。
// 「既存レコードが1件でもあれば自動送信スキップ」の判定はこの
// emailStatus !== 'not_sent' で行う（呼び出し側＝cronルートが判定する）。

async function fetchEmailStatuses(
  db: any,
  alertKeys: string[],
): Promise<Map<string, EmailAlertStatus>> {
  if (!alertKeys.length) return new Map()

  const { data, error } = await db
    .from('notification_logs')
    .select('alert_key, status, created_at')
    .in('alert_key', alertKeys)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const map = new Map<string, EmailAlertStatus>()
  for (const row of (data ?? []) as any[]) {
    if (!map.has(row.alert_key)) {
      map.set(row.alert_key, row.status === 'sent' ? 'sent' : 'failed')
    }
  }
  return map
}

// ================================================================
// fetchMissingInputs
// ① 入力遅延: status='scheduled' かつ date<=本日 だが、同一 contractor_id×date の
// work_records が存在しない予定を返す。scheduleActions.getMissingInputs() から
// tenantId解決後に呼ばれる（管理画面用）ほか、cronルートからtenantIdを
// 横断的に渡して直接呼ばれる。
// ================================================================
export async function fetchMissingInputs(tenantId: string): Promise<MissingInputRow[]> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const firstOfMonth = `${today.slice(0, 7)}-01`

  const db = createServiceClient() as any

  const { data: schedules, error: sErr } = await db
    .from('schedules')
    .select(`
      id,
      contractor_id,
      project_id,
      date,
      contractors ( id, name, phone, email ),
      projects    ( id, project_name, name )
    `)
    .eq('status', 'scheduled')
    .gte('date', firstOfMonth)
    .lte('date', today)
    .eq('tenant_id', tenantId)
    .order('date', { ascending: false })

  if (sErr) throw new Error(sErr.message)
  if (!schedules?.length) return []

  const contractorIds: string[] = [...new Set((schedules as any[]).map((s: any) => s.contractor_id))]

  const { data: workRecords, error: wErr } = await db
    .from('work_records')
    .select('contractor_id, date, work_date')
    .in('contractor_id', contractorIds)
    .eq('tenant_id', tenantId)
    .lte('work_date', today)

  if (wErr) throw new Error(wErr.message)

  const workedSet = new Set(
    (workRecords ?? []).map((w: any) => {
      const recordDate = w.date ?? w.work_date
      return `${w.contractor_id}:${recordDate}`
    }),
  )

  const missing = (schedules as any[])
    .filter((s: any) => !workedSet.has(`${s.contractor_id}:${s.date}`))
    .map((s: any) => ({
      scheduleId:      s.id as string,
      contractorId:    s.contractor_id as string,
      contractorName:  s.contractors?.name ?? s.contractor_id,
      contractorPhone: s.contractors?.phone ?? null,
      contractorEmail: s.contractors?.email ?? null,
      projectId:       s.project_id as string,
      projectName:     s.projects?.project_name ?? s.projects?.name ?? s.project_id,
      date:            s.date as string,
    }))

  const keys      = missing.map(m => buildAlertKey('missing_input', m.scheduleId))
  const statusMap = await fetchEmailStatuses(db, keys)

  return missing.map(m => ({
    ...m,
    emailStatus: statusMap.get(buildAlertKey('missing_input', m.scheduleId)) ?? 'not_sent',
  }))
}

// ================================================================
// fetchLongPendingNotices
// ⑤ 長期未承認: 送信後48時間以上 approval_status='unapproved' の支払通知書。
// 🐛バグ修正: 従来 tenant_id フィルタが一切かかっていなかった
// （payment_notices自体にtenant_id列がないため、contractors!inner経由で絞り込む
// —— 既存の approvalActions.ts と同じパターン）。
// ================================================================
export async function fetchLongPendingNotices(tenantId: string): Promise<PendingNoticeRow[]> {
  const db = createServiceClient() as any

  const threshold = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from('payment_notices')
    .select(`
      id, contractor_id, notice_month, approval_status, created_at,
      contractors!inner ( id, name, phone, email, tenant_id )
    `)
    .eq('approval_status', 'unapproved')
    .eq('contractors.tenant_id', tenantId)
    .lt('created_at', threshold)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  if (!data?.length) return []

  const now = Date.now()
  const rows = await Promise.all(
    (data as any[]).map(async (r: any) => {
      const hoursElapsed = Math.floor(
        (now - new Date(r.created_at).getTime()) / (1000 * 60 * 60),
      )

      const noticeMonth: string = r.notice_month ?? ''
      const monthStart = noticeMonth.slice(0, 7) + '-01'
      const monthEnd   = noticeMonth.slice(0, 7) + '-31'

      const { data: schedules } = await db
        .from('schedules')
        .select('projects ( project_name, name )')
        .eq('contractor_id', r.contractor_id)
        .gte('date', monthStart)
        .lte('date', monthEnd)

      const projectNames: string[] = [
        ...new Set(
          ((schedules ?? []) as any[])
            .map((s: any) => s.projects?.project_name ?? s.projects?.name)
            .filter(Boolean),
        ),
      ]

      return {
        noticeId:       r.id as string,
        contractorId:   r.contractor_id as string,
        contractorName: r.contractors?.name  ?? r.contractor_id,
        phone:          r.contractors?.phone ?? null,
        email:          r.contractors?.email ?? null,
        targetMonth:    noticeMonth,
        createdAt:      r.created_at as string,
        hoursElapsed,
        projectNames,
      }
    }),
  )

  const keys      = rows.map(r => buildAlertKey('pending_notice', r.noticeId))
  const statusMap = await fetchEmailStatuses(db, keys)

  return rows.map(r => ({
    ...r,
    emailStatus: statusMap.get(buildAlertKey('pending_notice', r.noticeId)) ?? 'not_sent',
  }))
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd web && npx vitest run src/app/_actions/defensiveAlertQueries.test.ts`

Expected: PASS（4件）。

- [ ] **Step 5: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: エラーなし（Task 4〜6未実施の時点では`fetchMissingInputs`/`fetchLongPendingNotices`はまだどこからも呼ばれていないが、それ自体はエラーにならない）。

- [ ] **Step 6: コミット**

```bash
git add web/src/app/_actions/defensiveAlertQueries.ts web/src/app/_actions/defensiveAlertQueries.test.ts
git commit -m "feat: 防衛アラートの共有クエリ・alert_key生成ロジックを新設"
```

---

### Task 4: `scheduleActions.ts` — `getMissingInputs()`委譲・`logNotification()`拡張

**Files:**
- Modify: `web/src/app/_actions/scheduleActions.ts:1-129`（インポート・型定義・`getMissingInputs()`）
- Modify: `web/src/app/_actions/scheduleActions.ts:598-631`（`logNotification()`）

**Interfaces:**
- Consumes: `fetchMissingInputs`, `type MissingInputRow`（Task 3の`defensiveAlertQueries.ts`）
- Produces: `getMissingInputs()`の外部シグネチャ・挙動は不変（既存呼び出し元は無修正で動く）。`logNotification()`に`alertKey?: string | null`引数を追加。

- [ ] **Step 1: インポートと型定義を書き換え**

`web/src/app/_actions/scheduleActions.ts`の冒頭（1〜11行目）を以下に置き換える：

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'
import { fetchMissingInputs } from './defensiveAlertQueries'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }
```

続けて、`export type MissingInputRow = {...}`ブロック（元の38〜47行目）を以下に置き換える：

```ts
export type { MissingInputRow } from './defensiveAlertQueries'
```

- [ ] **Step 2: `getMissingInputs()`を委譲する形に書き換え**

`export async function getMissingInputs()`の関数本体（元の68〜129行目、コメントブロック含む）を以下に置き換える：

```ts
// ================================================================
// getMissingInputs
// status='scheduled' かつ date<=本日 だが、同一 contractor_id×date の
// work_records が存在しない予定を返す（未入力アラート）
// 実際の取得ロジックは defensiveAlertQueries.fetchMissingInputs に委譲する
// （cronルートからも同じロジックを使うため）。
// ================================================================
export async function getMissingInputs(): Promise<ActionResult<MissingInputRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  try {
    return { data: await fetchMissingInputs(tenantId), error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : '未入力アラート取得に失敗しました' }
  }
}
```

- [ ] **Step 3: `logNotification()`に`alertKey`引数を追加**

`export async function logNotification(...)`の関数全体（元の607〜630行目）を以下に置き換える：

```ts
export async function logNotification(params: {
  contractorId: string
  type:         NotificationLogType
  destination:  string
  status:       NotificationLogStatus
  messageId?:   string | null
  alertKey?:    string | null
}): Promise<ActionResult<{ id: string }>> {
  const db = createServiceClient() as any

  const { data, error } = await db
    .from('notification_logs')
    .insert({
      contractor_id: params.contractorId,
      type:          params.type,
      destination:   params.destination,
      status:        params.status,
      message_id:    params.messageId ?? null,
      alert_key:     params.alertKey  ?? null,
    })
    .select('id')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: { id: data.id as string }, error: null }
}
```

- [ ] **Step 4: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add web/src/app/_actions/scheduleActions.ts
git commit -m "refactor: getMissingInputsをdefensiveAlertQueriesに委譲、logNotificationにalertKeyを追加"
```

---

### Task 5: `defensiveAlertActions.ts` — `fetchLongPendingNotices`をTask 3に委譲

**Files:**
- Modify: `web/src/app/_actions/defensiveAlertActions.ts:1-51`（インポート・型定義）
- Modify: `web/src/app/_actions/defensiveAlertActions.ts:149-269`（`getPendingNotices()`・`fetchLongPendingNotices()`・`getDefensiveAlerts()`）

**Interfaces:**
- Consumes: `fetchLongPendingNotices`, `type PendingNoticeRow`（Task 3の`defensiveAlertQueries.ts`）
- Produces: `getPendingNotices()`・`getDefensiveAlerts()`の外部シグネチャ・挙動は不変（`pendingNotices`に`emailStatus`フィールドが増えるのみ、既存フィールドは変わらない）。

- [ ] **Step 1: インポートと型定義を書き換え**

`web/src/app/_actions/defensiveAlertActions.ts`の冒頭（1〜9行目）を以下に置き換える：

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/utils/supabase/service'
import { getMissingInputs, type MissingInputRow } from './scheduleActions'
import { getDuplicateInputs, type DuplicateGroup } from './workRecordActions'
import { fetchLongPendingNotices, type PendingNoticeRow } from './defensiveAlertQueries'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'
```

続けて、`export type PendingNoticeRow = {...}`ブロック（元の31〜41行目）を削除する（Task 3の`defensiveAlertQueries.ts`で定義済み・上記importで再利用するため）。

- [ ] **Step 2: `getPendingNotices()`と`fetchLongPendingNotices()`のローカル定義をまとめて置き換え**

`export async function getPendingNotices()`から、ローカル定義の`async function fetchLongPendingNotices()`終わりまで（元の152〜221行目）を以下に置き換える：

```ts
// ================================================================
// ⑤ 長期間未承認: 送信後48時間以上 approval_status='unapproved' の支払通知書（未承認検知）
// 実際の取得ロジックは defensiveAlertQueries.fetchLongPendingNotices に委譲する
// （cronルートからも同じロジックを使うため）。
// ================================================================
export async function getPendingNotices(): Promise<ActionResult<PendingNoticeRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  try {
    const tenantId = await getCurrentTenantId()
    return { data: await fetchLongPendingNotices(tenantId), error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : '未承認通知書の取得に失敗しました' }
  }
}
```

- [ ] **Step 3: `getDefensiveAlerts()`にtenantIdを渡す**

`export async function getDefensiveAlerts()`の関数本体（元の227〜269行目）を以下に置き換える：

```ts
export async function getDefensiveAlerts(): Promise<ActionResult<DefensiveAlerts>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  try {
    const tenantId = await getCurrentTenantId()
    const [
      missingRes,
      duplicatesRes,
      thresholds,
      invoiceWarnings,
      pendingNotices,
    ] = await Promise.all([
      getMissingInputs(),
      getDuplicateInputs(),
      fetchAndLockThresholdViolations(),
      fetchInvoiceWarnings(),
      fetchLongPendingNotices(tenantId),
    ])

    const missingInputs = missingRes.data  ?? []
    const duplicates    = duplicatesRes.data ?? []

    const totalCount =
      missingInputs.length +
      duplicates.length +
      thresholds.length +
      invoiceWarnings.length +
      pendingNotices.length

    return {
      data: {
        missingInputs,
        duplicates,
        thresholds,
        invoiceWarnings,
        pendingNotices,
        totalCount,
      },
      error: null,
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'アラート取得に失敗しました' }
  }
}
```

- [ ] **Step 4: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add web/src/app/_actions/defensiveAlertActions.ts
git commit -m "fix: fetchLongPendingNoticesのtenant_idフィルタ欠落バグを修正し共有ロジックに委譲"
```

---

### Task 6: `emailActions.ts` — `deliverAlertEmail`新設・`sendDefensiveAlertEmail`リファクタ

**Files:**
- Modify: `web/src/app/_actions/emailActions.ts`（全体）

**Interfaces:**
- Consumes: `buildAlertKey`, `buildMissingInputMessage`, `buildPendingNoticeMessage`, `type AlertKeyType`（Task 3）
- Produces:
  - `deliverAlertEmail(params: { contractorId, alertKey, alertType, message, tenantId }): Promise<ActionResult<{ status: 'sent'|'failed'; messageId: string|null }>>` — 認可チェックなし。Task 7のcronルートが直接呼ぶ。
  - `sendDefensiveAlertEmail(params: MissingInputResendParams | PendingNoticeResendParams): Promise<ActionResult<{ messageId: string }>>` — `requireMasterAccess()`必須。Task 8のUIボタンが呼ぶ。

- [ ] **Step 1: ファイル全体を書き換え**

`web/src/app/_actions/emailActions.ts`の内容を以下に置き換える（`requireMasterAccess`・`sendViaResend`・`ALERT_SUBJECTS`は変更なし、`deliverAlertEmail`を新設、`sendDefensiveAlertEmail`のシグネチャを変更）：

```ts
'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'
import { logNotification } from './scheduleActions'
import {
  buildAlertKey,
  buildMissingInputMessage,
  buildPendingNoticeMessage,
} from './defensiveAlertQueries'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

// ⚠️ HIBIKI_OWNER_EMAILS 未設定時は特権メールなし（fail-closed）。.env.local に設定すること。
const TEMP_OWNER_EMAILS = (process.env.HIBIKI_OWNER_EMAILS ?? '')
  .split(',').map(e => e.trim()).filter(Boolean)

const ALERT_SUBJECTS: Record<string, string> = {
  missing_input:   '【HIBIKI】稼働実績の入力をお願いします',
  pending_notice:  '【HIBIKI】支払通知書のご確認をお願いします',
  threshold:       '【HIBIKI】稼働実績の確認をお願いします',
  duplicate:       '【HIBIKI】実績データの重複について',
  invoice_warning: '【HIBIKI】インボイス登録番号のご確認',
}

async function requireMasterAccess(): Promise<ActionResult<{ userId: string }>> {
  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    return { data: { userId: 'dev-master' }, error: null }
  }

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '認証が必要です' }

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role = TEMP_OWNER_EMAILS.includes(user.email ?? '')
    ? 'master'
    : (userData?.role ?? user.user_metadata?.role)

  if (role !== 'master') {
    return { data: null, error: '管理者権限が必要です' }
  }

  return { data: { userId: user.id }, error: null }
}

async function sendViaResend(
  to: string,
  subject: string,
  text: string,
): Promise<{ messageId: string } | { error: string }> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    console.warn('[emailActions] RESEND_API_KEY が未設定です — 開発フォールバック（コンソール出力）')
    console.log('[emailActions] メール送信（モック）:', { to, subject, text })
    return { messageId: `dev-mock-${Date.now()}` }
  }

  const from = process.env.RESEND_FROM_EMAIL ?? 'HIBIKI <onboarding@resend.dev>'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error('[emailActions] Resend API エラー:', res.status, body)
      return { error: `メール送信に失敗しました (${res.status})` }
    }

    const json = (await res.json()) as { id?: string }
    return { messageId: json.id ?? `resend-${Date.now()}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'メール送信に失敗しました'
    console.error('[emailActions] Resend 通信エラー:', msg)
    return { error: msg }
  }
}

/**
 * 5大ディフェンシブ・アラート用の催促・警告メールを Resend 経由で送信する共通処理。
 * 認可チェックは行わない（呼び出し元＝cronルート／sendDefensiveAlertEmail で担保する）。
 * 送信成否にかかわらず notification_logs に alert_key 付きで記録する
 * （宛先未設定・本文空も「送信失敗」として記録し、他の処理を止めない）。
 */
export async function deliverAlertEmail(params: {
  contractorId: string
  alertKey:     string
  alertType:    string
  message:      string
  tenantId:     string
}): Promise<ActionResult<{ status: 'sent' | 'failed'; messageId: string | null }>> {
  const db = createServiceClient() as any

  const { data: contractor, error: cErr } = await db
    .from('contractors')
    .select('id, name, email')
    .eq('id', params.contractorId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle()

  if (cErr) return { data: null, error: cErr.message }
  if (!contractor) return { data: null, error: '委託先が見つかりません' }

  const contractorEmail = (contractor.email as string | null)?.trim()
  const adminFallback   = process.env.ADMIN_ALERT_EMAIL?.trim()
  const destination     = contractorEmail || adminFallback
  const subject         = ALERT_SUBJECTS[params.alertType] ?? '【HIBIKI】業務確認のお願い'
  const body             = params.message.trim()

  if (!destination || !body) {
    const logRes = await logNotification({
      contractorId: params.contractorId,
      type:         'email',
      destination:  destination ?? '(未設定)',
      status:       'failed',
      alertKey:     params.alertKey,
    })
    if (logRes.error) return { data: null, error: logRes.error }
    return { data: { status: 'failed', messageId: null }, error: null }
  }

  const sendResult = await sendViaResend(destination, subject, body)
  const status: 'sent' | 'failed' = 'error' in sendResult ? 'failed' : 'sent'
  const messageId = 'error' in sendResult ? null : sendResult.messageId

  const logRes = await logNotification({
    contractorId: params.contractorId,
    type:         'email',
    destination,
    status,
    messageId,
    alertKey:     params.alertKey,
  })

  if (logRes.error) {
    return { data: null, error: `メール処理は完了しましたがログ記録に失敗しました: ${logRes.error}` }
  }

  return { data: { status, messageId }, error: null }
}

/**
 * 管理画面「📧 メール再送信」ボタン用。承認済み管理者のみ実行可能。
 * cron の自動送信と同じ buildAlertKey/メッセージ生成関数を使うことで、
 * emailStatus バッジ（sent/failed/not_sent）が手動再送後も正しく更新される。
 * dedup（既存レコードがあればスキップ）はここでは行わない —— 手動操作は常に送信する。
 */
export async function sendDefensiveAlertEmail(
  params:
    | {
        alertType:      'missing_input'
        contractorId:   string
        scheduleId:     string
        contractorName: string
        projectName:    string
        date:           string
      }
    | {
        alertType:      'pending_notice'
        contractorId:   string
        noticeId:       string
        contractorName: string
        targetMonth:    string
      },
): Promise<ActionResult<{ messageId: string }>> {
  const auth = await requireMasterAccess()
  if (auth.error) return { data: null, error: auth.error }

  const tenantId = await getCurrentTenantId()

  const alertKey = params.alertType === 'missing_input'
    ? buildAlertKey('missing_input', params.scheduleId)
    : buildAlertKey('pending_notice', params.noticeId)

  const message = params.alertType === 'missing_input'
    ? buildMissingInputMessage(params.contractorName, params.projectName, params.date)
    : buildPendingNoticeMessage(params.contractorName, params.targetMonth)

  const result = await deliverAlertEmail({
    contractorId: params.contractorId,
    alertKey,
    alertType:    params.alertType,
    message,
    tenantId,
  })

  if (result.error) return { data: null, error: result.error }
  if (result.data.status === 'failed') {
    return { data: null, error: 'メール送信に失敗しました（宛先未設定または送信エラー）' }
  }

  return { data: { messageId: result.data.messageId! }, error: null }
}
```

- [ ] **Step 2: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add web/src/app/_actions/emailActions.ts
git commit -m "feat: deliverAlertEmailを新設しsendDefensiveAlertEmailをリファクタ"
```

---

### Task 7: cron APIルート新設

**Files:**
- Create: `web/src/app/api/cron/defensive-alerts/route.ts`

**Interfaces:**
- Consumes: `getAllTenantIds`（`@/utils/tenant`）、`fetchMissingInputs`/`fetchLongPendingNotices`/`buildAlertKey`/`buildMissingInputMessage`/`buildPendingNoticeMessage`（`./defensiveAlertQueries`から`@/app/_actions/defensiveAlertQueries`としてimport）、`deliverAlertEmail`（`@/app/_actions/emailActions`）
- Produces: `GET /api/cron/defensive-alerts`（`x-cron-secret`ヘッダー必須）。200時のレスポンスJSON: `{ tenantsProcessed, candidates, sent, failed, errors }`。

- [ ] **Step 1: ルートハンドラを作成**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getAllTenantIds } from '@/utils/tenant'
import {
  fetchMissingInputs,
  fetchLongPendingNotices,
  buildAlertKey,
  buildMissingInputMessage,
  buildPendingNoticeMessage,
} from '@/app/_actions/defensiveAlertQueries'
import { deliverAlertEmail } from '@/app/_actions/emailActions'

type AlertJob = {
  contractorId: string
  alertKey:     string
  alertType:    'missing_input' | 'pending_notice'
  message:      string
  tenantId:     string
}

// ── Route Handler ─────────────────────────────────────────
// GitHub Actions（毎日 JST 9:00）から x-cron-secret ヘッダー付きで呼ばれる。
// fail-closed: シークレット不一致・未設定の場合は DB・メール処理を一切行わない。

export async function GET(req: NextRequest) {
  const secret   = req.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let tenantIds: string[]
  try {
    tenantIds = await getAllTenantIds()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const jobs: AlertJob[] = []

  try {
    for (const tenantId of tenantIds) {
      const [missing, pending] = await Promise.all([
        fetchMissingInputs(tenantId),
        fetchLongPendingNotices(tenantId),
      ])

      for (const m of missing) {
        if (m.emailStatus !== 'not_sent') continue
        jobs.push({
          contractorId: m.contractorId,
          alertKey:     buildAlertKey('missing_input', m.scheduleId),
          alertType:    'missing_input',
          message:      buildMissingInputMessage(m.contractorName, m.projectName, m.date),
          tenantId,
        })
      }

      for (const p of pending) {
        if (p.emailStatus !== 'not_sent') continue
        jobs.push({
          contractorId: p.contractorId,
          alertKey:     buildAlertKey('pending_notice', p.noticeId),
          alertType:    'pending_notice',
          message:      buildPendingNoticeMessage(p.contractorName, p.targetMonth),
          tenantId,
        })
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  let sent   = 0
  let failed = 0
  const errors: string[] = []

  for (const job of jobs) {
    const result = await deliverAlertEmail(job)
    if (result.error) {
      failed++
      errors.push(`${job.alertKey}: ${result.error}`)
      continue
    }
    if (result.data.status === 'sent') sent++
    else failed++
  }

  return NextResponse.json({
    tenantsProcessed: tenantIds.length,
    candidates:       jobs.length,
    sent,
    failed,
    errors,
  })
}
```

- [ ] **Step 2: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: エラーなし。

- [ ] **Step 3: ローカルでの動作確認（`ALLOW_DEV_AUTH_BYPASS`環境・ダミーCRON_SECRET）**

`web/.env.local`に`CRON_SECRET=dev-test-secret`が設定されていることを確認した上で：

Run: `cd web && npm run dev`（別ターミナルで起動したままにする）

別ターミナルで:
```bash
curl -i -H "x-cron-secret: dev-test-secret" http://localhost:3000/api/cron/defensive-alerts
```

Expected: `HTTP/1.1 200 OK`とJSONレスポンス（`RESEND_API_KEY`未設定ならモック送信としてログに出力される）。

```bash
curl -i -H "x-cron-secret: wrong" http://localhost:3000/api/cron/defensive-alerts
```

Expected: `HTTP/1.1 401 Unauthorized`。

- [ ] **Step 4: コミット**

```bash
git add web/src/app/api/cron/defensive-alerts/route.ts
git commit -m "feat: 防衛アラート自動送信cronルートを新設"
```

---

### Task 8: `DefensiveAlertPanel.tsx` — 再送信ボタン・失敗バッジ追加

**Files:**
- Modify: `web/src/app/admin/_components/DefensiveAlertPanel.tsx`

**Interfaces:**
- Consumes: `sendDefensiveAlertEmail`（Task 6の`@/app/_actions/emailActions`）、`MissingInputRow`/`PendingNoticeRow`の新フィールド`emailStatus`（Task 3〜5経由）

- [ ] **Step 1: importに`sendDefensiveAlertEmail`を追加**

`web/src/app/admin/_components/DefensiveAlertPanel.tsx`の1〜21行目末尾に以下を追加：

```tsx
import { sendDefensiveAlertEmail } from '@/app/_actions/emailActions'
```

- [ ] **Step 2: `MissingInputSection`に再送信ボタンと失敗バッジを追加**

`function MissingInputSection({...})`全体（元の143〜176行目）を以下に置き換える：

```tsx
function MissingInputSection({
  rows,
  onMarkAbsent,
  onResendEmail,
}: {
  rows: MissingInputRow[]
  onMarkAbsent: (scheduleId: string, name: string) => void
  onResendEmail: (row: MissingInputRow) => void
}) {
  return (
    <AlertSection icon="🔴" title="入力遅延（未入力検知）" count={rows.length} color="red">
      <div className="space-y-2">
        {rows.map(r => (
          <div
            key={r.scheduleId}
            className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium text-zinc-900">{r.contractorName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="text-zinc-600">{r.projectName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="tabular-nums text-zinc-500">{r.date}</span>
              {r.emailStatus === 'failed' && (
                <span className="ml-2 inline-flex rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                  ⚠️ 自動送信失敗
                </span>
              )}
            </div>
            <ActionRow
              phone={r.contractorPhone}
              contactName={r.contractorName}
              onConfirm={() => onMarkAbsent(r.scheduleId, r.contractorName)}
              confirmLabel="本日休みとして完了"
            />
            <div className="mt-2">
              <button
                type="button"
                onClick={() => onResendEmail(r)}
                className="inline-flex rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                📧 メール再送信
              </button>
            </div>
          </div>
        ))}
      </div>
    </AlertSection>
  )
}
```

- [ ] **Step 3: `PendingNoticeCard`/`PendingNoticeSection`に再送信ボタンと失敗バッジを追加**

`function PendingNoticeCard({...})`から`function PendingNoticeSection({...})`まで（元の325〜400行目）を以下に置き換える：

```tsx
function PendingNoticeCard({
  r,
  onResendEmail,
}: {
  r: PendingNoticeRow
  onResendEmail: (row: PendingNoticeRow) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-zinc-200 overflow-hidden text-sm">
      {/* サマリー行（クリックで展開） */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 hover:bg-zinc-100 transition-colors text-left"
      >
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-zinc-900">{r.contractorName}</span>
          <span className="text-zinc-400">|</span>
          <span className="text-zinc-600">{r.targetMonth}</span>
          <span className="text-zinc-400">|</span>
          <span className="font-semibold text-amber-700">{r.hoursElapsed}時間経過</span>
          {r.emailStatus === 'failed' && (
            <span className="inline-flex rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
              ⚠️ 自動送信失敗
            </span>
          )}
        </span>
        <span className="text-xs text-zinc-400 ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {/* 展開詳細 */}
      {open && (
        <div className="border-t border-zinc-200 bg-white px-3 py-3 space-y-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-zinc-400">ドライバー</dt>
            <dd className="font-medium text-zinc-900">{r.contractorName}</dd>
            <dt className="text-zinc-400">対象月</dt>
            <dd className="text-zinc-700">{r.targetMonth.slice(0, 7).replace('-', '年')}月</dd>
            <dt className="text-zinc-400">案件</dt>
            <dd className="text-zinc-700">
              {r.projectNames.length > 0 ? r.projectNames.join('・') : '－'}
            </dd>
            {r.email && (
              <>
                <dt className="text-zinc-400">メール</dt>
                <dd className="text-zinc-600 break-all">{r.email}</dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a
              href={`/admin/billing?tab=payment&month=${r.targetMonth.slice(0, 7)}`}
              className="inline-flex rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              確認する →
            </a>
            {r.phone && (
              <>
                <a href={`tel:${r.phone}`} className="inline-flex rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                  📞 電話
                </a>
                <a href={`sms:${r.phone}`} className="inline-flex rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                  💬 SMS
                </a>
              </>
            )}
            {!r.phone && (
              <span className="text-xs text-zinc-400">電話番号未登録（{r.contractorName}）</span>
            )}
            <button
              type="button"
              onClick={() => onResendEmail(r)}
              className="inline-flex rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              📧 メール再送信
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PendingNoticeSection({
  rows,
  onResendEmail,
}: {
  rows: PendingNoticeRow[]
  onResendEmail: (row: PendingNoticeRow) => void
}) {
  return (
    <AlertSection icon="⚠️" title="長期未承認（48時間超・支払通知書）" count={rows.length} color="amber">
      <div className="space-y-2">
        {rows.map(r => <PendingNoticeCard key={r.noticeId} r={r} onResendEmail={onResendEmail} />)}
      </div>
    </AlertSection>
  )
}
```

- [ ] **Step 4: メインコンポーネントにハンドラを追加し、JSXを更新**

`handleDeleteRecord`関数の直後（元の507〜515行目の後）に以下を追加：

```tsx
  function handleResendMissingInputEmail(row: MissingInputRow) {
    if (!window.confirm(`「${row.contractorName}」へ入力依頼メールを送信しますか？`)) return
    startTransition(async () => {
      const res = await sendDefensiveAlertEmail({
        alertType:      'missing_input',
        contractorId:   row.contractorId,
        scheduleId:     row.scheduleId,
        contractorName: row.contractorName,
        projectName:    row.projectName,
        date:           row.date,
      })
      if (res.error) { setLoadErr(res.error); return }
      showToast('メールを送信しました', true)
      await load()
    })
  }

  function handleResendPendingNoticeEmail(row: PendingNoticeRow) {
    if (!window.confirm(`「${row.contractorName}」へ承認依頼メールを送信しますか？`)) return
    startTransition(async () => {
      const res = await sendDefensiveAlertEmail({
        alertType:      'pending_notice',
        contractorId:   row.contractorId,
        noticeId:       row.noticeId,
        contractorName: row.contractorName,
        targetMonth:    row.targetMonth,
      })
      if (res.error) { setLoadErr(res.error); return }
      showToast('メールを送信しました', true)
      await load()
    })
  }
```

続けて、JSX内の該当2箇所を以下のように更新する。まず`<MissingInputSection ... />`（元の573〜576行目）：

```tsx
      <MissingInputSection
        rows={alerts.missingInputs}
        onMarkAbsent={handleMarkAbsent}
        onResendEmail={handleResendMissingInputEmail}
      />
```

次に`<PendingNoticeSection rows={alerts.pendingNotices} />`（元の591行目）：

```tsx
      <PendingNoticeSection rows={alerts.pendingNotices} onResendEmail={handleResendPendingNoticeEmail} />
```

- [ ] **Step 5: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add web/src/app/admin/_components/DefensiveAlertPanel.tsx
git commit -m "feat: 管理画面にメール再送信ボタンと自動送信失敗バッジを追加"
```

---

### Task 9: GitHub Actionsワークフロー新設・`CRON_SECRET`設定

**Files:**
- Create: `.github/workflows/defensive-alerts-cron.yml`

**Interfaces:**
- Produces: 毎日 UTC 0:00（JST 9:00）に`https://unsou-system.kawapon7.workers.dev/api/cron/defensive-alerts`を`x-cron-secret`ヘッダー付きで呼び出すGitHub Actionsワークフロー。`workflow_dispatch`で手動実行も可能。

> ⚠️ このタスクは本番のCloudflare Workersシークレットと、Gitリポジトリのシークレットを変更する。実行前に必ずボスに実行してよいか確認すること（このプランへの承認は設計方針への承認であり、本番シークレット投入の実行許可を兼ねない）。

- [ ] **Step 1: ワークフローファイルを作成**

```yaml
name: Defensive Alerts Cron

on:
  schedule:
    - cron: '0 0 * * *'
  workflow_dispatch: {}

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Call defensive-alerts cron endpoint
        run: |
          curl -f -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
            https://unsou-system.kawapon7.workers.dev/api/cron/defensive-alerts
```

- [ ] **Step 2: 本番用シークレットを1つ生成**

Run: `openssl rand -hex 32`

生成された値を控えておく（以降のStep 3〜5ですべて同じ値を使う）。

- [ ] **Step 3: `.env.local`に設定（ローカル開発用）**

`web/.env.local`に以下の行を追記する（既存のTask 7用ダミー値`dev-test-secret`を本番相当の値に置き換えてもよい）：

```
CRON_SECRET=<Step 2で生成した値>
```

- [ ] **Step 4: Cloudflare Workersシークレットに設定**

Run:
```bash
cd web && npx wrangler secret put CRON_SECRET
```

プロンプトが出たらStep 2で生成した値を貼り付けてEnter。

Expected: `✨ Success! Uploaded secret CRON_SECRET`

- [ ] **Step 5: GitHubリポジトリシークレットに設定**

Run:
```bash
gh secret set CRON_SECRET --body "<Step 2で生成した値>"
```

Expected: `✓ Set Actions secret CRON_SECRET for kawapon7/unsou-system`

- [ ] **Step 6: コミット**

```bash
git add .github/workflows/defensive-alerts-cron.yml
git commit -m "feat: 防衛アラート自動送信のGitHub Actions定期実行ワークフローを追加"
```

---

### Task 10: 実地検証（設計書§9）・本番デプロイ

**Files:**
- なし（検証のみ）

**Interfaces:**
- なし（このタスクの完了をもって「Resend通知メール実送受信確認」タスク全体が完了する）

- [ ] **Step 1: フルビルドで最終確認**

Run: `cd web && npm run build`

Expected: ビルド成功（型エラー・lintエラーなし）。

- [ ] **Step 2: 本番デプロイ**

Run: `cd web && npm run deploy`

Expected: `wrangler deploy`が成功し、`https://unsou-system.kawapon7.workers.dev`に反映される。

> ⚠️ 本番デプロイは実行前にボスに確認すること。

- [ ] **Step 3: cronルートへ直接curl（正常系・異常系）**

```bash
curl -i -H "x-cron-secret: <本番CRON_SECRET>" https://unsou-system.kawapon7.workers.dev/api/cron/defensive-alerts
```

Expected: `200`、テスト用委託先に実際にメールが届く。レスポンスJSONの`sent`が対象件数と一致。

```bash
curl -i -H "x-cron-secret: wrong-secret" https://unsou-system.kawapon7.workers.dev/api/cron/defensive-alerts
```

Expected: `401`。

- [ ] **Step 4: 同じcurlを2回連続実行し重複防止を確認**

Step 3のcurlをもう一度実行する。

Expected: レスポンスJSONの`candidates`が`0`（全件`emailStatus`が`not_sent`でなくなっているため）、`notification_logs`に新規行が増えない。

- [ ] **Step 5: 管理画面で手動再送信ボタンを確認**

管理画面（`/admin/dashboard`）で「📧 メール再送信」ボタンを実際に押す。

Expected: 確認ダイアログ→送信→トースト表示→`notification_logs`に新規レコードが記録される（Supabase Dashboardで確認）。

- [ ] **Step 6: 送信失敗バッジを確認**

対象ドライバーのメールアドレスを一時的に空にした状態で、Step 5のボタンを再度押す。

Expected: 「メール送信に失敗しました」のエラー表示後、画面更新で該当行に「⚠️ 自動送信失敗」バッジが表示される。確認後、メールアドレスを元に戻す。

- [ ] **Step 7: GitHub Actionsの手動実行で本番宛の実送信を確認**

`gh workflow run defensive-alerts-cron.yml`で`workflow_dispatch`を手動トリガーする。

Expected: ワークフローが成功し、`kawapon7+driver@gmail.com`宛に実際にメールが届く。これをもって「Resend通知メール実送受信確認」タスクの完了とする。

- [ ] **Step 8: HANDOVER_MASTER.mdと自動メモリを更新**

`docs/HANDOVER_MASTER.md`の§5-2・§5-4、および自動メモリ`hibiki_defensive_alert_email_revival.md`を「実装・実地検証完了」に更新する。
