# HIBIKI 本番エラー監視 設計仕様

作成: 2026-09-02 / 状態: 承認済み（実装未着手）
経緯: Air セッションのブレスト（決定事項3点）を mini で引き継ぎ、最新コードで再調査して確定。

## 0. 目的と非目的

**目的**: 本番でエラーが起きたこと自体に、ドライバーや事務所からの連絡を待たずに気づける。
**非目的（今回やらない）**: 原因特定のための操作履歴・セッション再生、閲覧UI、外部SaaS連携。

### 決定済みの前提
1. 目的は「検知と通知」。原因特定は次段。
2. 通知は重大度で分岐。業務が止まる類は即時メール、他は日次まとめ。既存の防御アラート cron（毎日1回）への全乗せは「最大24時間気づけない」ため却下。
3. 自前で持つ。エラーは自分の Supabase に保存し Resend で通知。Sentry 等へ送らない（口座情報を AES-256-GCM で暗号化しクライアント直アクセスを禁じている設計に対し、外部SaaSは新たな持ち出し経路になる）。将来移せるよう記録層は interface で分離。

### 再調査結果（origin/main 894f568、2026-08-27）
| 項目 | 値 |
|---|---|
| `'use server'` ファイル | 26 |
| export された Server Action | 136（8,662行） |
| `catch` / `console.error` | 14 / 2 |
| `error.tsx` / `global-error.tsx` | なし |
| `wrangler.toml` の observability / tail | なし |

**設計を左右する発見**: Server Action はほぼ全て `ActionResult = {data, error: string}` で例外を投げずに戻り値で失敗を返す。UI 側の `res.error` 参照は141箇所。したがって例外捕捉だけでは「保存失敗」の大半を取りこぼす。**戻り値の `error` も検査する**（方式 A-2）。

## 1. 方式の決定

- **A-2: アプリ内で捕捉。例外 + 戻り値 `{error}` の両方を見る**（採用）
- A-1（例外のみ）: 保存失敗を取りこぼすため却下
- B（Cloudflare tail worker / Logpush）: 文脈が取れず、別 Worker とプラン確認が必要。今の困りごとは「精度」でなく「検知」なので見送り。記録層 interface を分けて後から足せる形にする
- C（A+B）: 初手では規模が倍。見送り

### 136本への適用方法: 本体ラップ（方式イ）
```ts
export async function listUsers(): Promise<ActionResult<ManagedUser[]>> {
  return captured('listUsers', async () => {
    // 既存本体そのまま
  })
}
```
- export は素の async 関数のまま → `'use server'` の「async 関数しか export 不可」制約と `utils/use-server-exports.test.ts` をそのまま満たす
- 高階関数 export（`export const x = captured(...)`）はバレ型再エクスポートと同じ危険領域のため不採用
- 各 `return` 直前に1行追加する方式は数百箇所で漏れやすいため不採用

## 2. 構成

```
捕捉  captured() / capturedRoute() / error.tsx / global-error.tsx
  ↓ ErrorEvent
整形  mask() → classify() → fingerprint()        純関数・vitest で固定
  ↓
記録  ErrorSink.record(event)                     interface。第1実装 SupabaseSink
  ↓                                                将来 SentrySink / CloudflareTail
通知  即時メール（critical）／日次まとめ（cron）
```

配置: `web/src/utils/error-monitor/`（`'use server'` を持たない通常モジュール）
```
utils/error-monitor/
  types.ts        ErrorEvent, ErrorSink, Severity, Source
  mask.ts         mask(text)
  classify.ts     isSystemError(errorMessage), severityFor(source, actionName)
  fingerprint.ts  fingerprint(source, actionName, message)
  sink.ts         ErrorSink interface + SupabaseSink（service_role で error_logs へ UPSERT）
  captured.ts     captured(), capturedRoute()
  critical-actions.ts  CRITICAL_ACTIONS 定数
  notify.ts       shouldNotifyImmediately(), 通知本文生成
```
通知メールの送信は `app/_actions/emailCore.ts` に管理者宛て `sendAdminAlertEmail()` を1本追加（既存 private `sendViaResend` を使う）。

## 3. 捕捉層

### `captured<T>(name, fn, ctx?)`
| 事象 | 動作 | 戻り値 |
|---|---|---|
| `fn` が例外を投げた | 記録（severity は `severityFor`） | `{ data: null, error: '処理に失敗しました' }` |
| `fn` が `{error}` を返し `isSystemError(error)` が真 | 記録 | **そのまま返す**（既存UI表示を変えない） |
| `fn` が `{error}` を返し業務メッセージ | 記録しない | そのまま返す |
| 正常 | なし | そのまま返す |

