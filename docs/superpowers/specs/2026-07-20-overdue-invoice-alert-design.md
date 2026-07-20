# 督促・延滞管理アラート 設計書

* **作成日：** 2026年7月20日
* **対応コアバージョン：** HIBIKI v_3_1以降
* **ステータス：** 設計確定・実装計画作成待ち

## 1. 背景

2026-07-18に実施した「一般的な請求・支払い管理ソフトとの機能ギャップ分析」（`docs/HANDOVER_MASTER.md` §5-4）で、既存の5大防衛アラートには「未入力アラート」（①入力遅延）はあるが「未入金アラート」がない穴が判明した。入金予定日（`invoices.due_date`）を超過したのに`status`が`paid`になっていない請求書は、現状は入金管理画面（画面③）を目視で確認するまで気づけない。

`docs/superpowers/plans/2026-07-18-feature-gap-roadmap.md`のロードマップで最優先項目とされており、既存の5大防衛アラート（`notification_logs`テーブル・`defensiveAlertQueries.ts`・cron基盤・`DefensiveAlertPanel`）と同じ仕組みをそのまま流用することで、追加ツール・追加コスト無しで実装できる見込み。

## 2. スコープ

**対象とする**
* 「⑥延滞請求書」として新規アラートを1件追加：`invoices.status='issued'` かつ `invoices.due_date` が今日（JST）より過去の請求書を検知
* 検知結果を`DefensiveAlertPanel`に新セクションとして表示
* 入金管理画面（画面③）の一覧で、該当行を視覚的に強調表示
* 検知時に社内向け（`ADMIN_ALERT_EMAIL`宛）に1回だけメール通知

**対象としない**
* 荷主本人への督促メール送信（社内向け通知のみが今回のスコープ。将来別プロジェクトとして検討）
* 未入金の継続日数に応じたリマインド再送信（初回検知時の1回のみ。既存の①⑤と同じ「未送信のみ送信」パターンを踏襲）
* 与信管理（支払遅延履歴の記録・与信枠設定）：ロードマップの次項目であり別プロジェクト
* `invoices`テーブルへの真偽フラグ追加等のスキーマ変更（`status`列のみで判定可能なため不要）

## 3. 全体アーキテクチャ

```
GitHub Actions（毎日 JST 9:00、既存cronに相乗り）
  └─ 既存の defensive-alerts-cron.yml は変更不要
        │
        ▼
  web/src/app/api/cron/defensive-alerts/route.ts
    既存のテナント横断ループ内に以下を追加：
      c'. fetchOverdueInvoices(tenantId) で⑥延滞請求書の対象を取得
      d'. alert_key = overdue_invoice:{invoiceId} を組み立て
      e'. notification_logs に同じ alert_key があればスキップ（重複送信防止）
      f'. 無ければ deliverAlertEmail(...) で ADMIN_ALERT_EMAIL 宛に送信し、
          notification_logs に status='sent' または 'failed' で記録
```

* 既存の`fetchMissingInputs`（`defensiveAlertQueries.ts`）と同じJST日付算出パターン（`toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })`）を流用し、`fetchOverdueInvoices(tenantId)`を新設する。
* 送信先：`deliverAlertEmail`は現状`contractor.email || ADMIN_ALERT_EMAIL`を宛先にする実装だが、本アラートは`contractor_id`を持たない（`invoices`は`client_id`のみ）。荷主には送らない方針のため、`contractorId`を渡さず常に`ADMIN_ALERT_EMAIL`宛に送信する新しい呼び出し経路を`deliverAlertEmail`に追加する（`contractorId`を省略可能にする）。
* cronルート・GitHub Actionsワークフロー自体への変更は「呼び出すクエリ関数が1つ増える」のみで、シークレット検証・fail-closed方針・テナント横断ループの構造は無変更。

## 4. データベース変更

マイグレーション不要。

* `notification_logs.alert_key`は既存のTEXT列（`20260710000000_add_alert_key_to_notification_logs.sql`で追加済み）にCHECK制約が無いため、`overdue_invoice:{invoiceId}`という新しい値をそのままINSERTできる。
* `notification_logs.type`（`email`/`sms`/`import_log`/`reminder`のCHECK制約）は既存の`email`をそのまま使う。
* TypeScript側の`AlertKeyType`（`defensiveAlertQueries.ts`）に`'overdue_invoice'`を追加する。

## 5. サーバー側の変更

