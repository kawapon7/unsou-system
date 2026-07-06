# 口座情報暗号化 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `clients`/`contractors` テーブルの銀行口座情報（`bank_name`, `bank_branch`, `account_number`, `account_holder`）を、書き込み時に必ず AES-256-GCM で暗号化し、読み取り時に必ず復号する。既存の本番データ（平文）もバックフィルで暗号化する。

**Architecture:** `web/src/utils/crypto.ts` に既にある `encryptText`/`decryptText`（AES-256-GCM, ランダムIV, `iv:tag:cipher` hex形式）をラップした汎用ヘルパー `encryptBankFields`/`decryptBankFields`/`decryptBankFieldValue` を追加し、書き込み経路（`web/src/app/admin/partners/actions.ts`）と読み取り経路（同ファイル + `pdfActions.ts`）の両方から呼び出す。暗号化済みかどうかは `iv:tag:cipher` の hex パターンで判定するため、暗号化ヘルパーは冪等（二重暗号化しない）、復号ヘルパーは後方互換（未暗号化の値もそのまま通す）。既存の本番平文データは、この変更をデプロイした後に一度だけ実行するバックフィルスクリプトで暗号化する。

**Tech Stack:** Next.js Server Actions, Supabase (service-role client), Node.js `crypto` (AES-256-GCM), Vitest（新規導入・ユニットテストのみ）

## Global Constraints

- 対象フィールドは `bank_name`, `bank_branch`, `account_number`, `account_holder` の4つのみ（`account_type` は「普通/当座」等の非機微情報のため対象外、`branch_name` は未使用のレガシーエイリアス列で対象外）。
- 対象テーブルは `clients` と `contractors` の2つ。
- `ENCRYPTION_KEY` 環境変数は32文字（32バイト）必須。既存の `encryptText`/`decryptText` の制約をそのまま踏襲する。
- 既存の暗号化ヘルパー（`encryptText`/`decryptText`）のシグネチャ・アルゴリズム・フォーマットは変更しない。
- 本番データへのバックフィル実行は破壊的操作に準じるため、必ずユーザーの明示的な承認を得てから実行する。

---

### Task 1: Vitest セットアップ（ユニットテスト基盤）

**Files:**
- Create: `web/vitest.config.ts`
- Modify: `web/package.json:5-10`（`scripts`に`test`を追加）

**Interfaces:**
- Produces: `vitest run` コマンドで `web/src/**/*.test.ts` を実行できる状態。テスト内で `@/utils/crypto` のような `@/*` パスエイリアスが解決できる。

- [ ] **Step 1: vitest を devDependency として追加**

```bash
cd /Users/kawasakiatsushi/developer/unsou-system/web && npm install -D vitest
```

- [ ] **Step 2: vitest.config.ts を作成**

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    env: {
      // テスト専用のダミーキー（32バイト）。本番のENCRYPTION_KEYとは無関係。
      ENCRYPTION_KEY: '01234567890123456789012345678901',
    },
  },
})
```

- [ ] **Step 3: package.json の scripts に test を追加**

`web/package.json` の `"scripts"` ブロックに以下を追記する（既存の `"lint": "eslint",` の直後）:

```json
    "lint": "eslint",
    "test": "vitest run",
```

- [ ] **Step 4: 動作確認用の仮テストを作成して実行**

`web/src/utils/__vitest_setup_check.test.ts` を一時作成:

```ts
import { describe, it, expect } from 'vitest'

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `cd web && npm test`
Expected: `1 passed`

- [ ] **Step 5: 仮テストを削除してコミット**

```bash
rm /Users/kawasakiatsushi/developer/unsou-system/web/src/utils/__vitest_setup_check.test.ts
cd /Users/kawasakiatsushi/developer/unsou-system
git add web/package.json web/package-lock.json web/vitest.config.ts
git commit -m "test: vitestのユニットテスト基盤を追加"
```

---

### Task 2: 口座情報フィールド暗号化/復号ヘルパーを追加（TDD）

**Files:**
- Modify: `web/src/utils/crypto.ts`
- Test: `web/src/utils/crypto.test.ts`

**Interfaces:**
- Consumes: 既存の `encryptText(text: string): string`, `decryptText(encryptedData: string): string`（`web/src/utils/crypto.ts:8,20`）
- Produces:
  - `isEncryptedValue(value: string): boolean`
  - `decryptBankFieldValue(value: string | null | undefined): string`
  - `encryptBankFields<T extends Record<string, unknown>>(payload: T): T`
  - `decryptBankFields<T extends Record<string, unknown>>(row: T): T`
  - これらは Task 3（`partners/actions.ts`）と Task 4（`pdfActions.ts`）で使用する。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/utils/crypto.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest'