- **記録・通知の失敗は握りつぶす**。業務処理の結果を一切変えない（`try/catch` で囲み、失敗時は `console.error` のみ）
- 文脈（`tenantId`, `userId`, `contractorId`）は `ctx?: CaptureContext` を任意引数で受け取る。`captured` 内で `getAuthContext()` を呼び直さない（二重クエリ回避）。渡されなければ null。**第1段の6本は本体内で文脈を取っているため ctx を渡せず、文脈なしで記録する。第2段で改良**
- 例外時の UI 文言は固定「処理に失敗しました」。生メッセージは UI に出さない

### `isSystemError(message)`
以下のいずれかに一致でシステム由来: `/PGRST\d+/`, `/duplicate key/i`, `/violates .* constraint/i`, `/connection|ECONN|timeout|timed out/i`, `/fetch failed|Failed to fetch/i`, `/permission denied/i`, `/(relation|column) .* does not exist/i`, `/JWT|invalid token/i`, `/Internal Server Error|^5\d\d\b/`。
一致しないもの（「委託先が見つかりません」等の業務メッセージ）は記録対象外。パターンは定数配列で持ち、テストで固定する。

### `capturedRoute(handler)`
API route 5本（`admin/defensive-alerts`, `scan/upload`, `cron/defensive-alerts`, `hibiki/voice/intent`, `hibiki/invoice/html`）。例外を記録し `500 { error: '処理に失敗しました' }` を返す。cron ルートは `source='cron'`。

### エラー境界
- `app/admin/error.tsx`, `app/driver/error.tsx`: 「エラーが発生しました」+ 再読み込みボタンの最小UI
- `app/global-error.tsx`: 同上（`<html><body>` を自前で持つ）
- マウント時に1回だけ Server Action `reportClientError({ message, digest, path })` を呼ぶ（`source='boundary'`, severity normal）。`reportClientError` は `requireAuth` 不要（ログイン前でも起きる）だが、message は 2,000 字で切り、1リクエスト1件のみ受ける

## 4. マスキング（保存前・全経路共通）

`mask(text)` を message / stack 双方に適用してから保存する。
1. Postgres の `DETAIL:` 行（`Failing row contains (...)` / `Key (col)=(値) already exists.` 等）→ 行末まで丸ごと `DETAIL: [omitted]`（行データ丸ごと混入の最大経路。括弧の入れ子や書式に依存させない）
2. 6桁以上の連続数字（ハイフン区切り含む）→ `[digits]`（口座番号・電話番号）
3. メールアドレス → `***@domain`
4. `eyJ` 始まりの英数列（JWT）、`re_` / `sk_` / `AIza` 始まりのキー → `[token]`
5. message 2,000 字、stack 4,000 字で切る
6. **Action の引数は保存しない**（設計上、`captured` は引数にアクセスしない）

## 5. 記録層: `error_logs`

```sql
CREATE TABLE public.error_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint    text NOT NULL,
  day            date NOT NULL,                 -- JST 日付。集約キー
  tenant_id      uuid,                          -- ログイン前は NULL
  source         text NOT NULL CHECK (source IN ('action','route','cron','boundary')),
  action_name    text NOT NULL,
  severity       text NOT NULL CHECK (severity IN ('critical','normal')),
  message        text NOT NULL,                 -- マスク後
  stack          text,                          -- マスク後
  path           text,
  user_id        text,                          -- dev-bypass 等 UUID でない値があり得るため text
  contractor_id  uuid,
  count          integer NOT NULL DEFAULT 1,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  notified_at    timestamptz,
  UNIQUE (fingerprint, day, tenant_id)
);
CREATE INDEX error_logs_last_seen_idx ON public.error_logs (last_seen_at);
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;   -- ポリシーなし＝service_role 専用
REVOKE ALL ON public.error_logs FROM PUBLIC, anon, authenticated;
```
- `fingerprint` = sha256(`source|action_name|正規化message`) の先頭16桁。正規化 = UUID → `<uuid>`、数字列 → `<n>`、空白圧縮
- 同一 `(fingerprint, day, tenant_id)` は1行に集約し `count` 加算・`last_seen_at` 更新（UPSERT）。`tenant_id` NULL は UNIQUE で別行になるため、NULL を固定値 `00000000-0000-0000-0000-000000000000` に写像して保存する
- `approval_history` / `notification_logs` の不変ログ規約の対象外。UPDATE（count 加算・notified_at）は許容。DELETE は保持期限の cron のみ
- RPC（すべて SECURITY DEFINER・service_role のみ EXECUTE 可）
  - `record_error_log(...)` — UPSERT。`(id, count, notified_at)` を返す
  - `claim_error_notification(p_id uuid, p_window_seconds integer) → boolean` — 即時通知の権利を**原子的に**取得。`notified_at` の判定と更新を1文で行い、窓内に通知済みなら false
  - `release_error_notification(p_id uuid)` — 送信失敗時に `notified_at` を NULL に戻す
  - `purge_error_logs(p_days integer) → integer` — 保持期限超の削除件数
