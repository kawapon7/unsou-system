# 5大防衛アラート：Resendメール通知の復活 設計書

* **作成日：** 2026年7月10日
* **対応コアバージョン：** HIBIKI v_3_1以降
* **ステータス：** 設計確定・実装計画作成待ち

## 1. 背景

2026-07-06セッションの引き継ぎ課題「Resend経由の通知メール実送受信確認（承認操作→通知メール受信までの通しテスト）」に着手したところ、以下が判明した。

* `emailActions.ts`の`sendDefensiveAlertEmail`（Resend送信本体）はAPIとして正常に動作する（2026-06-20に直接送信テスト済み）が、**管理画面のどこからも呼び出されておらず、cron等の定期実行トリガーも存在しない**ため、実質的に到達不能な死んだコードになっている。
* 原因は2026-06-17のコミット`832d202`（`req7`、ボス自身の意思決定「原点回帰プラン」）で、5大アラートの操作を「①手動確認完了 ②削除 ③tel:/sms:リンク起動のみ（自動送信なし）」の3つに意図的に限定したため。`HANDOVER_MASTER.md`§2-8-Bの「メール（Resend）送信ボタン」という記述はこの決定で上書きされたはずの古い仕様が反映されていない。
* 副次的に、⑤長期未承認アラートを取得する`fetchLongPendingNotices()`に`tenant_id`フィルタが一切かかっていないことも判明した（他の同種関数にはある）。現在は本番テナントが1つのみのため実害は出ていないが、本設計のcron処理が複数テナントを正しく分離するための前提条件として、このバグは本設計の一部として修正する。

ボスの判断：「やはりメール自動送信を復活させたい」。tel/sms手動連絡だけでは不十分と判断し、①入力遅延・⑤長期未承認の2アラートに限り、自動送信（1日1回・未送信のみ）＋管理者による手動再送ボタンの両方を復活させる。

## 2. スコープ

**対象とする（復活させる）**
* ①入力遅延（未入力検知）：委託先へメール送信
* ⑤長期未承認（支払通知書48時間超）：委託先へメール送信

**対象としない（現状のtel/sms・削除・手動確認のみを維持）**
* ②重複の疑い（削除で解決する性質のため）
* ③業務しきい値（親分の目視承認で解決する性質のため）
* ④インボイス警告（マスタ修正で解決する性質のため）

**本設計に含まない別課題**
* マルチテナント分離F0実装そのもの（`docs/superpowers/specs/2026-06-27-tenant-isolation-rls-design.md`）は対象外。本設計はテナント分離が未実装の現状（`user_metadata.tenant_id`ベース）を前提に、cronが複数`tenant_id`を安全に横断できるようにするだけであり、テナント分離の恒久対応そのものは別プロジェクトのまま。
* 自動デプロイ再設定（Workers Builds）は無関係の別バックログ項目のため触れない。

## 3. 全体アーキテクチャ

```
GitHub Actions（毎日 JST 9:00 = UTC 0:00、cron + workflow_dispatchで手動実行も可）
  └─ curl -f -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
         https://unsou-system.kawapon7.workers.dev/api/cron/defensive-alerts
        │
        ▼
  web/src/app/api/cron/defensive-alerts/route.ts
    1. x-cron-secret ヘッダーを process.env.CRON_SECRET と比較。不一致/未設定 → 401（fail-closed、DB・メール処理は一切行わない）
    2. createServiceClient() で contractors テーブルから DISTINCT tenant_id を全件取得
       （将来のB社等マルチテナント対応を見据え、テナントIDを決め打ちしない）
    3. テナントごとに以下を実行：
       a. getMissingInputs(tenantId) で①入力遅延の対象を取得
       b. fetchLongPendingNotices(tenantId) で⑤長期未承認の対象を取得（tenant_idフィルタを本設計で追加）
       c. 各アラート行について alert_key を組み立て
          - missing_input:{scheduleId}
          - pending_notice:{noticeId}
       d. notification_logs に同じ alert_key の既存レコードがあればスキップ（重複送信防止）
       e. 無ければ deliverAlertEmail(...) で Resend 送信し、notification_logs に
          status='sent' または 'failed' で記録
    4. 処理件数（送信/スキップ/失敗）をレスポンスJSONで返す
```

* `sendDefensiveAlertEmail`（既存・`requireMasterAccess`必須・管理画面の手動再送ボタン用）とは別に、認可チェックを持たない共通処理`deliverAlertEmail(contractorId, alertKey, alertType, message, tenantId)`を新設し、①cronルート ②手動再送ボタンの両方から呼び出す。cronルート自体はNext.jsのAPI Route Handlerとして実装し、`wrangler.toml`やCloudflare Workersのビルド設定には一切変更を加えない。

## 4. データベース変更

新規マイグレーション（`supabase/migrations/20260710000000_add_alert_key_to_notification_logs.sql`）：

```sql
alter table notification_logs
  add column if not exists alert_key text;

create index if not exists idx_notification_logs_alert_key
  on notification_logs (alert_key);
```

