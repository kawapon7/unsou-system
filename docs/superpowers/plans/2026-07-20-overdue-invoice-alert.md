# 督促・延滞管理アラート 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 入金予定日（`invoices.due_date`）を超過したのに`status='issued'`のままの請求書を「⑥延滞請求書」として検知し、既存の5大防衛アラートと同じcron・メール・UI基盤で社内向け（`ADMIN_ALERT_EMAIL`宛）に通知する。

**Architecture:** `defensiveAlertQueries.ts`に`fetchOverdueInvoices(tenantId)`を新設し、既存の`fetchMissingInputs`と同じJST日付判定パターンで検知する。本アラートは`contractor`を持たず`client`起点のため、`notification_logs.contractor_id`のNOT NULL制約を緩和し`client_id`列を追加するマイグレーションが前提となる。cronルート（`/api/cron/defensive-alerts`）の既存テナント横断ループに合流させ、`DefensiveAlertPanel`に6つ目のセクションとして表示、入金管理画面（画面③）の該当行を視覚強調する。

**Tech Stack:** Next.js App Router（Server Actions + Route Handler）, Supabase（service-role client）, Resend, Vitest

## Global Constraints

- 通知対象は社内向けのみ（荷主本人への督促メールは対象外）。
- 発報タイミングは`due_date`翌日から即発報（猶予期間なし）。
- 繰り返し通知は初回のみ（`notification_logs.alert_key = overdue_invoice:{invoiceId}`方式、既存の①⑤と同じ「既存レコードがあれば自動送信をスキップ」パターン）。
- UI表示は`DefensiveAlertPanel`（社内向けアラートパネル）＋入金管理画面（画面③）の両方。
- `notification_logs`の不変ログ方針（`UPDATE`/`DELETE`全ロール禁止、`INSERT`のみ）は変更しない。
- **設計書からの是正点（実装前に判明・承認済み）：** `docs/superpowers/specs/2026-07-20-overdue-invoice-alert-design.md`の初版は「マイグレーション不要」としていたが、`notification_logs.contractor_id`が`NOT NULL REFERENCES contractors(id)`であり、延滞請求書アラートは`contractor`を持たず`client_id`のみ持つため、そのままでは`logNotification`が使えないことが判明した。`client_id`列追加＋`contractor_id`のNOT NULL解除＋どちらか一方必須のCHECK制約を追加するマイグレーションを設計書に追記済み（本プランのTask 1）。
- **テスト方針：** このリポジトリのテスト基盤は`vitest`のみで、DB・Resendをモックする仕組みはない（既存の`defensiveAlertQueries.test.ts`も副作用のない純粋関数のみを対象にしている）。本プランでも同じ方針を踏襲し、**副作用のない純粋関数（`buildOverdueInvoiceMessage`と`buildAlertKey`の`overdue_invoice`ケース）のみTDDでユニットテストを書き**、DB・メール送信・UIについては各タスクの型チェックに加え、最終タスク（Task 9）で実地検証する。

---

### Task 1: DBマイグレーション — `notification_logs`に`client_id`を追加

**Files:**
- Create: `supabase/migrations/20260720000000_notification_logs_client_id.sql`

**Interfaces:**
- Produces: `notification_logs`テーブルの`contractor_id`がNULL許容になり、新たに`client_id UUID REFERENCES clients(id)`列と、`contractor_id`/`client_id`のどちらか一方必須のCHECK制約（`notification_logs_subject_check`）が存在する状態。以降のタスクはこの列にINSERTする。

- [ ] **Step 1: マイグレーションファイルを作成**

```sql
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
```

- [ ] **Step 2: マイグレーションを適用**

Run: `cd /Users/kawasakiatsushi/developer/unsou-system && npx supabase db push`

Expected: `Applying migration 20260720000000_notification_logs_client_id.sql...` の後、`Finished supabase db push.` のような成功メッセージ。確認プロンプトが出た場合は`Y`で続行。

- [ ] **Step 3: 適用結果を確認**

Run: `npx supabase migration list`

Expected: JSON出力の末尾に`{"local":"20260720000000","remote":"20260720000000",...}`があり、local/remoteが一致していること。

