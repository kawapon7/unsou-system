# 帳票発行の土台（採番・確定/再発行・発行控え）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 請求書・支払通知書を「番号を採って確定発行し、発行時点のスナップショットを控えとして保存し、日付・相手先・金額で検索でき、取消→再発行で履歴が残る」状態にする（要件定義 §4 電帳法・§5 運用要件・§7 優先順位①）。

**Architecture:** 発行控えは `issued_documents` テーブルに「様式キー・版＋描画用スナップショット JSON」として保存する（PDF はブラウザ印刷方式でサーバにファイルが無いため、Storage は使わない＝今回は触れない）。採番は `companies.invoice_number_format` の書式と `document_sequences` を DB 関数で原子的に進める。取消・再発行は `status='cancelled'` と `superseded_by` で繋ぎ、insert-only の `document_history` に刻む。DB の金額計算は一切変えない。

**Tech Stack:** Next.js App Router (Server Actions), Supabase (Postgres/RLS), vitest。新規パッケージ追加なし。

## Global Constraints

- DB アクセスは Server Actions のみ。クライアント直クエリ禁止（CLAUDE.md §2）
- `'use server'` ファイルは async 関数しか export しない（`use-server-exports.test.ts` が番人）
- `invoices` への書き込みは `utils/invoice-writer.ts` 経由のみ。本計画では invoices を**書かない**
- 分離キーは `tenant_id`。service クライアントは RLS を通らないので全クエリで `.eq('tenant_id', tenantId)`
- `approval_history` / `notification_logs` に UPDATE/DELETE を書かない（本計画では触れない）
- マイグレーションは**ファイル作成まで**。本番適用はボスが Supabase ダッシュボード SQL Editor で手動（MCP から DDL 不可）。適用前は画面検証不可のため、検証は tsc / vitest / build で行い「未検証（DB未適用）」と明記する
- 新規列を `web/src/types/supabase.ts` に手で追記する（`phantom-columns.test.ts` が列名を照合する）
- 色クラスは `nav.tsx` の `CATEGORY_STYLES` 経由のみ
- 発行は owner のみ（`requireOwner`）。ドライバーは自分宛て支払通知書の控えのみ閲覧
- コミット前3ステップ（hibiki-security #4）を毎回通す

---

### Task 1: マイグレーション（テーブル・関数・RLS・不変トリガ）

**Files:**
- Create: `supabase/migrations/20260823150000_document_issuance_foundation.sql`
- Modify: `web/src/types/supabase.ts`（`companies` / `clients` に列追加、`issued_documents` / `document_sequences` / `document_history` を Tables に追加、`next_document_sequence` を Functions に追加）

**Interfaces:**
- Produces: テーブル `issued_documents`, `document_history`, `document_sequences`、関数 `public.next_document_sequence(p_tenant_id uuid, p_kind text, p_period_key text) RETURNS integer`、列 `companies.invoice_number_format`, `companies.document_format_key`, `clients.document_format_key`

- [ ] **Step 1: マイグレーション SQL を書く**

```sql
-- ================================================================
-- 帳票発行の土台: 採番・発行控え・取消/再発行履歴
-- 要件: docs/superpowers/specs/2026-08-23-client-format-documents-design.md §4 §5 §7-1
-- 計画: docs/superpowers/plans/2026-08-23-document-issuance-foundation.md
-- ⚠️ DDL は MCP からブロックされる。Supabase ダッシュボード SQL Editor で手動適用し、
--    supabase_migrations.schema_migrations に version を記録すること。
-- ================================================================
BEGIN;

-- 1. 会社設定: 採番書式と標準様式キー
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS invoice_number_format text NOT NULL DEFAULT 'INV-{YYYY}{MM}-{SEQ:4}',
  ADD COLUMN IF NOT EXISTS document_format_key  text NOT NULL DEFAULT 'standard';

-- 2. 荷主設定: 荷主指定様式（NULL = 会社の標準様式を使う）
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS document_format_key text;

-- 3. 採番カウンタ（テナント×種別×期間）
CREATE TABLE IF NOT EXISTS public.document_sequences (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id),
  kind       text NOT NULL CHECK (kind IN ('invoice','payment_notice')),
  period_key text NOT NULL,
  last_no    integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind, period_key)
);
ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;
-- authenticated 向けポリシーを置かない = service_role（Server Action）専用

-- 原子的に次番号を返す。同時発行でも重複しない（行ロック）。
CREATE OR REPLACE FUNCTION public.next_document_sequence(
  p_tenant_id uuid, p_kind text, p_period_key text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_no integer;
BEGIN
  INSERT INTO public.document_sequences (tenant_id, kind, period_key, last_no)
  VALUES (p_tenant_id, p_kind, p_period_key, 1)
  ON CONFLICT (tenant_id, kind, period_key)
  DO UPDATE SET last_no = public.document_sequences.last_no + 1, updated_at = now()
  RETURNING last_no INTO v_no;
  RETURN v_no;
END;
$$;
REVOKE ALL ON FUNCTION public.next_document_sequence(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_document_sequence(uuid, text, text) TO service_role;

-- 4. 発行控え（電帳法: 日付・相手先・金額で検索可能。様式キー・版を記録）
CREATE TABLE IF NOT EXISTS public.issued_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id),
  kind            text NOT NULL CHECK (kind IN ('invoice','payment_notice')),
  source_id       uuid NOT NULL,          -- invoices.id または payment_notices.id
  contractor_id   uuid REFERENCES public.contractors(id),  -- 支払通知書のみ。ドライバー本人閲覧用
  document_number text NOT NULL,
  format_key      text NOT NULL,
  format_version  integer NOT NULL,
  status          text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','cancelled')),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  issued_by       uuid NOT NULL REFERENCES public.users(id),
  cancelled_at    timestamptz,
  cancelled_by    uuid REFERENCES public.users(id),
  cancel_reason   text,
  superseded_by   uuid REFERENCES public.issued_documents(id),
  party_name      text NOT NULL,          -- 相手先名（検索用）
  document_date   date NOT NULL,          -- 発行日（検索用）
  total_amount    numeric NOT NULL,       -- 税込合計（検索用）
  snapshot        jsonb NOT NULL,         -- 描画用データ（InvoicePdfData / PaymentNoticePdfData）
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);
-- 同じ元データに有効な控えは1件まで（取消してから再発行する）
CREATE UNIQUE INDEX IF NOT EXISTS issued_documents_active_source
  ON public.issued_documents (tenant_id, kind, source_id) WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS idx_issued_documents_tenant_date  ON public.issued_documents (tenant_id, document_date);
CREATE INDEX IF NOT EXISTS idx_issued_documents_tenant_party ON public.issued_documents (tenant_id, party_name);

-- 控えは「取消」以外の更新と削除を禁止（全ロール）
CREATE OR REPLACE FUNCTION public.guard_issued_documents_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '発行控え（issued_documents）の削除は禁止されています。取消で対応してください。';
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind
     OR NEW.source_id <> OLD.source_id OR NEW.document_number <> OLD.document_number
     OR NEW.format_key <> OLD.format_key OR NEW.format_version <> OLD.format_version
     OR NEW.issued_at <> OLD.issued_at OR NEW.issued_by <> OLD.issued_by
     OR NEW.party_name <> OLD.party_name OR NEW.document_date <> OLD.document_date
     OR NEW.total_amount <> OLD.total_amount OR NEW.snapshot <> OLD.snapshot
     OR OLD.status = 'cancelled' THEN
    RAISE EXCEPTION '発行控え（issued_documents）は取消以外の変更が禁止されています。';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_issued_documents_guard_update ON public.issued_documents;
DROP TRIGGER IF EXISTS trg_issued_documents_guard_delete ON public.issued_documents;
CREATE TRIGGER trg_issued_documents_guard_update BEFORE UPDATE ON public.issued_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_issued_documents_modification();
CREATE TRIGGER trg_issued_documents_guard_delete BEFORE DELETE ON public.issued_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_issued_documents_modification();

ALTER TABLE public.issued_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS issued_documents_owner_select ON public.issued_documents;
CREATE POLICY issued_documents_owner_select ON public.issued_documents
  FOR SELECT TO authenticated USING (internal.is_owner());
DROP POLICY IF EXISTS issued_documents_contractor_select ON public.issued_documents;
CREATE POLICY issued_documents_contractor_select ON public.issued_documents
  FOR SELECT TO authenticated
  USING ((NOT internal.is_owner()) AND kind = 'payment_notice' AND contractor_id = internal.my_contractor_id());
-- INSERT/UPDATE は service_role（Server Action）のみ

-- 5. 発行履歴（不変ログ: INSERT のみ）
CREATE TABLE IF NOT EXISTS public.document_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id),
  issued_document_id uuid NOT NULL REFERENCES public.issued_documents(id),
  action_type        text NOT NULL CHECK (action_type IN ('issued','cancelled','reissued')),
  action_by          uuid NOT NULL REFERENCES public.users(id),
  reason             text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_document_history_doc ON public.document_history (issued_document_id);
CREATE OR REPLACE FUNCTION public.prevent_document_history_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '発行履歴（document_history）の変更・削除は禁止されています。';
END;
$$;
DROP TRIGGER IF EXISTS trg_document_history_no_update ON public.document_history;
DROP TRIGGER IF EXISTS trg_document_history_no_delete ON public.document_history;
CREATE TRIGGER trg_document_history_no_update BEFORE UPDATE ON public.document_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_document_history_modification();
CREATE TRIGGER trg_document_history_no_delete BEFORE DELETE ON public.document_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_document_history_modification();
ALTER TABLE public.document_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_history_owner_select ON public.document_history;
CREATE POLICY document_history_owner_select ON public.document_history
  FOR SELECT TO authenticated USING (internal.is_owner());

COMMIT;
```