import {
  encryptText,
  decryptText,
  isEncryptedValue,
  decryptBankFieldValue,
  encryptBankFields,
  decryptBankFields,
} from './crypto'

describe('encryptText / decryptText round trip', () => {
  it('decrypts back to the original plaintext', () => {
    const original = 'みずほ銀行 渋谷支店 1234567 タナカ タロウ'
    const encrypted = encryptText(original)
    expect(encrypted).not.toBe(original)
    expect(decryptText(encrypted)).toBe(original)
  })

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptText('1234567')
    const b = encryptText('1234567')
    expect(a).not.toBe(b)
  })
})

describe('isEncryptedValue', () => {
  it('recognizes the iv:tag:cipher hex format', () => {
    expect(isEncryptedValue(encryptText('1234567'))).toBe(true)
  })

  it('rejects plain bank account values', () => {
    expect(isEncryptedValue('1234567')).toBe(false)
    expect(isEncryptedValue('みずほ銀行')).toBe(false)
  })
})

describe('decryptBankFieldValue', () => {
  it('decrypts an encrypted value', () => {
    expect(decryptBankFieldValue(encryptText('1234567'))).toBe('1234567')
  })

  it('passes through a legacy plaintext value unchanged', () => {
    expect(decryptBankFieldValue('1234567')).toBe('1234567')
  })

  it('returns empty string for null/undefined', () => {
    expect(decryptBankFieldValue(null)).toBe('')
    expect(decryptBankFieldValue(undefined)).toBe('')
  })
})

describe('encryptBankFields', () => {
  it('encrypts only the four bank fields, leaves others untouched', () => {
    const payload = {
      name: 'テスト商事',
      bank_name: 'みずほ銀行',
      bank_branch: '渋谷支店',
      account_type: '普通',
      account_number: '1234567',
      account_holder: 'テストショウジ',
    }
    const result = encryptBankFields(payload)
    expect(result.name).toBe('テスト商事')
    expect(result.account_type).toBe('普通')
    expect(isEncryptedValue(result.bank_name)).toBe(true)
    expect(isEncryptedValue(result.bank_branch)).toBe(true)
    expect(isEncryptedValue(result.account_number)).toBe(true)
    expect(isEncryptedValue(result.account_holder)).toBe(true)
  })

  it('leaves null/empty bank fields as-is', () => {
    const result = encryptBankFields({ bank_name: null, account_number: '' })
    expect(result.bank_name).toBe(null)
    expect(result.account_number).toBe('')
  })

  it('does not double-encrypt an already-encrypted value', () => {
    const already = encryptText('1234567')
    const result = encryptBankFields({ account_number: already })
    expect(result.account_number).toBe(already)
  })
})

describe('decryptBankFields', () => {
  it('decrypts the four bank fields back to plaintext', () => {
    const encrypted = encryptBankFields({
      bank_name: 'みずほ銀行',
      bank_branch: '渋谷支店',
      account_number: '1234567',
      account_holder: 'テストショウジ',
    })
    const result = decryptBankFields(encrypted)
    expect(result.bank_name).toBe('みずほ銀行')
    expect(result.bank_branch).toBe('渋谷支店')
    expect(result.account_number).toBe('1234567')
    expect(result.account_holder).toBe('テストショウジ')
  })

  it('passes through legacy plaintext values unchanged', () => {
    const result = decryptBankFields({ account_number: '1234567' })
    expect(result.account_number).toBe('1234567')
  })
})
```

- [ ] **Step 2: テストを実行し、失敗を確認**

Run: `cd web && npm test -- crypto.test.ts`
Expected: FAIL — `isEncryptedValue`, `decryptBankFieldValue`, `encryptBankFields`, `decryptBankFields` は未定義。

- [ ] **Step 3: crypto.ts にヘルパーを実装**

`web/src/utils/crypto.ts` の末尾（現在35行目、`decryptText`関数の後）に追記:

```ts

const BANK_FIELD_KEYS = ['bank_name', 'bank_branch', 'account_number', 'account_holder'] as const;
const ENCRYPTED_FORMAT = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

export function isEncryptedValue(value: string): boolean {
  return ENCRYPTED_FORMAT.test(value);
}

