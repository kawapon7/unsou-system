# 指示書：小バグ2件の修正（locked_at 未セット ／ parseVoiceIntent 認証ゼロ）

> 実装担当：Cursor（Sonnet 4.6）
> この指示書は単体で完結している。前置き・要約は不要、指示通りに実装すること。
> 2件は互いに独立。どちらも単一ファイルの小修正。テナント分離移行とは無関係に先行実施してよい。

---

## 修正1：支払通知書の `locked_at` が承認時に未セット（バグ修正）

### 背景
子分が支払通知書を承認すると `status='locked'` / `approval_status='approved'` / `locked=true` は立つが、
**「いつロックしたか」の `locked_at`（TIMESTAMPTZ, 既存カラム）が記録されない**。監査・表示の欠落。

### 対象
`web/src/app/_actions/driver-actions.ts` の `approvePaymentNotice` 内、承認確定の UPDATE（現在 156 行目付近）。

### 現在のコード
```ts
  const { error: updateErr } = await db
    .from('payment_notices')
    .update({ status: 'locked', approval_status: 'approved', locked: true })
    .eq('id', noticeId)
    .eq('contractor_id', contractorId)
```

### 修正後（`locked_at` を追加するだけ）
```ts
  const { error: updateErr } = await db
    .from('payment_notices')
    .update({
      status:          'locked',
      approval_status: 'approved',
      locked:          true,
      locked_at:       new Date().toISOString(),  // 承認確定時刻を記録（監査用）
    })
    .eq('id', noticeId)
    .eq('contractor_id', contractorId)
```

### 厳守事項
- 追加するのは `locked_at` の1キーのみ。他の列・条件・ロジックは変更しない。
- `locked_at` カラムは `payment_notices` に既存（`20260605000000` / `20260614000001`）。マイグレーション追加は不要。
- 値は ISO 文字列（`new Date().toISOString()`）。DB型は TIMESTAMPTZ。

---

## 修正2：`parseVoiceIntent` が認証ゼロ（コスト/悪用ホール）

### 背景
`web/src/app/_actions/voice-actions.ts` の `parseVoiceIntent` は **認証チェックが一切無い**。
未ログインでも呼び出せ、その都度 Gemini API（有料）を消費できる。いたずら連打で課金が膨らむ穴。
最低限「ログイン必須」にして塞ぐ（role は不問＝admin/driver 共用のまま）。

### 対象
`web/src/app/_actions/voice-actions.ts` の `parseVoiceIntent`（現在 104 行目付近）。

### 手順

**(1) import に `requireAuth` を追加**（先頭の import 群、`@/utils/auth` から）
```ts
import { requireAuth } from '@/utils/auth'
```
※ `requireAuth` は既存（`web/src/utils/auth.ts`）。ログイン必須・role不問のガード。

**(2) 関数の冒頭にガードを追加**
`parseVoiceIntent` の戻り値型は `VoiceIntentResult`（`ActionResult` ではない）ので、
未認証時は `intent: 'unknown'` の `VoiceIntentResult` を返すこと。

```ts
export async function parseVoiceIntent(
  transcript: string,
): Promise<VoiceIntentResult> {
  // 認証必須（未ログインからの Gemini API 消費を防止）
  const auth = await requireAuth()
  if (!auth.ok) {
    return { intent: 'unknown', replyMessage: '音声機能の利用にはログインが必要です。' }
  }

  const apiKey = process.env.GEMINI_API_KEY
  // …以降は既存のまま…
```

### 厳守事項
- ガードは**関数の最初**（`apiKey` 読み込みより前）に置く。
- 戻り値は必ず `VoiceIntentResult` 型に合わせる（`intent` 必須）。`null` や `ActionResult` 形を返さない。
- `saveVoiceExpense`（同ファイル）は既に `getUser()` で認証済みのため**今回は変更しない**（テナント移行フェーズで `requireAuth` へ統一予定）。
- role での出し分け（owner限定など）は**しない**。ログイン必須までに留める。

---

## 完了条件（Done）

- [ ] `driver-actions.ts` の承認 UPDATE に `locked_at` が追加されている。
- [ ] `voice-actions.ts` の `parseVoiceIntent` 冒頭に `requireAuth()` ガードがあり、未認証時に `VoiceIntentResult`（intent='unknown'）を返す。
- [ ] `requireAuth` の import が追加されている。
- [ ] 型チェック（`npm run typecheck` 等プロジェクト標準）が通る。
- [ ] 上記2ファイル以外への変更が無い（`git status` で確認）。自動生成物（`.next/` 等）・`.env*` を巻き込まない。