- [ ] **Step 2: `web/src/types/supabase.ts` を手で更新**

`companies.Row/Insert/Update` に `invoice_number_format: string` / `document_format_key: string`（Insert/Update は `?`）、`clients` に `document_format_key: string | null` を追加。`Tables` に `document_sequences`, `issued_documents`, `document_history` を上記列どおり（Row は全列、Insert はデフォルト付き列を `?`、Update は全列 `?`）追加。`Functions` に
```ts
next_document_sequence: {
  Args: { p_tenant_id: string; p_kind: string; p_period_key: string }
  Returns: number
}
```
を追加。既存テーブルの記述スタイル（`Relationships` 配列など）に合わせる。

- [ ] **Step 3: 型チェックとテスト**

Run: `cd web && npx tsc --noEmit && npx vitest run src/utils/phantom-columns.test.ts`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260823150000_document_issuance_foundation.sql web/src/types/supabase.ts
git commit -m "feat(db): 帳票発行の土台（issued_documents/document_history/document_sequences、採番書式・様式キー列）※未適用"
```

---

### Task 2: 採番書式ユーティリティ（純粋関数・TDD）

**Files:**
- Create: `web/src/utils/document-number.ts`
- Test: `web/src/utils/document-number.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_INVOICE_NUMBER_FORMAT = 'INV-{YYYY}{MM}-{SEQ:4}'`
  - `validateDocumentNumberFormat(format: string): string | null`（エラー文 or null）
  - `sequencePeriodKey(format: string, ctx: NumberContext): string`
  - `formatDocumentNumber(format: string, ctx: NumberContext & { seq: number }): string`
  - `type NumberContext = { date: Date; fiscalYearEndMonth?: number | null; clientCode?: string | null }`
  - トークン: `{YYYY}` `{YY}` `{MM}` `{DD}` `{FY}`（事業年度。決算月 3 なら 2026-04〜2027-03 が FY2026）`{SEQ}` `{SEQ:n}`（n 桁ゼロ埋め）`{CLIENT}`（荷主コード。無ければ空）
  - 期間キー: `{FY}` があれば `FY<年>`、なければ `{YYYY}`/`{YY}` と `{MM}` の有無で `Y<年>M<月>` / `Y<年>` / `ALL`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_INVOICE_NUMBER_FORMAT, validateDocumentNumberFormat,
  sequencePeriodKey, formatDocumentNumber,
} from './document-number'

const d = new Date(2026, 7, 23) // 2026-08-23 local

describe('formatDocumentNumber', () => {
  it('既定書式: INV-202608-0007', () => {
    expect(formatDocumentNumber(DEFAULT_INVOICE_NUMBER_FORMAT, { date: d, seq: 7 })).toBe('INV-202608-0007')
  })
  it('FY と YY と CLIENT', () => {
    expect(formatDocumentNumber('{CLIENT}-{FY}-{SEQ:3}', { date: d, seq: 12, fiscalYearEndMonth: 3, clientCode: 'OBA' }))
      .toBe('OBA-2026-012')
    expect(formatDocumentNumber('{YY}{MM}{DD}-{SEQ}', { date: d, seq: 3 })).toBe('260823-3')
  })
  it('決算月を跨ぐと FY が前年になる', () => {
    expect(formatDocumentNumber('{FY}-{SEQ}', { date: new Date(2027, 1, 1), seq: 1, fiscalYearEndMonth: 3 })).toBe('2026-1')
    expect(formatDocumentNumber('{FY}-{SEQ}', { date: new Date(2027, 3, 1), seq: 1, fiscalYearEndMonth: 3 })).toBe('2027-1')
  })
  it('決算月未設定なら FY は暦年', () => {
    expect(formatDocumentNumber('{FY}-{SEQ}', { date: d, seq: 1 })).toBe('2026-1')
  })
  it('CLIENT 未設定は空文字', () => {
    expect(formatDocumentNumber('{CLIENT}{SEQ:2}', { date: d, seq: 5 })).toBe('05')
  })
})

describe('sequencePeriodKey', () => {
  it('月次・年次・事業年度・通し', () => {
    expect(sequencePeriodKey('INV-{YYYY}{MM}-{SEQ:4}', { date: d })).toBe('Y2026M08')
    expect(sequencePeriodKey('{YY}-{SEQ}', { date: d })).toBe('Y2026')
    expect(sequencePeriodKey('{FY}-{SEQ}', { date: d, fiscalYearEndMonth: 3 })).toBe('FY2026')
    expect(sequencePeriodKey('NO-{SEQ}', { date: d })).toBe('ALL')
  })
  it('CLIENT があれば荷主ごとに連番を分ける', () => {
    expect(sequencePeriodKey('{CLIENT}-{YYYY}-{SEQ}', { date: d, clientCode: 'OBA' })).toBe('Y2026:OBA')
  })
})

describe('validateDocumentNumberFormat', () => {
  it('SEQ 必須・未知トークン拒否・空拒否', () => {
    expect(validateDocumentNumberFormat('INV-{YYYY}{MM}-{SEQ:4}')).toBeNull()
    expect(validateDocumentNumberFormat('INV-{YYYY}')).toMatch(/SEQ/)
    expect(validateDocumentNumberFormat('{FOO}-{SEQ}')).toMatch(/FOO/)
    expect(validateDocumentNumberFormat('')).not.toBeNull()
    expect(validateDocumentNumberFormat('{SEQ:0}')).not.toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `cd web && npx vitest run src/utils/document-number.test.ts`
Expected: FAIL（モジュール未定義）

- [ ] **Step 3: 実装**

```ts
// ⚠️ 'use server' を付けない（非 async export があるため）。DB に触れない純粋関数。
export const DEFAULT_INVOICE_NUMBER_FORMAT = 'INV-{YYYY}{MM}-{SEQ:4}'