* `notification_logs`の既存の不変ログ方針（`UPDATE`/`DELETE`全ロール禁止、`INSERT`のみ）はそのまま維持。列追加のみで既存トリガー・RLSポリシーへの変更はない。
* `alert_key`はNULL許容（既存の手動アラート送信ログや他のtype値では未設定のままでよい）。

## 5. サーバー側の変更

| ファイル | 変更内容 |
|---|---|
| `web/src/utils/tenant.ts` | service_roleで全`tenant_id`一覧を取得する`getAllTenantIds()`を追加（セッション不要、cron専用） |
| `web/src/app/_actions/scheduleActions.ts` | `getMissingInputs()`に任意の`tenantId`引数を追加。未指定時は従来通り`getCurrentTenantId()`でセッションから解決（ダッシュボード側の呼び出しは無変更で動く） |
| `web/src/app/_actions/defensiveAlertActions.ts` | `fetchLongPendingNotices()`に同様の`tenantId`引数を追加し、**tenant_idフィルタ欠落バグを修正** |
| `web/src/app/_actions/emailActions.ts` | `deliverAlertEmail(...)`を新設（認可チェックなし、`alert_key`付きで`notification_logs`に記録）。既存`sendDefensiveAlertEmail`は内部で`deliverAlertEmail`を呼ぶ形に統合 |
| `web/src/app/api/cron/defensive-alerts/route.ts` | 新規。シークレット検証→テナント横断ループ→重複チェック→送信の本体 |

## 6. UIコンポーネント変更（`DefensiveAlertPanel.tsx`）

* ①`MissingInputSection`の各行、⑤`PendingNoticeCard`に「📧 メール再送信」ボタンを追加。既存の`window.confirm`パターンに合わせ、確認ダイアログ→送信→トースト表示。
* 自動送信が失敗している行には「⚠️ 自動送信失敗」バッジを表示。`getDefensiveAlerts()`のレスポンス型（`MissingInputRow` / `PendingNoticeRow`）に`emailStatus: 'sent' | 'failed' | 'not_sent'`を追加し、対応する`alert_key`で`notification_logs`を突き合わせて判定する。
* ②③④のセクションは変更なし。

## 7. エラーハンドリング

* シークレット不一致・未設定 → 401、DB/メール処理は一切実行しない（fail-closed）
* 個別の送信失敗（宛先不正・Resend APIエラー等）→ その1件のみ`notification_logs`に`status='failed'`を記録し、他の対象への処理は継続する
* DB接続エラー等でルート全体が失敗 → 500を返す。GitHub Actions側は`curl -f`により失敗を検知し、当該ワークフロー実行がGitHub上で失敗表示になる
* 二重送信防止：`alert_key`の存在確認→送信→ログ記録の順に処理し、同一実行内・別日の実行間の両方で同じ`alert_key`への再送信を防ぐ

## 8. デプロイに必要な設定

新規環境変数`CRON_SECRET`（ランダムな十分に長い文字列）を以下の3箇所に設定する：

1. `web/.env.local`（ローカル開発用、コミットしない）
2. Cloudflare Workers シークレット：`wrangler secret put CRON_SECRET`
3. GitHubリポジトリシークレット：`gh secret set CRON_SECRET`（GitHub Actionsから参照）

新規ファイル`.github/workflows/defensive-alerts-cron.yml`（`schedule: cron: '0 0 * * *'` + `workflow_dispatch`で手動実行も可能にする）。

## 9. テスト方針（実地確認）

1. cronルートへ直接`curl`：正しいシークレットで200・実際にテスト用委託先へメールが届くこと、誤ったシークレットで401になることを確認
2. 同じ`curl`を2回連続実行し、2回目は全件スキップ（`notification_logs`が1件も増えない）ことを確認
3. 管理画面で「📧 メール再送信」ボタンを実際に押し、確認ダイアログ→送信→トースト→`notification_logs`記録までを目視確認
4. 委託先のメールアドレスを一時的に空にした状態で送信を試み、失敗バッジが管理画面に表示されることを確認
5. GitHub Actionsのワークフローを`workflow_dispatch`で手動トリガーし、本番の`kawapon7+driver@gmail.com`宛に実際に届くことを確認する — これをもって「Resend通知メール実送受信確認」タスクの完了とする

## 10. コスト

* GitHub Actions：本リポジトリはPublicのため無料・無制限。1日1回・数十秒のジョブのため実質コストなし
* Resend：無料プラン（月3,000件・1日100件）の範囲内で運用可能な規模
* Cloudflare Workers：既存の無料枠（1日10万リクエスト）に対して無視できる増加量

新たな費用発生は想定しない。

## 11. 決定事項の記録（brainstormingセッションでの選択）

* 対象アラート：①入力遅延・⑤長期未承認の2つのみ（②③④は対象外）
* 送信タイミング：自動送信（1日1回・未送信のみ）＋ 手動再送ボタンの両方
* 自動送信トリガー：GitHub Actions定期実行 → シークレット保護されたNext.js APIルート（Cloudflare Cron Trigger／OpenNext worker.jsへの直接介入は本番ビルド破損リスクがあるため不採用）
* 重複防止：`notification_logs.alert_key`による「未送信のみ送信」方式
* 失敗時の通知：ダッシュボードのアラート行に失敗バッジを表示（新規の別通知手段は作らない）