- [ ] **Step 4: コミット**

```bash
git add supabase/migrations/20260720000000_notification_logs_client_id.sql
git commit -m "feat: notification_logsにclient_id列を追加（延滞請求書アラート用）"
```

---

### Task 2: `defensiveAlertQueries.ts` 拡張 — `fetchOverdueInvoices`新設

**Files:**
- Modify: `web/src/app/_actions/defensiveAlertQueries.ts`
- Test: `web/src/app/_actions/defensiveAlertQueries.test.ts`

**Interfaces:**
- Consumes: `createServiceClient()`（`@/utils/supabase/service`）、Task 1の`client_id`列
- Produces（Task 4〜7が使用する）:
  - `AlertKeyType`に`'overdue_invoice'`を追加
  - `type OverdueInvoiceRow = { invoiceId, clientId, companyName, dueDate, totalAmount, daysOverdue, emailStatus }`
  - `buildOverdueInvoiceMessage(companyName: string, dueDate: string, totalAmount: number, daysOverdue: number): string`
  - `fetchOverdueInvoices(tenantId: string): Promise<OverdueInvoiceRow[]>`

- [ ] **Step 1: 失敗するテストを書く**

`web/src/app/_actions/defensiveAlertQueries.test.ts`の末尾に以下を追加：

```ts
import {
  buildAlertKey,
  buildMissingInputMessage,
  buildPendingNoticeMessage,
  buildOverdueInvoiceMessage,
} from './defensiveAlertQueries'
```

（既存のimport文を上記に置き換える。`buildOverdueInvoiceMessage`を追加するだけ）

続けて、ファイル末尾に以下を追加：

```ts
describe('buildAlertKey (overdue_invoice)', () => {
  it('builds an overdue_invoice key from an invoice id', () => {
    expect(buildAlertKey('overdue_invoice', 'inv-789')).toBe('overdue_invoice:inv-789')
  })
})

describe('buildOverdueInvoiceMessage', () => {
  it('includes company name, due date, formatted amount, and days overdue', () => {
    const msg = buildOverdueInvoiceMessage('株式会社サンプル', '2026-07-10', 150000, 5)
    expect(msg).toContain('株式会社サンプル')
    expect(msg).toContain('2026-07-10')
    expect(msg).toContain('¥150,000')
    expect(msg).toContain('5日')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd web && npx vitest run src/app/_actions/defensiveAlertQueries.test.ts`

Expected: FAIL（`buildOverdueInvoiceMessage`が存在しない、`buildAlertKey('overdue_invoice', ...)`の型エラー）。

- [ ] **Step 3: `AlertKeyType`を拡張**

`web/src/app/_actions/defensiveAlertQueries.ts`の6行目を以下に置き換える：

```ts
export type AlertKeyType     = 'missing_input' | 'pending_notice' | 'overdue_invoice'
```

- [ ] **Step 4: `OverdueInvoiceRow`型を追加**

`export type PendingNoticeRow = {...}`ブロック（20〜31行目）の直後に以下を追加：

```ts

export type OverdueInvoiceRow = {
  invoiceId:    string
  clientId:     string
  companyName:  string
  dueDate:      string   // 'YYYY-MM-DD'
  totalAmount:  number
  daysOverdue:  number
  emailStatus:  EmailAlertStatus
}
```

- [ ] **Step 5: `buildOverdueInvoiceMessage`を追加**

`buildPendingNoticeMessage`関数（49〜56行目）の直後に以下を追加：

```ts

export function buildOverdueInvoiceMessage(
  companyName:  string,
  dueDate:      string,
  totalAmount:  number,
  daysOverdue:  number,
): string {
  const yen = totalAmount.toLocaleString('ja-JP')
  return `荷主「${companyName}」の請求書（入金予定日 ${dueDate}）が入金予定日を${daysOverdue}日超過しています。\n請求金額: ¥${yen}\n\n入金管理画面（/admin/sales）でご確認のうえ、対応をお願いいたします。\n\n※本メールは自動送信です。`
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `cd web && npx vitest run src/app/_actions/defensiveAlertQueries.test.ts`

Expected: PASS（全6件）。

- [ ] **Step 7: `fetchOverdueInvoices`を追加**

ファイル末尾（`fetchLongPendingNotices`関数の後）に以下を追加：

```ts