export type NumberContext = {
  date: Date
  /** 決算月 1〜12。未設定なら FY は暦年 */
  fiscalYearEndMonth?: number | null
  clientCode?: string | null
}

const TOKEN_RE = /\{(YYYY|YY|MM|DD|FY|CLIENT|SEQ(?::(\d+))?)\}/g
const KNOWN = new Set(['YYYY', 'YY', 'MM', 'DD', 'FY', 'CLIENT', 'SEQ'])

export function fiscalYearOf(date: Date, fiscalYearEndMonth?: number | null): number {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  if (!fiscalYearEndMonth || fiscalYearEndMonth < 1 || fiscalYearEndMonth > 12 || fiscalYearEndMonth === 12) return y
  // 決算月 3 → 4月〜翌3月が1年度。開始月より前なら前年度
  return m <= fiscalYearEndMonth ? y - 1 : y
}

export function validateDocumentNumberFormat(format: string): string | null {
  if (!format.trim()) return '採番書式が空です'
  let hasSeq = false
  for (const m of format.matchAll(/\{([^}]*)\}/g)) {
    const body = m[1]
    const [name, width] = body.split(':')
    if (!KNOWN.has(name)) return `未知のトークン {${body}} があります`
    if (name === 'SEQ') {
      hasSeq = true
      if (width !== undefined && !(/^\d+$/.test(width) && Number(width) >= 1)) return `{SEQ:n} の n は 1 以上の整数にしてください`
    } else if (width !== undefined) {
      return `{${name}} に桁指定は使えません`
    }
  }
  if (!hasSeq) return '採番書式には {SEQ} または {SEQ:n} が必要です'
  return null
}

export function sequencePeriodKey(format: string, ctx: NumberContext): string {
  const hasFY = format.includes('{FY}')
  const hasYear = /\{YYYY\}|\{YY\}/.test(format)
  const hasMonth = format.includes('{MM}')
  const y = ctx.date.getFullYear()
  const mm = String(ctx.date.getMonth() + 1).padStart(2, '0')
  let key: string
  if (hasFY) key = `FY${fiscalYearOf(ctx.date, ctx.fiscalYearEndMonth)}`
  else if (hasYear && hasMonth) key = `Y${y}M${mm}`
  else if (hasYear) key = `Y${y}`
  else key = 'ALL'
  if (format.includes('{CLIENT}') && ctx.clientCode) key += `:${ctx.clientCode}`
  return key
}