- 保持 90 日。日次 cron（§6）で `last_seen_at < now() - 90 days` を削除
- 書き込みは service_role のみ（`createServiceClient`）。クライアント直アクセス不可

## 6. 通知層

### severity
- `critical`: `CRITICAL_ACTIONS` に含まれる action_name、または `source='cron'`
  - `CRITICAL_ACTIONS` 初期値: `login`（`app/login/actions.ts`）、`upsertSchedule`、`bulkUpsertSchedules`、`submitWorkRecord`、`generatePaymentNotice`、`generateAllPaymentNotices`
- `normal`: それ以外（boundary 含む）

### 即時メール（critical のみ）
- 同一 `fingerprint` は **60分に1通**。抑制は DB の `claim_error_notification(id, 3600)` が担う
  - アプリ側は「送信の前に権利を取得する（claim-before-send）」。true を返した呼び出しだけが送信する
  - 判定と更新を分けると、`Promise.allSettled` 等で同一エラーが N 件並行したとき N 通送ってしまうため、必ず DB 側で原子的に行う
  - 送信が失敗（`ok: false`）したら `release_error_notification` で権利を返す。失敗したまま `notified_at` を残すと次の60分が黙るため
  - `shouldNotifyImmediately()` は severity のみ判定する（時間窓は DB 側）
- 宛先 `ADMIN_ALERT_EMAIL`（既存 env）。送信条件: `NODE_ENV === 'production'` かつ宛先設定あり。**新規 env は追加しない**
- 本文: action_name / severity / tenant_id / 発生時刻 / マスク済み message（先頭300字）/ 当日 count
- 送信は `getCloudflareContext().ctx.waitUntil` があればそれで応答後に実行、取れない環境では await にフォールバック
  - ⚠️ `waitUntil` が使えない場合、通知の Resend 往復が Action の応答時間に乗る。critical のみ・60分抑制ありなので許容

### 日次まとめ
- 新規 `/api/cron/error-digest`（`x-cron-secret` 認証は既存 cron ルートと同一パターン）
- `.github/workflows/defensive-alerts-cron.yml` に step を1つ追加（`$BASE_URL/api/cron/error-digest`）。URL は `APP_BASE_URL` 変数経由、直書き禁止
- 内容: 前日（JST）の `error_logs` を fingerprint 別に count 降順で列挙。severity・tenant・件数・message 先頭 120 字
- **0件でも「0件」を送る**（監視が生きている確認＝ハートビート）
- 同ルートで保持期限（90日）超の行を削除

## 7. 第1段の適用範囲と第2段

**第1段**
- `utils/error-monitor/` 一式 + マイグレーション + `sendAdminAlertEmail` + `/api/cron/error-digest` + workflow step
- `captured` 適用: `CRITICAL_ACTIONS` の Action（6本）
- `capturedRoute` 適用: API route 5本
- `error.tsx` ×2、`global-error.tsx`、`reportClientError`

**第2段**: 残り約130本の Action に codemod で `captured` を一括適用。`use-server-exports.test.ts` を通す。

## 8. テストと導通確認

- vitest（純関数）: `mask`（6パターン各1件以上）、`isSystemError`（一致・不一致）、`fingerprint`（UUID/数字の正規化で同一化）、`severityFor`
- vitest（`captured`）: 例外→固定文言と記録1回、システム `{error}`→透過と記録1回、業務 `{error}`→透過と記録0回、正常→記録0回、**Sink が例外を投げても戻り値が変わらない**
- 既存 `use-server-exports.test.ts` が通ること
- 本番導通（デプロイ後、1コマンドずつ確認して実施）: owner 専用の意図的失敗 Action を一時追加し1回叩く → `error_logs` に1行、即時メール1通の実着信を確認 → Action を削除してデプロイ。既存 `utils/run-conduction-test.ts` の流儀に合わせる

## 9. セキュリティチェック（hibiki-security）
| # | 項目 | 判定 |
|---|---|---|
| 1 | 口座情報の平文保存 | マスキング §4 で数字列・行データを除去。引数は保存しない → OK |
| 2 | クライアント直クエリ | 記録は全て service_role のサーバー側。`reportClientError` は Server Action 経由 → OK |
| 3 | 不変ログへの UPDATE/DELETE | `error_logs` は対象外。`notification_logs` には触れない → OK |
| 5 | env のビルド焼き込み | 新規 env なし。送信条件は実行時の `NODE_ENV` と `ADMIN_ALERT_EMAIL` 参照 → OK |

## 10. 既定で決めた事項（承認済み）
1. 閲覧UIは作らない（Supabase ダッシュボード + 日次メール）
2. 例外時の画面文言は固定「処理に失敗しました」
3. 日次まとめは0件でも送る
4. 保持90日
5. 第1段の適用先は §7 のとおり