export function decryptBankFieldValue(value: string | null | undefined): string {
  if (!value) return '';
  if (!isEncryptedValue(value)) return value;
  try {
    return decryptText(value);
  } catch {
    return '（復号エラー）';
  }
}

export function encryptBankFields<T extends Record<string, unknown>>(payload: T): T {
  const result: Record<string, unknown> = { ...payload };
  for (const key of BANK_FIELD_KEYS) {
    const value = result[key];
    if (typeof value === 'string' && value.length > 0 && !isEncryptedValue(value)) {
      result[key] = encryptText(value);
    }
  }
  return result as T;
}

export function decryptBankFields<T extends Record<string, unknown>>(row: T): T {
  const result: Record<string, unknown> = { ...row };
  for (const key of BANK_FIELD_KEYS) {
    const value = result[key];
    if (typeof value === 'string') {
      result[key] = decryptBankFieldValue(value);
    }
  }
  return result as T;
}
```

- [ ] **Step 4: テストを実行し、全て成功することを確認**

Run: `cd web && npm test -- crypto.test.ts`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
cd /Users/kawasakiatsushi/developer/unsou-system
git add web/src/utils/crypto.ts web/src/utils/crypto.test.ts
git commit -m "feat: 口座情報フィールドの暗号化/復号ヘルパーを追加"
```

---

### Task 3: partners/actions.ts の書き込み/読み取り経路に暗号化・復号を組み込む

**Files:**
- Modify: `web/src/app/admin/partners/actions.ts:1-161`

**Interfaces:**
- Consumes: Task 2 で作成した `encryptBankFields`, `decryptBankFields`（`@/utils/crypto`）
- Produces: `fetchClients`, `fetchContractors`, `createClient_`, `updateClient`, `createContractor`, `updateContractor` は既存のシグネチャのまま、DBへの書き込み前に暗号化・DBからの読み取り後に復号を行うようになる（呼び出し側 `page.tsx` の変更は不要）。

- [ ] **Step 1: import を追加**

`web/src/app/admin/partners/actions.ts:1-7` を以下に変更:

```ts
'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'
import { encryptBankFields, decryptBankFields } from '@/utils/crypto'
```

- [ ] **Step 2: fetchClients / fetchContractors の読み取り結果を復号**

`web/src/app/admin/partners/actions.ts:27-39`（`fetchClients`）を以下に変更:

```ts
export async function fetchClients(): Promise<ActionResult<ClientRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  if (error) return { data: null, error: error.message }
  return { data: (data ?? []).map(decryptBankFields), error: null }
}
```

`web/src/app/admin/partners/actions.ts:95-107`（`fetchContractors`）を以下に変更:

```ts
export async function fetchContractors(): Promise<ActionResult<ContractorRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('contractors')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  if (error) return { data: null, error: error.message }
  return { data: (data ?? []).map(decryptBankFields), error: null }
}
```

- [ ] **Step 3: createClient_ / updateClient / createContractor / updateContractor の書き込みを暗号化**

`web/src/app/admin/partners/actions.ts:41-53`（`createClient_`）を以下に変更:

```ts
export async function createClient_(payload: ClientInsert): Promise<ActionResult<ClientRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('clients')
    .insert({ ...encryptBankFields(payload), tenant_id: tenantId })
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data: decryptBankFields(data), error: null }
}
```

`web/src/app/admin/partners/actions.ts:77-91`（`updateClient`）を以下に変更:

```ts
export async function updateClient(id: string, payload: ClientUpdate): Promise<ActionResult<ClientRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('clients')
    .update(encryptBankFields(payload))
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data: decryptBankFields(data), error: null }
}
```

`web/src/app/admin/partners/actions.ts:109-121`（`createContractor`）を以下に変更:

```ts
export async function createContractor(payload: ContractorInsert): Promise<ActionResult<ContractorRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('contractors')
    .insert({ ...encryptBankFields(payload), tenant_id: tenantId })
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data: decryptBankFields(data), error: null }
}
```

`web/src/app/admin/partners/actions.ts:147-161`（`updateContractor`）を以下に変更:

```ts
export async function updateContractor(id: string, payload: ContractorUpdate): Promise<ActionResult<ContractorRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('contractors')
    .update(encryptBankFields(payload))
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data: decryptBankFields(data), error: null }
}
```

- [ ] **Step 4: 型チェックを実行**