export function formatDocumentNumber(format: string, ctx: NumberContext & { seq: number }): string {
  const y = ctx.date.getFullYear()
  return format.replace(TOKEN_RE, (_all, name: string, width?: string) => {
    if (name.startsWith('SEQ')) {
      const w = width ? Number(width) : 0
      return String(ctx.seq).padStart(w, '0')
    }
    switch (name) {
      case 'YYYY': return String(y)
      case 'YY':   return String(y).slice(-2)
      case 'MM':   return String(ctx.date.getMonth() + 1).padStart(2, '0')
      case 'DD':   return String(ctx.date.getDate()).padStart(2, '0')
      case 'FY':   return String(fiscalYearOf(ctx.date, ctx.fiscalYearEndMonth))
      case 'CLIENT': return ctx.clientCode ?? ''
      default: return ''
    }
  })
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd web && npx vitest run src/utils/document-number.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: Commit**

```bash
git add web/src/utils/document-number.ts web/src/utils/document-number.test.ts
git commit -m "feat(utils): 請求書番号の採番書式（トークン展開・期間キー・検証）"
```

---

### Task 3: 様式レジストリ（純粋関数・TDD）

**Files:**
- Create: `web/src/utils/document-formats.ts`
- Test: `web/src/utils/document-formats.test.ts`

**Interfaces:**
- Produces:
  - `type DocumentKind = 'invoice' | 'payment_notice'`
  - `type DocumentFormat = { key: string; version: number; label: string; kinds: DocumentKind[] }`
  - `DOCUMENT_FORMATS: Record<string, DocumentFormat>`（初期は `standard` のみ、version 1）
  - `resolveDocumentFormat(kind, opts: { clientKey?: string | null; companyKey?: string | null }): DocumentFormat`（荷主→会社→standard の順。未知キー・種別非対応は standard にフォールバック）
  - `listDocumentFormatOptions(kind): { key: string; label: string }[]`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest'
import { resolveDocumentFormat, listDocumentFormatOptions, DOCUMENT_FORMATS } from './document-formats'

describe('resolveDocumentFormat', () => {
  it('荷主指定が最優先、無ければ会社、無ければ standard', () => {
    expect(resolveDocumentFormat('invoice', { clientKey: null, companyKey: null }).key).toBe('standard')
    expect(resolveDocumentFormat('invoice', { clientKey: 'standard', companyKey: 'nope' }).key).toBe('standard')
  })
  it('未知キーは standard にフォールバック', () => {
    expect(resolveDocumentFormat('invoice', { clientKey: 'unknown' }).key).toBe('standard')
  })
  it('standard は版番号を持つ', () => {
    expect(DOCUMENT_FORMATS.standard.version).toBe(1)
  })
})

describe('listDocumentFormatOptions', () => {
  it('種別に対応する様式だけ返す', () => {
    expect(listDocumentFormatOptions('invoice')).toEqual([{ key: 'standard', label: '標準様式' }])
    expect(listDocumentFormatOptions('payment_notice')).toEqual([{ key: 'standard', label: '標準様式' }])
  })
})
```

- [ ] **Step 2: 失敗を確認** — Run: `cd web && npx vitest run src/utils/document-formats.test.ts` → FAIL

- [ ] **Step 3: 実装**

```ts
// 様式レジストリ。おおば運送など導入先様式はここにキーを追加し、
// 描画コンポーネントと Excel マッピングをキーで引く（計画②で追加）。
// ⚠️ 様式の見た目を変えたら version を上げる。発行済み控えは発行時の version を保持し、
//    再表示時にその版で描画する（要件 §5 様式の版管理）。
export type DocumentKind = 'invoice' | 'payment_notice'

export type DocumentFormat = {
  key: string
  version: number
  label: string
  kinds: DocumentKind[]
}

export const STANDARD_FORMAT_KEY = 'standard'

export const DOCUMENT_FORMATS: Record<string, DocumentFormat> = {
  standard: { key: 'standard', version: 1, label: '標準様式', kinds: ['invoice', 'payment_notice'] },
}

function supports(f: DocumentFormat | undefined, kind: DocumentKind): f is DocumentFormat {
  return !!f && f.kinds.includes(kind)
}

export function resolveDocumentFormat(
  kind: DocumentKind,
  opts: { clientKey?: string | null; companyKey?: string | null },
): DocumentFormat {
  for (const k of [opts.clientKey, opts.companyKey]) {
    if (k && supports(DOCUMENT_FORMATS[k], kind)) return DOCUMENT_FORMATS[k]
  }
  return DOCUMENT_FORMATS[STANDARD_FORMAT_KEY]
}

export function listDocumentFormatOptions(kind: DocumentKind): { key: string; label: string }[] {
  return Object.values(DOCUMENT_FORMATS).filter(f => f.kinds.includes(kind)).map(f => ({ key: f.key, label: f.label }))
}
```

- [ ] **Step 4: PASS を確認** — Run: `cd web && npx vitest run src/utils/document-formats.test.ts`

- [ ] **Step 5: Commit**

```bash
git add web/src/utils/document-formats.ts web/src/utils/document-formats.test.ts
git commit -m "feat(utils): 帳票様式レジストリ（荷主→会社→標準のフォールバック、版番号）"
```

---

### Task 4: 発行・取消・再発行・検索の Server Actions

**Files:**
- Create: `web/src/app/_actions/document-actions.ts`
- Create: `web/src/utils/document-search.ts`（検索条件の正規化、純粋関数）
- Test: `web/src/utils/document-search.test.ts`
- Modify: `web/src/app/_actions/pdf-actions.ts`（`fetchInvoicePdfData` の番号決定を発行控え優先に）

**Interfaces:**
- Consumes: `fetchInvoicePdfData`, `fetchPaymentNoticePdfData`（pdf-actions）、`formatDocumentNumber` / `sequencePeriodKey` / `validateDocumentNumberFormat`（Task 2）、`resolveDocumentFormat`（Task 3）、`requireOwner` / `requireAuth`、`getCurrentTenantId`、`createServiceClient`
- Produces（すべて `'use server'`、戻りは `ActionResult<T> = { data: T; error: null } | { data: null; error: string }`）:
  - `issueInvoiceDocument(clientId: string, yearMonth: string): Promise<ActionResult<IssuedDocumentSummary>>`
  - `issuePaymentNoticeDocument(contractorId: string, yearMonth: string): Promise<ActionResult<IssuedDocumentSummary>>`
  - `cancelIssuedDocument(id: string, reason: string): Promise<ActionResult<void>>`
  - `reissueDocument(id: string, reason: string): Promise<ActionResult<IssuedDocumentSummary>>`（取消＋新規発行、`superseded_by` を繋ぐ）
  - `listIssuedDocuments(filter: IssuedDocumentFilter): Promise<ActionResult<IssuedDocumentSummary[]>>`（owner のみ、最大 200 件）
  - `getIssuedDocument(id: string): Promise<ActionResult<IssuedDocumentDetail>>`（owner または本人のドライバー）
  - `getActiveIssuedDocumentForSource(kind, sourceId): Promise<ActionResult<IssuedDocumentSummary | null>>`
  - 型（`web/src/utils/document-search.ts` に置く。`'use server'` ファイルから型以外を export しないため）:
    ```ts
    export type IssuedDocumentFilter = { kind?: DocumentKind | ''; dateFrom?: string; dateTo?: string; party?: string; minAmount?: string; maxAmount?: string; includeCancelled?: boolean }
    export type IssuedDocumentSummary = { id: string; kind: DocumentKind; sourceId: string; documentNumber: string; formatKey: string; formatVersion: number; status: 'issued' | 'cancelled'; issuedAt: string; cancelledAt: string | null; cancelReason: string | null; supersededBy: string | null; partyName: string; documentDate: string; totalAmount: number }
    export type IssuedDocumentDetail = IssuedDocumentSummary & { snapshot: unknown }
    export function normalizeFilter(f: IssuedDocumentFilter): { kind: DocumentKind | null; dateFrom: string | null; dateTo: string | null; party: string | null; minAmount: number | null; maxAmount: number | null; includeCancelled: boolean }
    ```

- [ ] **Step 1: 検索条件正規化のテストを書く**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeFilter } from './document-search'

describe('normalizeFilter', () => {
  it('空文字は null、金額は数値化、前後空白を除く', () => {
    expect(normalizeFilter({ kind: '', dateFrom: '', party: ' おおば ', minAmount: '1,000', maxAmount: 'abc' }))
      .toEqual({ kind: null, dateFrom: null, dateTo: null, party: 'おおば', minAmount: 1000, maxAmount: null, includeCancelled: false })
  })
  it('日付は YYYY-MM-DD のみ受け付ける', () => {
    expect(normalizeFilter({ dateFrom: '2026-08-01', dateTo: '2026/08/31' }).dateFrom).toBe('2026-08-01')
    expect(normalizeFilter({ dateFrom: '2026-08-01', dateTo: '2026/08/31' }).dateTo).toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確認** — Run: `cd web && npx vitest run src/utils/document-search.test.ts` → FAIL

- [ ] **Step 3: `document-search.ts` を実装**

```ts
import type { DocumentKind } from './document-formats'

export type IssuedDocumentFilter = {
  kind?: DocumentKind | ''
  dateFrom?: string
  dateTo?: string
  party?: string
  minAmount?: string
  maxAmount?: string
  includeCancelled?: boolean
}

export type IssuedDocumentSummary = {
  id: string
  kind: DocumentKind
  sourceId: string
  documentNumber: string
  formatKey: string
  formatVersion: number
  status: 'issued' | 'cancelled'
  issuedAt: string
  cancelledAt: string | null
  cancelReason: string | null
  supersededBy: string | null
  partyName: string
  documentDate: string
  totalAmount: number
}

export type IssuedDocumentDetail = IssuedDocumentSummary & { snapshot: unknown }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function toAmount(s?: string): number | null {
  if (!s) return null
  const n = Number(s.replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

function toDate(s?: string): string | null {
  return s && DATE_RE.test(s) ? s : null
}

export function normalizeFilter(f: IssuedDocumentFilter) {
  const party = f.party?.trim() ?? ''
  return {
    kind: f.kind === 'invoice' || f.kind === 'payment_notice' ? f.kind : null,
    dateFrom: toDate(f.dateFrom),
    dateTo: toDate(f.dateTo),
    party: party ? party : null,
    minAmount: toAmount(f.minAmount),
    maxAmount: toAmount(f.maxAmount),
    includeCancelled: !!f.includeCancelled,
  }
}
```

- [ ] **Step 4: PASS を確認** — Run: `cd web && npx vitest run src/utils/document-search.test.ts`

- [ ] **Step 5: `document-actions.ts` を実装**

```ts
'use server'

import { createServiceClient } from '@/utils/supabase/service'
import { requireOwner, requireAuth } from '@/utils/auth'
import { getCurrentTenantId } from '@/utils/tenant'
import { fetchInvoicePdfData, fetchPaymentNoticePdfData } from './pdf-actions'
import {
  DEFAULT_INVOICE_NUMBER_FORMAT, formatDocumentNumber, sequencePeriodKey, validateDocumentNumberFormat,
} from '@/utils/document-number'
import { resolveDocumentFormat, type DocumentKind } from '@/utils/document-formats'
import {
  normalizeFilter,
  type IssuedDocumentFilter, type IssuedDocumentSummary, type IssuedDocumentDetail,
} from '@/utils/document-search'

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

// ⚠️ 本ファイルは invoices / payment_notices を一切書かない。金額計算も持たない。
//    発行控えは「発行時点の描画データ（snapshot）」をそのまま保存する。
//    DB 未適用環境ではテーブルが無いためすべて error を返す（未検証注記: 計画 Global Constraints）。

type Row = {
  id: string; kind: DocumentKind; source_id: string; document_number: string
  format_key: string; format_version: number; status: 'issued' | 'cancelled'
  issued_at: string; cancelled_at: string | null; cancel_reason: string | null
  superseded_by: string | null; party_name: string; document_date: string; total_amount: number
}
const SUMMARY_COLUMNS =
  'id, kind, source_id, document_number, format_key, format_version, status, issued_at, cancelled_at, cancel_reason, superseded_by, party_name, document_date, total_amount'

function toSummary(r: Row): IssuedDocumentSummary {
  return {
    id: r.id, kind: r.kind, sourceId: r.source_id, documentNumber: r.document_number,
    formatKey: r.format_key, formatVersion: r.format_version, status: r.status,
    issuedAt: r.issued_at, cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason,
    supersededBy: r.superseded_by, partyName: r.party_name, documentDate: r.document_date,
    totalAmount: Number(r.total_amount),
  }
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 会社設定から採番書式・決算月・標準様式キーを取る（未登録は fail-closed） */
async function loadCompanyIssuanceSettings(service: ReturnType<typeof createServiceClient>, tenantId: string) {
  const { data, error } = await service
    .from('companies')
    .select('invoice_number_format, fiscal_year_end_month, document_format_key')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: '自社情報が未登録です。設定 > 自社情報を先に登録してください。' }
  const format = data.invoice_number_format || DEFAULT_INVOICE_NUMBER_FORMAT
  const fmtErr = validateDocumentNumberFormat(format)
  if (fmtErr) return { data: null, error: `採番書式が不正です: ${fmtErr}` }
  return {
    data: { format, fiscalYearEndMonth: data.fiscal_year_end_month as number | null, companyFormatKey: data.document_format_key as string | null },
    error: null,
  }
}

type IssueInput = {
  kind: DocumentKind
  sourceId: string
  contractorId: string | null
  partyName: string
  totalAmount: number
  snapshot: unknown
  clientFormatKey: string | null
  clientCode: string | null
  userId: string
  supersedes?: { id: string; reason: string }
}

/** 採番→INSERT→履歴。取消→再発行の場合は旧控えの superseded_by を繋ぐ */
async function issueDocument(
  service: ReturnType<typeof createServiceClient>, tenantId: string, input: IssueInput,
): Promise<ActionResult<IssuedDocumentSummary>> {
  const settings = await loadCompanyIssuanceSettings(service, tenantId)
  if (settings.error) return { data: null, error: settings.error }
  const { format, fiscalYearEndMonth, companyFormatKey } = settings.data!

  // 有効な控えが既にあれば拒否（部分ユニーク索引でも守られるが、先に分かる文言で返す）
  const { data: active } = await service
    .from('issued_documents')
    .select('id, document_number')
    .eq('tenant_id', tenantId).eq('kind', input.kind).eq('source_id', input.sourceId).eq('status', 'issued')
    .maybeSingle()
  if (active) {
    return { data: null, error: `発行済みの控え（${active.document_number}）があります。取消してから再発行してください。` }
  }

  const now = new Date()
  const ctx = { date: now, fiscalYearEndMonth, clientCode: input.clientCode }
  // ⚠️ 支払通知書も同じ書式・別カウンタ（kind で分かれる）。書式分離は計画③で検討
  const periodKey = sequencePeriodKey(format, ctx)
  const { data: seq, error: seqErr } = await service.rpc('next_document_sequence', {
    p_tenant_id: tenantId, p_kind: input.kind, p_period_key: periodKey,
  })
  if (seqErr || typeof seq !== 'number') return { data: null, error: `採番に失敗しました: ${seqErr?.message ?? 'unknown'}` }
  const documentNumber = formatDocumentNumber(format, { ...ctx, seq })

  const fmt = resolveDocumentFormat(input.kind, { clientKey: input.clientFormatKey, companyKey: companyFormatKey })

  const { data: inserted, error: insErr } = await service
    .from('issued_documents')
    .insert({
      tenant_id: tenantId, kind: input.kind, source_id: input.sourceId, contractor_id: input.contractorId,
      document_number: documentNumber, format_key: fmt.key, format_version: fmt.version,
      status: 'issued', issued_by: input.userId,
      party_name: input.partyName, document_date: todayStr(), total_amount: input.totalAmount,
      snapshot: input.snapshot as never,
    })
    .select(SUMMARY_COLUMNS)
    .single()
  if (insErr || !inserted) return { data: null, error: insErr?.message ?? '控えの保存に失敗しました' }

  if (input.supersedes) {
    // 旧控えに後継を記録（取消済みなのでトリガが拒否する → 取消と同時に済ませる設計にする）
    // ⚠️ guard トリガは status='cancelled' の行の UPDATE を拒否する。
    //    そのため superseded_by は取消の UPDATE と同じ文で書く（cancelIssuedDocumentInternal 参照）。
  }

  const { error: histErr } = await service.from('document_history').insert({
    tenant_id: tenantId, issued_document_id: inserted.id,
    action_type: input.supersedes ? 'reissued' : 'issued', action_by: input.userId,
    reason: input.supersedes?.reason ?? null,
  })
  if (histErr) return { data: null, error: `履歴の記録に失敗しました: ${histErr.message}` }

  return { data: toSummary(inserted as Row), error: null }
}

async function cancelInternal(
  service: ReturnType<typeof createServiceClient>, tenantId: string,
  id: string, reason: string, userId: string, supersededBy: string | null,
): Promise<ActionResult<Row>> {
  if (!reason.trim()) return { data: null, error: '取消理由を入力してください' }
  const { data: doc, error } = await service
    .from('issued_documents').select(SUMMARY_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!doc) return { data: null, error: '控えが見つかりません' }
  if (doc.status === 'cancelled') return { data: null, error: 'すでに取消済みです' }

  const { error: updErr } = await service
    .from('issued_documents')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: userId, cancel_reason: reason.trim(), superseded_by: supersededBy })
    .eq('tenant_id', tenantId).eq('id', id)
  if (updErr) return { data: null, error: updErr.message }

  const { error: histErr } = await service.from('document_history').insert({
    tenant_id: tenantId, issued_document_id: id, action_type: 'cancelled', action_by: userId, reason: reason.trim(),
  })
  if (histErr) return { data: null, error: `履歴の記録に失敗しました: ${histErr.message}` }
  return { data: doc as Row, error: null }
}

// ── 公開 Server Actions ─────────────────────────────────────────

export async function issueInvoiceDocument(clientId: string, yearMonth: string): Promise<ActionResult<IssuedDocumentSummary>> {
  const auth = await requireOwner()
  if (auth.error) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const service = createServiceClient()

  // 確定済み（issued/paid）の請求書だけ発行できる
  const { data: inv, error: invErr } = await service
    .from('invoices').select('id, status')
    .eq('tenant_id', tenantId).eq('client_id', clientId).eq('invoice_month', `${yearMonth}-01`).is('department_id', null)
    .maybeSingle()
  if (invErr) return { data: null, error: invErr.message }
  if (!inv || (inv.status !== 'issued' && inv.status !== 'paid')) {
    return { data: null, error: '請求書が未確定です。「確定・ロック」で確定してから発行してください。' }
  }
  const { data: client, error: clErr } = await service
    .from('clients').select('document_format_key').eq('tenant_id', tenantId).eq('id', clientId).maybeSingle()
  if (clErr) return { data: null, error: clErr.message }

  const pdf = await fetchInvoicePdfData(clientId, yearMonth)
  if (pdf.error) return { data: null, error: pdf.error }

  return issueDocument(service, tenantId, {
    kind: 'invoice', sourceId: inv.id, contractorId: null,
    partyName: pdf.data.clientName, totalAmount: pdf.data.totalAmount, snapshot: pdf.data,
    clientFormatKey: client?.document_format_key ?? null, clientCode: null, userId: auth.ctx.userId,
  })
}

export async function issuePaymentNoticeDocument(contractorId: string, yearMonth: string): Promise<ActionResult<IssuedDocumentSummary>> {
  const auth = await requireOwner()
  if (auth.error) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const service = createServiceClient()

  // 承認済みまたはロック済みの支払通知書だけ発行できる（仕入明細書の相手方確認と整合）
  const { data: pn, error: pnErr } = await service
    .from('payment_notices').select('id, approval_status, locked')
    .eq('tenant_id', tenantId).eq('contractor_id', contractorId).eq('notice_month', `${yearMonth}-01`)
    .maybeSingle()
  if (pnErr) return { data: null, error: pnErr.message }
  if (!pn || !(pn.approval_status === 'approved' || pn.locked === true)) {
    return { data: null, error: '支払通知書が未承認です。承認（またはロック）後に発行してください。' }
  }

  const pdf = await fetchPaymentNoticePdfData(contractorId, yearMonth)
  if (pdf.error) return { data: null, error: pdf.error }

  return issueDocument(service, tenantId, {
    kind: 'payment_notice', sourceId: pn.id, contractorId,
    partyName: pdf.data.contractorName, totalAmount: pdf.data.totalAmount, snapshot: pdf.data,
    clientFormatKey: null, clientCode: null, userId: auth.ctx.userId,
  })
}

export async function cancelIssuedDocument(id: string, reason: string): Promise<ActionResult<void>> {
  const auth = await requireOwner()
  if (auth.error) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const res = await cancelInternal(createServiceClient(), tenantId, id, reason, auth.ctx.userId, null)
  return res.error ? { data: null, error: res.error } : { data: undefined, error: null }
}

export async function reissueDocument(id: string, reason: string): Promise<ActionResult<IssuedDocumentSummary>> {
  const auth = await requireOwner()
  if (auth.error) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const service = createServiceClient()

  const { data: old, error } = await service
    .from('issued_documents').select(`${SUMMARY_COLUMNS}, contractor_id, snapshot`)
    .eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!old) return { data: null, error: '控えが見つかりません' }
  if (old.status === 'cancelled') return { data: null, error: '取消済みの控えは再発行できません。元の請求書から発行してください。' }

  // 再発行は「現在のデータ」で取り直す（訂正後の内容を反映するため）。
  // 元データの特定: invoice は client_id+invoice_month、payment_notice は contractor_id+notice_month
  let fresh: ActionResult<{ partyName: string; totalAmount: number; snapshot: unknown; clientFormatKey: string | null }>
  if (old.kind === 'invoice') {
    const { data: inv } = await service.from('invoices').select('client_id, invoice_month').eq('tenant_id', tenantId).eq('id', old.source_id).maybeSingle()
    if (!inv) return { data: null, error: '元の請求書が見つかりません' }
    const ym = String(inv.invoice_month).slice(0, 7)
    const pdf = await fetchInvoicePdfData(inv.client_id, ym)
    if (pdf.error) return { data: null, error: pdf.error }
    const { data: client } = await service.from('clients').select('document_format_key').eq('tenant_id', tenantId).eq('id', inv.client_id).maybeSingle()
    fresh = { data: { partyName: pdf.data.clientName, totalAmount: pdf.data.totalAmount, snapshot: pdf.data, clientFormatKey: client?.document_format_key ?? null }, error: null }
  } else {
    const { data: pn } = await service.from('payment_notices').select('contractor_id, notice_month').eq('tenant_id', tenantId).eq('id', old.source_id).maybeSingle()
    if (!pn) return { data: null, error: '元の支払通知書が見つかりません' }
    const ym = String(pn.notice_month).slice(0, 7)
    const pdf = await fetchPaymentNoticePdfData(pn.contractor_id, ym)
    if (pdf.error) return { data: null, error: pdf.error }
    fresh = { data: { partyName: pdf.data.contractorName, totalAmount: pdf.data.totalAmount, snapshot: pdf.data, clientFormatKey: null }, error: null }
  }

  // 先に取消（superseded_by は新IDが要るので、取消→発行→取消行に後継IDを書けない）。
  // ⚠️ guard トリガは取消済み行の再 UPDATE を拒否するため、順序は「発行→取消（superseded_by 付き）」。
  //    部分ユニーク索引 (tenant, kind, source_id) WHERE status='issued' に当たるので、
  //    先に取消してから発行し、後継IDは document_history.reason に残す方式にする。
  const cancelled = await cancelInternal(service, tenantId, id, reason, auth.ctx.userId, null)
  if (cancelled.error) return { data: null, error: cancelled.error }

  const issued = await issueDocument(service, tenantId, {
    kind: old.kind, sourceId: old.source_id, contractorId: old.contractor_id ?? null,
    partyName: fresh.data!.partyName, totalAmount: fresh.data!.totalAmount, snapshot: fresh.data!.snapshot,
    clientFormatKey: fresh.data!.clientFormatKey, clientCode: null, userId: auth.ctx.userId,
    supersedes: { id, reason: `旧番号 ${old.document_number} の再発行: ${reason.trim()}` },
  })
  return issued
}