// ================================================================
// fetchOverdueInvoices
// ⑥ 延滞請求書: status='issued' かつ due_date<今日(JST) の請求書を返す。
// invoices自体にtenant_id列がないため、clients!inner経由で絞り込む
// （fetchLongPendingNoticesのcontractors!innerと同じパターン）。
// ================================================================
export async function fetchOverdueInvoices(tenantId: string): Promise<OverdueInvoiceRow[]> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const db = createServiceClient() as any

  const { data, error } = await db
    .from('invoices')
    .select(`
      id, client_id, due_date, total_amount, status,
      clients!inner ( id, company_name, tenant_id )
    `)
    .eq('status', 'issued')
    .lt('due_date', today)
    .eq('clients.tenant_id', tenantId)
    .order('due_date', { ascending: true })

  if (error) throw new Error(error.message)
  if (!data?.length) return []

  const todayMs = new Date(`${today}T00:00:00+09:00`).getTime()

  const overdue = (data as any[]).map((inv: any) => {
    const dueMs = new Date(`${inv.due_date}T00:00:00+09:00`).getTime()
    const daysOverdue = Math.round((todayMs - dueMs) / (1000 * 60 * 60 * 24))
    return {
      invoiceId:   inv.id as string,
      clientId:    inv.client_id as string,
      companyName: inv.clients?.company_name ?? inv.client_id,
      dueDate:     inv.due_date as string,
      totalAmount: inv.total_amount as number,
      daysOverdue,
    }
  })

  const keys      = overdue.map(o => buildAlertKey('overdue_invoice', o.invoiceId))
  const statusMap = await fetchEmailStatuses(db, keys)

  return overdue.map(o => ({
    ...o,
    emailStatus: statusMap.get(buildAlertKey('overdue_invoice', o.invoiceId)) ?? 'not_sent',
  }))
}
```

- [ ] **Step 8: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: エラーなし。

- [ ] **Step 9: コミット**

```bash
git add web/src/app/_actions/defensiveAlertQueries.ts web/src/app/_actions/defensiveAlertQueries.test.ts
git commit -m "feat: 延滞請求書検知(fetchOverdueInvoices)を追加"
```

---

### Task 3: `scheduleActions.ts` — `logNotification`を`clientId`対応に拡張

**Files:**
- Modify: `web/src/app/_actions/scheduleActions.ts:549-574`

**Interfaces:**
- Consumes: Task 1の`notification_logs.client_id`列
- Produces: `logNotification(params: { contractorId?: string; clientId?: string; type; destination; status; messageId?; alertKey? })` — `contractorId`/`clientId`のどちらか一方を渡す。既存呼び出し元（`contractorId`のみ渡すもの）はそのまま動く。

- [ ] **Step 1: `logNotification`を書き換え**

`web/src/app/_actions/scheduleActions.ts`の`export async function logNotification(...)`全体（549〜574行目）を以下に置き換える：

```ts
export async function logNotification(params: {
  contractorId?: string
  clientId?:     string
  type:          NotificationLogType
  destination:   string
  status:        NotificationLogStatus
  messageId?:    string | null
  alertKey?:     string | null
}): Promise<ActionResult<{ id: string }>> {
  const db = createServiceClient() as any

  const { data, error } = await db
    .from('notification_logs')
    .insert({
      contractor_id: params.contractorId ?? null,
      client_id:     params.clientId ?? null,
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

- [ ] **Step 2: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add web/src/app/_actions/scheduleActions.ts
git commit -m "feat: logNotificationをclientId対応に拡張"
```

---

### Task 4: `emailCore.ts` — `deliverAlertEmail`を`clientId`対応に拡張

**Files:**
- Modify: `web/src/app/_actions/emailCore.ts`（全体）

**Interfaces:**
- Consumes: `logNotification`（Task 3で拡張済み）
- Produces: `deliverAlertEmail(params: { contractorId?: string; clientId?: string; alertKey: string; alertType: string; message: string; tenantId: string }): Promise<ActionResult<{ status: 'sent'|'failed'; messageId: string|null }>>` — `clientId`が渡された場合は`ADMIN_ALERT_EMAIL`宛に送信する。

- [ ] **Step 1: ファイル全体を書き換え**

`web/src/app/_actions/emailCore.ts`の内容を以下に置き換える（`sendViaResend`は変更なし、`ALERT_SUBJECTS`に`overdue_invoice`追加、`deliverAlertEmail`を`clientId`対応に変更）：

```ts
import { createServiceClient } from '@/utils/supabase/service'
import { logNotification } from './scheduleActions'

// ⚠️ このファイルには意図的に 'use server' を付けない。
// 'use server' ファイルの export は全て公開Server Action RPCとして
// ネットワーク到達可能になるため、認可チェックを持たない deliverAlertEmail を
// 誤ってRPC化しないよう、プレーンモジュールとして分離する
// （defensiveAlertQueries.ts と同じパターン）。
// 呼び出し元は cron ルート（route.ts）と emailActions.ts の
// sendDefensiveAlertEmail（こちらは requireMasterAccess() で認可済み）のみ。

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

const ALERT_SUBJECTS: Record<string, string> = {
  missing_input:   '【HIBIKI】稼働実績の入力をお願いします',
  pending_notice:  '【HIBIKI】支払通知書のご確認をお願いします',
  threshold:       '【HIBIKI】稼働実績の確認をお願いします',
  duplicate:       '【HIBIKI】実績データの重複について',
  invoice_warning: '【HIBIKI】インボイス登録番号のご確認',
  overdue_invoice: '【HIBIKI】延滞請求書のお知らせ',
}

async function sendViaResend(
  to: string,
  subject: string,
  text: string,
): Promise<{ messageId: string } | { error: string }> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    console.warn('[emailCore] RESEND_API_KEY が未設定です — 開発フォールバック（コンソール出力）')
    console.log('[emailCore] メール送信（モック）:', { to, subject, text })
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
      console.error('[emailCore] Resend API エラー:', res.status, body)
      return { error: `メール送信に失敗しました (${res.status})` }
    }

    const json = (await res.json()) as { id?: string }
    return { messageId: json.id ?? `resend-${Date.now()}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'メール送信に失敗しました'
    console.error('[emailCore] Resend 通信エラー:', msg)
    return { error: msg }
  }
}

/**
 * 5大ディフェンシブ・アラート用の催促・警告メールを Resend 経由で送信する共通処理。
 * 認可チェックは行わない（呼び出し元＝cronルート／sendDefensiveAlertEmail で担保する）。
 * contractorId（委託先起点）または clientId（荷主起点、⑥延滞請求書のみ）の
 * どちらか一方を渡す。clientId の場合は荷主本人には送らず ADMIN_ALERT_EMAIL 宛に送る
 * （社内向けアラートのため）。
 * 送信成否にかかわらず notification_logs に alert_key 付きで記録する
 * （宛先未設定・本文空も「送信失敗」として記録し、他の処理を止めない）。
 */
export async function deliverAlertEmail(params: {
  contractorId?: string
  clientId?:     string
  alertKey:      string
  alertType:     string
  message:       string
  tenantId:      string
}): Promise<ActionResult<{ status: 'sent' | 'failed'; messageId: string | null }>> {
  const db = createServiceClient() as any

  let destination: string | undefined

  if (params.clientId) {
    destination = process.env.ADMIN_ALERT_EMAIL?.trim()
  } else if (params.contractorId) {
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
    destination = contractorEmail || adminFallback
  } else {
    return { data: null, error: 'contractorId または clientId のいずれかが必要です' }
  }

  const subject = ALERT_SUBJECTS[params.alertType] ?? '【HIBIKI】業務確認のお願い'
  const body    = params.message.trim()

  if (!destination || !body) {
    const logRes = await logNotification({
      contractorId: params.contractorId,
      clientId:     params.clientId,
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
    clientId:     params.clientId,
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
```

- [ ] **Step 2: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: `web/src/app/api/cron/defensive-alerts/route.ts`の既存の`deliverAlertEmail(job)`呼び出しがエラーなく型チェックを通ること（`contractorId`必須→任意への変更のため、既存呼び出しは影響を受けない）。

- [ ] **Step 3: コミット**

```bash
git add web/src/app/_actions/emailCore.ts
git commit -m "feat: deliverAlertEmailをclientId対応に拡張し延滞請求書の件名を追加"
```

---

### Task 5: cron APIルート — `fetchOverdueInvoices`を統合

**Files:**
- Modify: `web/src/app/api/cron/defensive-alerts/route.ts`（全体）

**Interfaces:**
- Consumes: `fetchOverdueInvoices`, `buildOverdueInvoiceMessage`（Task 2の`defensiveAlertQueries.ts`）、`deliverAlertEmail`（Task 4で`clientId`対応済み）
- Produces: `GET /api/cron/defensive-alerts`のレスポンスJSONに⑥延滞請求書分の`sent`/`failed`件数が合算される。挙動・レスポンス形式は変更なし。

- [ ] **Step 1: ルートハンドラを書き換え**

`web/src/app/api/cron/defensive-alerts/route.ts`の内容を以下に置き換える：

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getAllTenantIds } from '@/utils/tenant'
import {
  fetchMissingInputs,
  fetchLongPendingNotices,
  fetchOverdueInvoices,
  buildAlertKey,
  buildMissingInputMessage,
  buildPendingNoticeMessage,
  buildOverdueInvoiceMessage,
} from '@/app/_actions/defensiveAlertQueries'
import { deliverAlertEmail } from '@/app/_actions/emailCore'

type AlertJob = {
  contractorId?: string
  clientId?:     string
  alertKey:      string
  alertType:     'missing_input' | 'pending_notice' | 'overdue_invoice'
  message:       string
  tenantId:      string
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
      const [missing, pending, overdue] = await Promise.all([
        fetchMissingInputs(tenantId),
        fetchLongPendingNotices(tenantId),
        fetchOverdueInvoices(tenantId),
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

      for (const o of overdue) {
        if (o.emailStatus !== 'not_sent') continue
        jobs.push({
          clientId:  o.clientId,
          alertKey:  buildAlertKey('overdue_invoice', o.invoiceId),
          alertType: 'overdue_invoice',
          message:   buildOverdueInvoiceMessage(o.companyName, o.dueDate, o.totalAmount, o.daysOverdue),
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
    // ⚠️ deliverAlertEmail が {error} を返さず例外を投げるケース
    // （予期しないDB接続エラー等）でもバッチ全体を中断しないよう try/catch で囲む。
    try {
      const result = await deliverAlertEmail(job)
      if (result.error !== null) {
        failed++
        errors.push(`${job.alertKey}: ${result.error}`)
        continue
      }
      if (result.data.status === 'sent') sent++
      else failed++
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      failed++
      errors.push(`${job.alertKey}: 予期しないエラー: ${message}`)
      continue
    }
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

- [ ] **Step 3: コミット**

```bash
git add web/src/app/api/cron/defensive-alerts/route.ts
git commit -m "feat: cronルートに延滞請求書アラート(⑥)を統合"
```

---

### Task 6: `defensiveAlertActions.ts` — `getDefensiveAlerts`に⑥を追加

**Files:**
- Modify: `web/src/app/_actions/defensiveAlertActions.ts:1-47`（インポート・型定義）
- Modify: `web/src/app/_actions/defensiveAlertActions.ts:166-209`（`getDefensiveAlerts()`）

**Interfaces:**
- Consumes: `fetchOverdueInvoices`, `type OverdueInvoiceRow`（Task 2の`defensiveAlertQueries.ts`）
- Produces: `DefensiveAlerts`型に`overdueInvoices: OverdueInvoiceRow[]`フィールドが追加され、`totalCount`に合算される。`DefensiveAlertPanel.tsx`（Task 7）がこれを使う。

- [ ] **Step 1: インポートと型定義を書き換え**

`web/src/app/_actions/defensiveAlertActions.ts`の1〜17行目を以下に置き換える：

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/utils/supabase/service'
import { getMissingInputs, type MissingInputRow } from './scheduleActions'
import { getDuplicateInputs, type DuplicateGroup } from './workRecordActions'
import {
  fetchLongPendingNotices, type PendingNoticeRow,
  fetchOverdueInvoices,   type OverdueInvoiceRow,
} from './defensiveAlertQueries'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'

// PendingNoticeRow は defensiveAlertQueries.ts に定義を移したが、
// DefensiveAlertPanel.tsx など既存の呼び出し元がこのファイルからimportしているため、
// 外部シグネチャを変えないよう再エクスポートする。
// ⚠️ 'use server' ファイルでは `export type { X }`（fromなしのローカル再エクスポート）は
// ビルド時に完全に消去されず、本番で `ReferenceError: X is not defined` を起こす
// （2026-07-10 本番障害で確認）。必ず `from` 付きの直接re-exportにすること。
export type { PendingNoticeRow, OverdueInvoiceRow } from './defensiveAlertQueries'
```

- [ ] **Step 2: `DefensiveAlerts`型に`overdueInvoices`を追加**

`export type DefensiveAlerts = {...}`ブロック（元の40〜47行目）を以下に置き換える：

```ts
export type DefensiveAlerts = {
  missingInputs:   MissingInputRow[]
  duplicates:      DuplicateGroup[]
  thresholds:      ThresholdAlertRow[]
  invoiceWarnings: InvoiceWarningRow[]
  pendingNotices:  PendingNoticeRow[]
  overdueInvoices: OverdueInvoiceRow[]
  totalCount:      number
}
```

- [ ] **Step 3: `getDefensiveAlerts()`に⑥を統合**

`export async function getDefensiveAlerts()`の関数本体（元の166〜209行目）を以下に置き換える：

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
      overdueInvoices,
    ] = await Promise.all([
      getMissingInputs(),
      getDuplicateInputs(),
      fetchAndLockThresholdViolations(),
      fetchInvoiceWarnings(),
      fetchLongPendingNotices(tenantId),
      fetchOverdueInvoices(tenantId),
    ])

    const missingInputs = missingRes.data  ?? []
    const duplicates    = duplicatesRes.data ?? []

    const totalCount =
      missingInputs.length +
      duplicates.length +
      thresholds.length +
      invoiceWarnings.length +
      pendingNotices.length +
      overdueInvoices.length

    return {
      data: {
        missingInputs,
        duplicates,
        thresholds,
        invoiceWarnings,
        pendingNotices,
        overdueInvoices,
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
git commit -m "feat: getDefensiveAlertsに延滞請求書アラート(⑥)を統合"
```

---

### Task 7: `DefensiveAlertPanel.tsx` — ⑥延滞請求書セクション追加

**Files:**
- Modify: `web/src/app/admin/_components/DefensiveAlertPanel.tsx`

**Interfaces:**
- Consumes: `type OverdueInvoiceRow`（Task 6の`@/app/_actions/defensiveAlertActions`）、`alerts.overdueInvoices`
- Produces: なし（末端UI）。手動再送信・削除ボタンは持たない（設計書§6の通り情報表示のみ、④インボイス警告セクションと同じ構造）。

- [ ] **Step 1: importに`OverdueInvoiceRow`を追加**

`web/src/app/admin/_components/DefensiveAlertPanel.tsx`冒頭のimport文（4〜12行目）を以下に置き換える：

```tsx
import {
  getDefensiveAlerts,
  reviewThresholdRecord,
  deleteAlertRecord,
  type DefensiveAlerts,
  type ThresholdAlertRow,
  type InvoiceWarningRow,
  type PendingNoticeRow,
  type OverdueInvoiceRow,
} from '@/app/_actions/defensiveAlertActions'
```

- [ ] **Step 2: `OverdueInvoiceSection`コンポーネントを追加**

`function PendingNoticeSection({...})`（427〜441行目）の直後、`// ── ⑥ 突発案件アラート ──`セクションの直前に以下を追加：

```tsx

// ── 延滞請求書（督促・延滞管理） ─────────────────────────
// ⚠️ コード内コメントの丸数字は既存の「⑥突発案件アラート」まで使用済みのため、
// 本セクションには丸数字を付けない（UIのtitle文言自体には元々丸数字は無いため実害なし）。

const yenAmount = (n: number) => `¥${n.toLocaleString('ja-JP')}`

function OverdueInvoiceSection({ rows }: { rows: OverdueInvoiceRow[] }) {
  return (
    <AlertSection icon="🔴" title="延滞請求書（入金予定日超過）" count={rows.length} color="red">
      <div className="space-y-2">
        {rows.map(r => (
          <div
            key={r.invoiceId}
            className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium text-zinc-900">{r.companyName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="text-zinc-600">入金予定日 {r.dueDate}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="font-semibold text-rose-700">{r.daysOverdue}日超過</span>
              <span className="ml-1.5 text-zinc-500">（{yenAmount(r.totalAmount)}）</span>
              {r.emailStatus === 'failed' && (
                <span className="ml-2 inline-flex rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                  ⚠️ 自動送信失敗
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              入金管理画面（/admin/sales）で入金状況を確認してください。
            </p>
          </div>
        ))}
      </div>
    </AlertSection>
  )
}
```

- [ ] **Step 3: メインコンポーネントのJSXに追加**

`<PendingNoticeSection rows={alerts.pendingNotices} onResendEmail={handleResendPendingNoticeEmail} />`（既存末尾行）の直後に以下を追加：

```tsx

      <OverdueInvoiceSection rows={alerts.overdueInvoices} />
```

- [ ] **Step 4: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add web/src/app/admin/_components/DefensiveAlertPanel.tsx
git commit -m "feat: DefensiveAlertPanelに延滞請求書セクション(⑥)を追加"
```

---

### Task 8: 入金管理画面（画面③）— 延滞行の視覚強調

**Files:**
- Modify: `web/src/app/admin/sales/page.tsx:57-77`（`Td`コンポーネント）
- Modify: `web/src/app/admin/sales/page.tsx:455-567`（`PaymentStatusTab`）

**Interfaces:**
- Consumes: `SalesListRow.status`・`SalesListRow.dueDate`（既存、変更なし）
- Produces: なし（末端UI）

- [ ] **Step 1: `Td`コンポーネントに`warn`プロパティを追加**

`web/src/app/admin/sales/page.tsx`の`function Td({...})`全体（57〜77行目）を以下に置き換える：

```tsx
function Td({
  children,
  right,
  bold,
  muted,
  warn,
}: {
  children: React.ReactNode
  right?: boolean
  bold?: boolean
  muted?: boolean
  warn?: boolean
}) {
  return (
    <td
      className={`px-4 py-3 text-sm ${right ? 'text-right' : ''} ${
        bold ? 'font-semibold text-zinc-900' : ''
      } ${warn ? 'text-rose-700 font-semibold' : muted ? 'text-zinc-400' : 'text-zinc-700'}`}
    >
      {children}
    </td>
  )
}
```

- [ ] **Step 2: `PaymentStatusTab`で延滞判定を追加**

`function PaymentStatusTab({ yearMonth }: { yearMonth: string }) {`の直後、`const [rows, setRows] = useState<SalesListRow[]>([])`の前後の変数宣言ブロック（456〜460行目）を以下に置き換える：

```tsx
function PaymentStatusTab({ yearMonth }: { yearMonth: string }) {
  const [rows, setRows]       = useState<SalesListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const isOverdue = (r: SalesListRow) => r.status === 'issued' && !!r.dueDate && r.dueDate < today
```

- [ ] **Step 3: テーブル行に延滞強調を適用**

`<tbody className="divide-y divide-zinc-100">`内の`{rows.map(r => (...))}`ブロック（533〜560行目）を以下に置き換える：

```tsx
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => (
                <tr
                  key={r.invoiceId}
                  className={`hover:bg-zinc-50 ${isOverdue(r) ? 'bg-rose-50' : ''}`}
                >
                  <Td bold>{r.companyName}</Td>
                  <Td warn={isOverdue(r)}>{r.dueDate || '—'}{isOverdue(r) && ' ⚠️'}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td right bold>{yen(r.totalAmount)}</Td>
                  <td className="px-4 py-3">
                    {r.status === 'issued' && (
                      <button
                        onClick={() => handleUpdateStatus(r.invoiceId!, 'paid')}
                        disabled={updating === r.invoiceId}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50 transition"
                      >
                        {updating === r.invoiceId ? '更新中...' : '✅ 入金済にする'}
                      </button>
                    )}
                    {r.status === 'paid' && (
                      <button
                        onClick={() => handleUpdateStatus(r.invoiceId!, 'issued')}
                        disabled={updating === r.invoiceId}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition"
                      >
                        {updating === r.invoiceId ? '更新中...' : '取り消す'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
```

- [ ] **Step 4: 型チェック**

Run: `cd web && npx tsc --noEmit`

Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add web/src/app/admin/sales/page.tsx
git commit -m "feat: 入金管理画面で延滞請求書の行を視覚強調"
```

---

### Task 9: 実地検証・本番デプロイ

**Files:**
- なし（検証のみ）

**Interfaces:**
- なし（このタスクの完了をもって「督促・延滞管理」機能全体の実装が完了する）

- [ ] **Step 1: フルビルドで最終確認**

Run: `cd web && npm run build`

Expected: ビルド成功（型エラー・lintエラーなし）。

- [ ] **Step 2: テスト用に延滞請求書を1件用意**

Supabase Dashboard（またはSQL）で、既存のテスト用請求書1件を`status='issued'`かつ`due_date`を過去日（例: 昨日）に更新する。

- [ ] **Step 3: cronルートへ直接curlし送信を確認**

```bash
curl -i -H "x-cron-secret: <CRON_SECRET>" http://localhost:3000/api/cron/defensive-alerts
```

（ローカル確認の場合は事前に`cd web && npm run dev`で起動しておく）

Expected: `200`、レスポンスJSONの`sent`にTask 2で用意した延滞請求書分が含まれる。`RESEND_API_KEY`未設定の場合はコンソールに`[emailCore] メール送信（モック）`ログが出力される（`ADMIN_ALERT_EMAIL`宛）。

- [ ] **Step 4: 同じcurlを2回連続実行し重複防止を確認**

Step 3のcurlをもう一度実行する。

Expected: レスポンスJSONの`candidates`が減る（同じ延滞請求書が`emailStatus`によりスキップされる）、`notification_logs`に新規行が増えない。

- [ ] **Step 5: 管理画面で⑥延滞請求書セクションを確認**

`/admin/dashboard`（または`DefensiveAlertPanel`が表示される画面）を開く。

Expected: 「🔴 延滞請求書（入金予定日超過）」セクションが表示され、Step 2で用意した請求書の荷主名・入金予定日・超過日数・金額が表示される。

- [ ] **Step 6: 入金管理画面（画面③）で視覚強調を確認**

`/admin/sales`の「入金管理」タブを開く。

Expected: 該当行の背景がうっすら赤く、入金予定日セルが赤字太字で「⚠️」付きで表示される。

- [ ] **Step 7: 入金済に変更してアラートが消えることを確認**

Step 6の画面で該当請求書の「✅ 入金済にする」ボタンを押す。

Expected: 行の強調表示が消える。`DefensiveAlertPanel`を再読み込みし、⑥延滞請求書セクションから該当請求書が消えている（または`count`が0になりセクション自体が非表示になる）ことを確認する。

- [ ] **Step 8: 本番デプロイ**

Run: `cd web && npm run deploy`

Expected: `wrangler deploy`が成功し、`https://unsou-system.kawapon7.workers.dev`に反映される。

> ⚠️ 本番デプロイは実行前にボスに確認すること。

- [ ] **Step 9: HANDOVER_MASTER.mdと自動メモリを更新**

`docs/HANDOVER_MASTER.md`の§5-4（機能ギャップ分析）と`docs/superpowers/plans/2026-07-18-feature-gap-roadmap.md`を「①督促・延滞管理：実装完了」に更新する。自動メモリに新規エントリを追加する（実装完了日・本番反映有無・残課題があれば記録）。