Run: `cd web && npx tsc --noEmit`
Expected: エラーなし（`encryptBankFields`/`decryptBankFields` はジェネリックで `ClientInsert`/`ContractorRow` 等をそのまま受け取れる）

- [ ] **Step 5: コミット**

```bash
cd /Users/kawasakiatsushi/developer/unsou-system
git add web/src/app/admin/partners/actions.ts
git commit -m "fix: 取引先の口座情報を書き込み時に暗号化・読み取り時に復号する"
```

---

### Task 4: pdfActions.ts の重複した復号ロジックを共通ヘルパーに置き換える

**Files:**
- Modify: `web/src/app/_actions/pdfActions.ts:7`, `:106-114`, `:319-323`

**Interfaces:**
- Consumes: Task 2 の `decryptBankFieldValue`（`@/utils/crypto`）

- [ ] **Step 1: import を変更**

`web/src/app/_actions/pdfActions.ts:7` を以下に変更:

```ts
import { decryptBankFieldValue } from '@/utils/crypto'
```

- [ ] **Step 2: ローカルの decryptBankField 定義を削除し、呼び出し箇所を更新**

`web/src/app/_actions/pdfActions.ts:106-114` の以下のブロックを削除:

```ts
function decryptBankField(value: string | null | undefined): string {
  if (!value) return ''
  if (!value.includes(':')) return value
  try {
    return decryptText(value)
  } catch {
    return '（復号エラー）'
  }
}
```

`web/src/app/_actions/pdfActions.ts:319-323` の呼び出し箇所を `decryptBankField` → `decryptBankFieldValue` に置き換え:

```ts
      bankName:      decryptBankFieldValue(contractor.bank_name),
      bankBranch:    decryptBankFieldValue(contractor.bank_branch ?? contractor.branch_name),
      accountType:   decryptBankFieldValue(contractor.account_type),
      accountNumber: decryptBankFieldValue(contractor.account_number),
      accountHolder: decryptBankFieldValue(contractor.account_holder),
```

- [ ] **Step 3: 型チェックを実行**

Run: `cd web && npx tsc --noEmit`
Expected: エラーなし（`decryptText`は他で使われていなければ未使用importになるので、`web/src/app/_actions/pdfActions.ts`内で`decryptText`を他に使っていないか確認し、使っていなければimportから削除する）

- [ ] **Step 4: コミット**

```bash
cd /Users/kawasakiatsushi/developer/unsou-system
git add web/src/app/_actions/pdfActions.ts
git commit -m "refactor: pdfActionsの口座情報復号を共通ヘルパーに統一"
```

---

### Task 5: 本番の既存平文データをバックフィルするスクリプト

**Files:**
- Create: `web/scripts/backfill-encrypt-bank-fields.mjs`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` 環境変数（CLI実行時に指定）
- Produces: `clients`/`contractors` の4フィールドのうち、まだ暗号化されていない値を暗号化して`UPDATE`する。`--dry-run`フラグで実際の更新をせず対象件数のみ表示。

- [ ] **Step 1: スクリプトを作成**

`web/scripts/backfill-encrypt-bank-fields.mjs` を新規作成:

```js
/**
 * 口座情報バックフィル暗号化スクリプト
 *
 * ⚠️ SUPABASE_SERVICE_ROLE_KEY を使用するため取り扱い注意。RLSを完全バイパスする。
 * ⚠️ 本番の clients/contractors テーブルの bank_name/bank_branch/account_number/account_holder を
 *    直接書き換える。実行前に --dry-run で対象件数を確認すること。
 *
 * 暗号化フォーマットは web/src/utils/crypto.ts の encryptText と完全に一致させること
 * （AES-256-GCM, ランダムIV 12バイト, `iv:tag:cipher` のhex文字列）。
 *
 * 使い方:
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   ENCRYPTION_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
 *   node web/scripts/backfill-encrypt-bank-fields.mjs --dry-run
 *
 *   確認後、--dry-run を外して実行すると実際にUPDATEされる。
 */

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const encryptionKey = process.env.ENCRYPTION_KEY
const dryRun = process.argv.includes('--dry-run')