export async function listIssuedDocuments(filter: IssuedDocumentFilter): Promise<ActionResult<IssuedDocumentSummary[]>> {
  const auth = await requireOwner()
  if (auth.error) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const f = normalizeFilter(filter)
  let q = createServiceClient().from('issued_documents').select(SUMMARY_COLUMNS).eq('tenant_id', tenantId)
  if (f.kind) q = q.eq('kind', f.kind)
  if (f.dateFrom) q = q.gte('document_date', f.dateFrom)
  if (f.dateTo) q = q.lte('document_date', f.dateTo)
  if (f.party) q = q.ilike('party_name', `%${f.party}%`)
  if (f.minAmount !== null) q = q.gte('total_amount', f.minAmount)
  if (f.maxAmount !== null) q = q.lte('total_amount', f.maxAmount)
  if (!f.includeCancelled) q = q.eq('status', 'issued')
  const { data, error } = await q.order('issued_at', { ascending: false }).limit(200)
  if (error) return { data: null, error: error.message }
  return { data: (data as Row[]).map(toSummary), error: null }
}

export async function getIssuedDocument(id: string): Promise<ActionResult<IssuedDocumentDetail>> {
  const auth = await requireAuth()
  if (auth.error) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const { data, error } = await createServiceClient()
    .from('issued_documents').select(`${SUMMARY_COLUMNS}, contractor_id, snapshot`)
    .eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: '控えが見つかりません' }
  // ドライバーは自分宛ての支払通知書の控えだけ
  if (!auth.ctx.isOwner) {
    if (data.kind !== 'payment_notice' || !auth.ctx.contractorId || data.contractor_id !== auth.ctx.contractorId) {
      return { data: null, error: '権限がありません' }
    }
  }
  return { data: { ...toSummary(data as Row), snapshot: data.snapshot }, error: null }
}

