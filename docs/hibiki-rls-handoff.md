# HIBIKI 本番 RLS ポリシー未設定 8件 — 引き継ぎ

作成: 2026-09-03 (Air セッションで調査 / 実装は mini の `~/dev/unsou-system` で行うこと)
対象: Supabase `hibiki-production` (ref `lsgvnxiuidvwefihjbcu`, org `hibiki-production-org`, plan pro)

## 1. RLS とは何か（前提の整理）

Row Level Security = **テーブルの「行」単位のアクセス制御**。Postgres の機能で、Supabase はこれを認可の中核に使う。

Supabase から DB を触る経路は 2 つあり、RLS の効き方が正反対:

| 経路 | 使うキー | RLS |
|---|---|---|
| ブラウザ/アプリから直接 | anon / authenticated (publishable key) | **効く** |
| サーバー側コードから | service_role (secret key) | **完全にバイパスする** |

つまり RLS は「クライアントに DB を直接触らせる」設計のための仕組み。全部サーバー経由なら RLS は出番がない。

### 重要な挙動: 「RLS 有効 + ポリシー 0本」= 全拒否

ポリシーが無い = 許可が 1 つも無い = **anon/authenticated からは1行も見えない・書けない**。
これは「穴が空いている」のではなく「閉じ切っている」状態。**fail closed**。

したがって今回の 8 件は、**情報漏洩リスクではない**。advisor のレベルが WARN ではなく INFO なのはこのため。
ただし「クライアントから触る想定だったのに閉じている」なら**機能が壊れている**ことになる。そこが唯一の論点。

## 2. 実測した現状 (2026-09-03)

8テーブルすべて RLS 有効・ポリシー 0本。

| テーブル | anon/authenticated への GRANT | tenant_id | 想定される扱い |
|---|---|---|---|
| `error_logs` | **なし** | あり | サーバー専用。意図どおり。**作業不要** |
| `tenants` | フル(SELECT/INSERT/UPDATE/DELETE) | **なし** | テナント本体。専用ポリシーが要る |
| `contractors` | フル | あり | テナント分離の定型 |
| `client_departments` | フル | あり | 同上 |
| `document_sequences` | フル | あり | 同上(採番。書き込み制限を検討) |
| `driver_project_assignments` | フル | あり | 同上 |
| `expense_records` | フル | あり | 同上 |
| `notification_reads` | フル | あり | 同上(本人分のみに絞る想定) |

GRANT はフルに付いているが、**RLS が全拒否しているので現状は到達不能**。GRANT だけでは通らない（RLS と GRANT は AND 条件）。

## 3. 最初にやること（これが判断の分岐点）

**mini のリポジトリで、これら 8 テーブルにクライアントから直接アクセスしているコードがあるか確認する。**

```
rg -n "from\('(contractors|client_departments|document_sequences|driver_project_assignments|expense_records|notification_reads|tenants)'\)" src/
```

- **ヒットしない（全部サーバー経由）** → 現状で正しく動いている。作業は「意図的にポリシー不要」と明示するコメント付きマイグレーションのみ。**実質 30分**。
- **ヒットする** → その画面は今も動いていないはず。ポリシーを書く必要がある。下記のボリューム。

既存テーブル（`schedules`, `projects` 等）には `rls_tighten_5tables` などで実装済みのポリシーがあるので、**書き方はコピーできる**。ゼロから考える必要はない。

## 4. 作業ボリューム見積もり

前提: 既存ポリシーの書き方を流用、マイグレーション 1 本にまとめる。

| 項目 | 見積 |
|---|---|
| 既存ポリシーの書式調査（`rls_tighten_5tables` 等を読む） | 30分 |
| 定型 6テーブル分のポリシー記述 | 1時間 |
| `tenants` の専用ポリシー（テナント本体なので設計判断が要る） | 30分 |
| `document_sequences` / `notification_reads` の書き込み権限の絞り込み検討 | 30分 |
| ブランチ or ローカルで適用・動作確認 | 1時間 |
| 本番適用 + advisor 再確認 | 30分 |
| **合計** | **半日（4時間程度）** |

コード量は SQL で 80〜150 行程度。難易度は低いが、`tenants` の設計判断だけ考える必要がある。

**全部サーバー経由だった場合は 30分で終わる。** まず §3 の確認から入ること。

## 5. 併せて残っている項目

- **漏洩パスワード保護**: 意図的に保留中。導入初期の混乱回避のため。アナウンス後に ON。
  ON する前に `WeakPasswordError` のハンドリング確認が必須（既存ユーザーのログイン自体は通るが、エラー全般を失敗扱いしていると全員ログイン不能に見える）。
- **ブランチ運用への移行**: 現在ブランチ 0 本。無料組織の `unsou-system` を test 環境にする方式はドリフトを生む（`align_schema_with_production` / `align_with_production_actual` の 2 本がその後始末）。Pro なのでブランチが使える。

## 6. 調査結果と対応（2026-09-04・mini）

**§3 の分岐は「ヒットしない」側だった。** `web/src` 全域で 8 テーブルへの `.from()` は 54 箇所あるが、受け手は全て `createServiceClient()`（service_role・RLS バイパス）。anon キー側の `createClient()`（`utils/supabase/server.ts`）は `auth.getUser()` にしか使われておらず、`createBrowserClient` からの直クエリは 0 件。`internal.is_owner()` / `internal.my_contractor_id()` は SECURITY DEFINER なので、authenticated の GRANT を剥がしても既存ポリシーは壊れない。

**対応 = `supabase/migrations/20260904000000_rls_server_only_8tables.sql`（30分コース）**
- 8 テーブルに `service_role` 専用ポリシー `<table>_server_only` を 1 本ずつ置く（20260607 の contractors と同型。advisor の INFO 消し＋意図の宣言。機能上は無意味）
- anon / authenticated への GRANT を全 REVOKE（多層防御。error_logs は元々なし）
- `COMMENT ON TABLE` で「server-only」を残す
- ローカル PostgreSQL 16 の使い捨て DB で適用・再適用（冪等）・`set role anon` で拒否されることを確認済み（2026-09-04）

本番適用はボスが SQL Editor で実施（手順は HANDOVER §5-2 の当該行）。適用後に `get_advisors(security)` で INFO 8 件が消えることを確認する。

## 7. 本番適用 完了（2026-09-04）

ボスが `hibiki-production` の SQL Editor で実行・台帳登録。実測: `_server_only` ポリシー 8 本・anon/authenticated GRANT 0 件・`schema_migrations` 68 本（ローカルと一致）・security advisor は漏洩パスワード保護の WARN 1 件のみ（INFO 8 件消滅）。本件クローズ。残るは §5 の 2 項目。