if (!url || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
if (!encryptionKey || encryptionKey.length !== 32) throw new Error('ENCRYPTION_KEY は32バイトで設定してください')

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const ENCRYPTED_FORMAT = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i
const BANK_FIELDS = ['bank_name', 'bank_branch', 'account_number', 'account_holder']

function encryptText(text) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(encryptionKey), iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

function isEncryptedValue(value) {
  return ENCRYPTED_FORMAT.test(value)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function backfillTable(table) {
  const { data: rows, error } = await supabase.from(table).select(`id, ${BANK_FIELDS.join(', ')}`)
  if (error) throw error

  let targetCount = 0
  let updatedCount = 0

  for (const row of rows ?? []) {
    const patch = {}
    for (const field of BANK_FIELDS) {
      const value = row[field]
      if (typeof value === 'string' && value.length > 0 && !isEncryptedValue(value)) {
        patch[field] = encryptText(value)
      }
    }
    if (Object.keys(patch).length === 0) continue
    targetCount += 1

    if (dryRun) {
      console.log(`[dry-run] ${table} id=${row.id}: ${Object.keys(patch).join(', ')} を暗号化予定`)
      continue
    }

    const { error: updateErr } = await supabase.from(table).update(patch).eq('id', row.id)
    if (updateErr) {
      console.error(`更新失敗 ${table} id=${row.id}:`, updateErr.message)
      continue
    }
    updatedCount += 1
  }

  console.log(`${table}: 対象 ${targetCount} 件中 ${dryRun ? 0 : updatedCount} 件を更新しました（dry-run=${dryRun}）`)
}

await backfillTable('clients')
await backfillTable('contractors')
```

- [ ] **Step 2: コミット**

```bash
cd /Users/kawasakiatsushi/developer/unsou-system
git add web/scripts/backfill-encrypt-bank-fields.mjs
git commit -m "chore: 口座情報バックフィル用の一時暗号化スクリプトを追加"
```

---

### Task 6: 本番デプロイ・バックフィル実行・検証（手動実行ランブック）

**このタスクはコード変更を含まない。ユーザーの承認を得てから本番環境に対して実行する。**

- [ ] **Step 1: Task 1〜5 の変更をデプロイする**

通常のデプロイフロー（Cloudflare Pages）でリリースする。この時点以降、新規作成・更新される口座情報は暗号化されて保存される。既存データはまだ平文のまま。

- [ ] **Step 2: バックフィルを dry-run で実行し、対象件数を確認**

```bash
NEXT_PUBLIC_SUPABASE_URL=<本番URL> \
SUPABASE_SERVICE_ROLE_KEY=<本番service role key> \
ENCRYPTION_KEY=<本番ENCRYPTION_KEY> \
node web/scripts/backfill-encrypt-bank-fields.mjs --dry-run
```

出力される対象件数をユーザーに提示し、実行の承認を得る。

- [ ] **Step 3: ユーザー承認後、実際にバックフィルを実行**

```bash
NEXT_PUBLIC_SUPABASE_URL=<本番URL> \
SUPABASE_SERVICE_ROLE_KEY=<本番service role key> \
ENCRYPTION_KEY=<本番ENCRYPTION_KEY> \
node web/scripts/backfill-encrypt-bank-fields.mjs
```

- [ ] **Step 4: 実アプリで検証**

`/admin/partners` 画面で既存の取引先・荷主を1件ずつ開き、口座情報が正しく（暗号化前と同じ値で）表示されることを確認する。支払通知書PDF（`pdfActions.ts`の`fetchPaymentNoticePdfData`経由）を1件生成し、口座情報が正しく印字されることを確認する。

- [ ] **Step 5: バックフィルスクリプトの後始末**

バックフィル完了・検証OKを確認したら、`web/scripts/backfill-encrypt-bank-fields.mjs` は一度きりの使い捨てスクリプトなのでリポジトリから削除してコミットする（`create-production-user.mjs`と同様、必要な操作ログはコミット履歴に残る）。

```bash
cd /Users/kawasakiatsushi/developer/unsou-system
git rm web/scripts/backfill-encrypt-bank-fields.mjs
git commit -m "chore: バックフィル完了につき一時スクリプトを削除"
```

---

## Self-Review Notes

- **Spec coverage:** 書き込み時暗号化（Task 3）、読み取り時復号（Task 3, 4）、既存データのバックフィル（Task 5, 6）を全てカバー。`account_type`/`branch_name`を対象外とした判断はGlobal Constraintsに明記。
- **Placeholder scan:** 全ステップに実コードあり。「TODO」「後で実装」等の記述なし。
- **Type consistency:** `encryptBankFields`/`decryptBankFields`/`decryptBankFieldValue`の名前・シグネチャはTask 2で定義した通りTask 3・4で一貫して使用。