export async function getActiveIssuedDocumentForSource(kind: DocumentKind, sourceId: string): Promise<ActionResult<IssuedDocumentSummary | null>> {
  const auth = await requireOwner()
  if (auth.error) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const { data, error } = await createServiceClient()
    .from('issued_documents').select(SUMMARY_COLUMNS)
    .eq('tenant_id', tenantId).eq('kind', kind).eq('source_id', sourceId).eq('status', 'issued').maybeSingle()
  if (error) return { data: null, error: error.message }
  return { data: data ? toSummary(data as Row) : null, error: null }
}
```

実装時の注意: `requireOwner()` / `requireAuth()` の戻り型（`AuthResult`：`ctx.userId`, `ctx.isOwner`, `ctx.contractorId` の実名）は `web/src/utils/auth.ts:14-40` を読んで合わせる。`issueDocument` 内の `if (input.supersedes) {}` 空ブロックは削除し、コメントだけ残す。

- [ ] **Step 6: `pdf-actions.ts` の番号決定を控え優先にする**

`fetchInvoicePdfData` の `invoiceNumber` 生成箇所（`pdf-actions.ts:125-126` 付近）を次に差し替える:

```ts
  // 発行控えがあればその番号、無ければ従来の暫定番号（未発行の目印として「(未発行)」を付ける）
  let invoiceNumber = `INV-${yearMonth.replace('-', '')}-${(existingInvoice?.id ?? 'XXXXX').slice(0, 5)} (未発行)`
  if (existingInvoice?.id) {
    const { data: doc } = await service
      .from('issued_documents').select('document_number')
      .eq('tenant_id', tenantId).eq('kind', 'invoice').eq('source_id', existingInvoice.id).eq('status', 'issued')
      .maybeSingle()
    if (doc?.document_number) invoiceNumber = doc.document_number
  }