| ファイル | 変更内容 |
|---|---|
| `web/src/app/_actions/defensiveAlertQueries.ts` | `fetchOverdueInvoices(tenantId)`を新設。`invoices`を`clients!inner(tenant_id, company_name)`でjoinし`status='issued' AND due_date < today(JST)`で抽出、`alert_key`付与まで行う |
| `web/src/app/_actions/emailCore.ts` | `ALERT_SUBJECTS`に`overdue_invoice`の件名を追加。`deliverAlertEmail`の`contractorId`引数を省略可能にし、省略時は`ADMIN_ALERT_EMAIL`のみを宛先にする分岐を追加 |
| `web/src/app/api/cron/defensive-alerts/route.ts` | テナント横断ループ内で`fetchOverdueInvoices`を呼び出し、未送信分のみ送信する処理を追加 |
| `web/src/app/_actions/defensiveAlertActions.ts` | `getDefensiveAlerts()`の`Promise.all`に⑥を追加し、返却型に`overdueInvoices`フィールドと`totalCount`への合算を追加 |
| `web/src/app/admin/sales/actions.ts` | `fetchSalesList`が返す各行に「延滞中か」の判定に必要な情報（既存の`status`・`due_date`で判定可能なため、追加取得は不要。画面側で判定ロジックを実装） |

## 6. UIコンポーネント変更

**`DefensiveAlertPanel.tsx`**
* 既存の`AlertSection` + `Badge`パターンをそのまま使い、6つ目のセクション「⑥延滞請求書」を追加（`count===0`なら非表示）。
* 各行に荷主名・請求金額・入金予定日・超過日数を表示。既存の`emailStatus==='failed'`赤字表示パターンをそのまま踏襲。

**入金管理画面（画面③・`web/src/app/admin/sales/page.tsx`の`PaymentStatusTab`）**
* 一覧の各行で、`status==='issued'` かつ `dueDate` が今日（JST）より過去の場合、行全体または入金予定日セルを赤字・薄い赤背景で強調表示する（既存の行スタイルに条件分岐を追加するのみで、新規コンポーネントは不要）。

## 7. エラーハンドリング

* 既存cronルートのfail-closed方針・個別送信失敗時の`status='failed'`記録・処理継続は変更なしでそのまま適用される。
* `fetchOverdueInvoices`が0件を返すテナントでは、当該テナントの処理をスキップ（既存の①⑤と同じ挙動）。
* 二重送信防止：既存の「`alert_key`存在確認→送信→ログ記録」の順序をそのまま踏襲。

## 8. デプロイに必要な設定

新規の環境変数・外部サービス契約は不要。既存の`RESEND_API_KEY`・`RESEND_FROM_EMAIL`・`ADMIN_ALERT_EMAIL`・`CRON_SECRET`をそのまま使う。

## 9. テスト方針（TDD）

`fetchOverdueInvoices`の日付境界を中心にユニットテストを先に書く：
1. `due_date`が今日（JST） → 対象外
2. `due_date`が昨日 → 対象
3. `status='paid'` → `due_date`が過去でも対象外
4. `status='draft'` → 対象外
5. 他テナントの延滞請求書 → `tenant_id`フィルタで対象外
6. 同じ`invoiceId`に既に`alert_key`一致のログがある → `emailStatus='sent'`として送信スキップ対象

実地確認：
1. `due_date`を過去日に設定した`status='issued'`の請求書を1件用意し、cronルートを`curl`で手動実行 → `ADMIN_ALERT_EMAIL`宛にメールが届くこと
2. 同じ`curl`を2回連続実行 → 2回目は`notification_logs`が増えないこと（重複防止）
3. `DefensiveAlertPanel`に「⑥延滞請求書」セクションが表示され、バッジ件数が一致すること
4. 入金管理画面で該当行が赤字強調表示されること
5. 該当請求書を「✅ 入金済にする」で`status='paid'`に変更 → 次回cron実行・画面表示の両方で対象から外れること

## 10. コスト

新たな費用発生は想定しない。既存のGitHub Actions（Public repo無料）・Resend（無料プラン枠内）・Cloudflare Workers（既存無料枠内）・Supabase（テーブル追加なし）の範囲内で完結する。

## 11. 決定事項の記録（brainstormingセッションでの選択）

* 通知対象：社内向けのみ（荷主への督促メール送信は対象外）
* 発報タイミング：`due_date`翌日から即発報（猶予期間なし）
* 繰り返し通知：初回のみ（`alert_key`方式で以降は画面バッジのみで気づく形。既存の①⑤と同じパターン）
* UI表示範囲：`DefensiveAlertPanel`への追加に加えて、入金管理画面（画面③）にも視覚強調を追加