```
（変数名 `existingInvoice` は実コードの名前に合わせる。発行後に再取得すると番号が入る。）

- [ ] **Step 7: 型チェック・番人テスト・全テスト**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS（`use-server-exports.test.ts` / `phantom-columns.test.ts` を含む）

- [ ] **Step 8: Commit**

```bash
git add web/src/app/_actions/document-actions.ts web/src/utils/document-search.ts web/src/utils/document-search.test.ts web/src/app/_actions/pdf-actions.ts
git commit -m "feat(actions): 帳票の確定発行・取消・再発行・控え検索（issued_documents）"
```

---

### Task 5: 会社設定 UI（採番書式・標準様式）

**Files:**
- Modify: `web/src/app/admin/settings/company/actions.ts`（`CompanyFormValues` に `invoice_number_format`, `document_format_key` を追加、取得・保存、書式検証）
- Modify: `web/src/app/admin/settings/company/page.tsx`（入力欄2つ）

**Interfaces:**
- Consumes: `validateDocumentNumberFormat`, `DEFAULT_INVOICE_NUMBER_FORMAT`（Task 2）、`listDocumentFormatOptions('invoice')`（Task 3）

- [ ] **Step 1: actions.ts** — `CompanyFormValues` に `invoice_number_format: string` と `document_format_key: string` を追加。`EMPTY` に `invoice_number_format: DEFAULT_INVOICE_NUMBER_FORMAT, document_format_key: 'standard'`。取得時は列をそのまま文字列化。保存時:

```ts
  const numberFormat = values.invoice_number_format.trim() || DEFAULT_INVOICE_NUMBER_FORMAT
  const fmtErr = validateDocumentNumberFormat(numberFormat)
  if (fmtErr) return { data: null, error: `採番書式: ${fmtErr}` }
  const formatKey = listDocumentFormatOptions('invoice').some(o => o.key === values.document_format_key)
    ? values.document_format_key : 'standard'
```
payload に `invoice_number_format: numberFormat, document_format_key: formatKey` を追加。

- [ ] **Step 2: page.tsx** — 既存の `payment_notice_response_days` 入力の直後に、同じ見た目で「請求書番号の書式」テキスト入力（プレースホルダ `INV-{YYYY}{MM}-{SEQ:4}`、補足文「使えるトークン: {YYYY} {YY} {MM} {DD} {FY} {CLIENT} {SEQ:n}。連番は {FY}/{YYYY}/{MM} の組合せごとにリセット」）と「標準様式」の `<select>`（`listDocumentFormatOptions('invoice')` を client component 側で import して map）を追加。

- [ ] **Step 3: 確認** — Run: `cd web && npx tsc --noEmit && npx vitest run src/utils/use-server-exports.test.ts` → PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/app/admin/settings/company/actions.ts web/src/app/admin/settings/company/page.tsx
git commit -m "feat(settings): 自社情報に請求書番号の採番書式と標準様式を追加"
```

---

### Task 6: 発行ボタン（請求書・支払通知書モーダル）

**Files:**
- Modify: `web/src/components/pdf/InvoicePdfModal.tsx`
- Modify: `web/src/components/pdf/PaymentNoticePdfModal.tsx`
- Modify: `web/src/components/pdf/PrintModal.tsx`（操作バーに任意の追加ボタン領域 `actions?: React.ReactNode` を追加。`.no-print` 内）

**Interfaces:**
- Consumes: `issueInvoiceDocument`, `issuePaymentNoticeDocument`, `getActiveIssuedDocumentForSource`（Task 4）
- Produces: `PrintModal` の新 prop `actions?: React.ReactNode`

- [ ] **Step 1: PrintModal に `actions` prop** — 印刷ボタンの左に `{actions}` を描画する。

- [ ] **Step 2: InvoicePdfModal** — `canIssue?: boolean` prop（既定 true。ドライバー画面からは渡さない）。state `issuing`, `issued: IssuedDocumentSummary | null`, `msg`。`actions` に:

```tsx
canIssue && (
  <button
    type="button"
    disabled={!data || issuing || !!issued}
    onClick={async () => {
      if (!confirm('この内容で請求書を確定発行し、番号を採番して控えを保存します。よろしいですか？')) return
      setIssuing(true)
      const res = await issueInvoiceDocument(clientId, yearMonth)
      setIssuing(false)
      if (res.error) { setMsg(res.error); return }
      setIssued(res.data)
      const re = await fetchInvoicePdfData(clientId, yearMonth)   // 番号を反映
      if (!re.error) setData(re.data)
    }}
    className="px-3 py-1.5 text-sm rounded border border-zinc-300 bg-white hover:bg-zinc-50 disabled:opacity-50"
  >
    {issued ? `発行済 ${issued.documentNumber}` : issuing ? '発行中...' : '確定発行（控え保存）'}
  </button>
)
```
`msg` はモーダル上部に赤字で表示。初回ロード後、`data` に含まれる番号が「(未発行)」で終わらなければ `issued` 相当の表示にする（簡易判定で可）。

- [ ] **Step 3: PaymentNoticePdfModal** — 同様に `issuePaymentNoticeDocument(contractorId, yearMonth)`。`canIssue` は `admin/billing` 側からのみ true を渡す。`driver/billing/page.tsx` の呼び出しには渡さない（既定を false にするか、明示 false）。**既定は false**（ドライバー側の安全側）。InvoicePdfModal も既定 false にし、`admin/sales/page.tsx` で `canIssue` を渡す。

- [ ] **Step 4: 呼び出し元** — `admin/sales/page.tsx:1168` 付近の `<InvoicePdfModal ... />` に `canIssue`、`admin/billing` 内の `<PaymentNoticePdfModal ... />` に `canIssue` を追加（grep で特定）。

- [ ] **Step 5: 確認** — Run: `cd web && npx tsc --noEmit && npm run build 2>&1 | tail -5` → エラーなし

- [ ] **Step 6: Commit**

```bash
git add web/src/components/pdf/PrintModal.tsx web/src/components/pdf/InvoicePdfModal.tsx web/src/components/pdf/PaymentNoticePdfModal.tsx web/src/app/admin/sales/page.tsx web/src/app/admin/billing/page.tsx
git commit -m "feat(pdf): 請求書・支払通知書モーダルに確定発行ボタン（採番・控え保存）"
```

---

### Task 7: 発行控え一覧画面（検索・取消・再発行・再表示）

**Files:**
- Create: `web/src/app/admin/documents/page.tsx`（client component、owner 用）
- Create: `web/src/components/pdf/IssuedDocumentModal.tsx`（snapshot を様式キー・版で描画）
- Modify: `web/src/app/admin/nav.tsx`（`'/admin/sales'` の直後に `{ href: '/admin/documents', label: '発行控え', icon: <書類アイコン svg> }`）

**Interfaces:**
- Consumes: `listIssuedDocuments`, `cancelIssuedDocument`, `reissueDocument`, `getIssuedDocument`（Task 4）、`InvoiceDocument` / `PaymentNoticeDocument`、`PrintModal`
- Produces: `IssuedDocumentModal({ id, onClose })`

- [ ] **Step 1: IssuedDocumentModal** — `getIssuedDocument(id)` を取得し、`formatKey`/`formatVersion` で描画コンポーネントを選ぶ:

```tsx
function renderSnapshot(d: IssuedDocumentDetail) {
  // ⚠️ 様式が増えたら format_key × format_version で分岐を足す（旧版の描画を消さない）
  if (d.formatKey === 'standard' && d.formatVersion === 1) {
    return d.kind === 'invoice'
      ? <InvoiceDocument data={d.snapshot as InvoicePdfData} />
      : <PaymentNoticeDocument data={d.snapshot as PaymentNoticePdfData} />
  }
  return <div className="a4-page w-[794px] bg-white p-12 text-red-600 text-sm">未対応の様式です: {d.formatKey} v{d.formatVersion}</div>
}
```
取消済みは版面上に「取消済（理由）」の帯を `print:` でも出す（再印刷時の誤用防止）。

- [ ] **Step 2: page.tsx** — 検索フォーム（種別 select、発行日 from/to、相手先、金額 min/max、取消も表示 checkbox）→ `listIssuedDocuments`。表: 番号・種別・相手先・発行日・金額・状態・操作（表示 / 取消 / 再発行）。取消・再発行は `prompt('理由')` で理由必須。表示は `IssuedDocumentModal`。既存 `admin/sales/page.tsx` のテーブル・`SummaryCard` の見た目に倣う。色は Tailwind の中立色のみ（カテゴリ色は nav の `CATEGORY_STYLES` 経由）。

- [ ] **Step 3: nav.tsx** — 上記項目を追加。

- [ ] **Step 4: 確認** — Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add web/src/app/admin/documents/page.tsx web/src/components/pdf/IssuedDocumentModal.tsx web/src/app/admin/nav.tsx
git commit -m "feat(admin): 発行控え一覧（日付・相手先・金額で検索、取消・再発行、当時の様式で再表示）"
```

---

### Task 8: ドキュメント更新と適用手順

**Files:**
- Modify: `docs/HANDOVER_MASTER.md`（§5-4 に 2026-08-23 の項、§5-5 ファイルマップに新規ファイル、§2-5 に3テーブル）
- Modify: `docs/superpowers/plans/2026-08-23-client-format-documents-handover.md`（ステータス更新、「土台①実装済み・DB未適用」、適用手順）

- [ ] **Step 1: 適用手順を handover に書く**

```
## 本番適用手順（ボス作業・1コマンドずつ）
1. Supabase ダッシュボード > SQL Editor で `supabase/migrations/20260823150000_document_issuance_foundation.sql` を全文実行
2. `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260823150000','document_issuance_foundation');`
3. 設定 > 自社情報 で採番書式を確認（既定 INV-{YYYY}{MM}-{SEQ:4}）
4. 売上・請求管理 → 請求書PDF → 「確定発行」を1件試す → 発行控え一覧で検索・表示
5. 問題なければ `git push` → デプロイ
```

- [ ] **Step 2: Commit**

```bash
git add docs/HANDOVER_MASTER.md docs/superpowers/plans/2026-08-23-client-format-documents-handover.md
git commit -m "docs: 帳票発行の土台（採番・控え・取消再発行）を記録、本番適用手順を追記"
```

---

## Self-Review

- 要件 §4 電帳法（控え保存・日付/相手先/金額で検索）→ Task 1, 4, 7。§5 確定/再発行・採番規則・様式の版管理・権限 → Task 1, 2, 4, 6, 7。§5 端数処理・締め日・送付方法は計画③④へ（本計画スコープ外と Global Constraints に明記）。§6 印影の Storage 隔離は計画③（本計画で Storage を触らない）。
- 型の整合: `IssuedDocumentSummary`/`Detail`/`Filter` は `document-search.ts` に一元定義し、actions/UI から import。`DocumentKind` は `document-formats.ts`。
- 未検証事項: ~~DB 未適用のため画面動作は未検証~~ → 2026-08-23 夜にローカル Supabase で画面検証済み（`docs/HANDOVER_MASTER.md` §5-4 2026-08-23 の 6）。tsc / vitest / build を各タスクで通す。
