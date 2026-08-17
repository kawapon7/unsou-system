# 本番DB新規作成 実行手順書

作成: 2026-08-17
状態: **未着手**（前提条件はすべて充足済み）

## これは何をする作業か

現在の本番DB（`hbpnhbsmsuhjyrohpluu`）は、開発・テスト・本番を1つで兼ねてきたためデモデータで汚染されている
（荷主6・委託先16・案件21・稼働127・予定140、すべて【デモ】【テスト】【検証】）。

**新しいSupabaseプロジェクトを本番として作り直し、現行DBはテスト環境として残す。**

⚠️ 実データは未投入なので、**今なら移行コストがほぼゼロ**。A社の実運用開始後だと稼働中データの移行になり危険。

## 前提条件（2026-08-17時点ですべて充足）

| 条件 | 状態 |
|---|---|
| マイグレーションで本番スキーマを再現できる | ✅ **55本＝本番適用55件で一致**（名前ベースで機械照合済み） |
| テナント分離F0が完了している | ✅ 2026-08-10完了。正準テナントUUID = `00000000-0000-0000-0000-0000000000a1` |
| 税務まわりの論点が決着している | ✅ 論点A/B/D すべて決着（2026-08-16〜17） |
| 実データが未投入 | ✅ 全件がデモ/テストデータ |

⚠️ **この前提が崩れる最大の要因は「マイグレーションを経由しないスキーマ変更」。**
テスト環境（＝現行DB）でダッシュボードから直接列を足すと、新DBに反映されず二度と揃わなくなる。

## 順序（厳守）

### 1. 新プロジェクト作成（ボス）

- **新しい組織**に作る。プランは組織単位なので、本番だけPro化したいなら組織を分ける必要がある
  （プロジェクトの組織間移動は公式機能としてあるため、この判断は不可逆ではない）
- 新規作成は $0。Proにするかは後から決められる
- リージョンは現行と揃える（Tokyo）
- **DBパスワードは控えておく**（次のステップで使う。⚠️チャットに貼らないこと）

### 2. マイグレーション55本を流す（ボス→アシスタント）

```bash
cd /Users/atsushikawasaki/dev/unsou-system
supabase link --project-ref <新しいproject-ref>
supabase db push
```

⚠️ **必ず `supabase db push` を使う。MCPの `apply_migration` は使わない。**
MCP経由はバージョンを自動採番するため、ローカルのファイル名と本番の記録がズレる
（現行DBはこれで8本ズレており、その都度リネームで合わせている）。
`db push` ならローカルの版番号がそのまま入り、**新DBは最初から1:1一致**になる。

⚠️ `supabase link` はDBパスワードを聞く。**アシスタントは実行できない**（認証情報の入力にあたるため）。
リンクが済んだあとの `db push` はアシスタントが実行できる。

適用後の検証（アシスタント）:
```sql
SELECT count(*) FROM supabase_migrations.schema_migrations;  -- 55 になること
```

### 3. テナント行を作る（アシスタント）

```sql
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'A社');
```

⚠️ **UUIDは現行と同じ値を使う。** 変えるとローカルの検証手順や過去の記録がすべて食い違う。

### 4. ユーザーを作る（ボス）

現行は9件だが、**デモ用アカウントは作り直さない**。実際に使う人だけ:

- master（親分）: 1件
- driver（子分）: A社の実ドライバー人数分

⚠️ **作成後、各ユーザーの `app_metadata.tenant_id` に上記UUIDを必ず設定する。**
F0以降、テナント判定の一次ソースは `app_metadata`。設定しないと**その人の書き込みが全部失敗する**。

⚠️ `provider` を消さないこと（現行DBで一度踏んだ罠）。

### 5. 自社情報を登録（ボス）

`/admin/settings/company` から入力。**PDFは未登録だと fail-closed で出せない**ので必須。

- 必須2項目: 会社名・`invoice_reg_number`（14桁）
- 口座4項目は AES-256-GCM で暗号化保存される
- `fiscal_year_end_month`（決算月）⚠️ 現行DBには検証で `3` が入っている。**実際の決算月を入れること**
- `transport_insurance_amount`（運送保険）既定1000
- `payment_notice_response_days`（返事を待つ日数）既定7

💡 **`ENCRYPTION_KEY` を新旧で同じにするなら**、`companies` の口座暗号文をそのままコピーしても復号できる。
別の鍵にするなら画面から入力し直すこと（暗号文をコピーすると「（復号エラー）」になる）。

### 6. A社の実マスタを投入（ボス）

荷主 → 委託先 → 案件 → 単価ルール の順。案件は荷主と委託先が先に無いと作れない。

⚠️ **デモデータ投入スクリプト（`web/scripts/seed-demo-full.mjs`）は流さない。** 新DBを汚す。

### 7. 接続先を切り替える（ボス＋アシスタント）

**この順序を守る。逆にすると本番が壊れる。**

1. **GitHub secrets を新プロジェクトの値に差し替え**（ボス）
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. **Worker secrets を差し替え**（ボス、`wrangler secret put`）
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`（ミドルウェアが runtime 参照するため Worker 側にも必要）
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ENCRYPTION_KEY` / `RESEND_API_KEY` / `GEMINI_API_KEY` / `CRON_SECRET` / `ADMIN_ALERT_EMAIL` / `HIBIKI_OWNER_EMAILS` / `RESEND_FROM_EMAIL`（DB切替と無関係なものは据え置きでよい）
3. **再デプロイ**（アシスタント: `gh workflow run deploy.yml`）

⚠️ **最大の罠: `NEXT_PUBLIC_*` はビルド時にクライアントバンドルへ焼き込まれる。**
GitHub secrets を変えただけでは反映されない。**必ず再デプロイすること。**
Worker secrets だけ変えてデプロイを忘れると、画面は旧DBを見たまま、サーバー側だけ新DBという最悪の混在状態になる。

⚠️ `ALLOW_DEV_AUTH_BYPASS` は本番で設定しない（`npm run deploy` が `false` を強制している）。

### 8. 検証（アシスタント）

- [ ] `supabase_migrations.schema_migrations` が 55 件
- [ ] `tenants` に正準UUIDの行が1件
- [ ] FK 18本・`tenant_id` の NULL 0件・非uuid列 0件（F0の検証と同じ観点）
- [ ] 不変トリガー4本が有効（`approval_history` / `notification_logs` の UPDATE/DELETE 拒否）
- [ ] 本番URLでログインできる
- [ ] 案件・委託先・荷主の一覧が出る
- [ ] 支払通知書を1件生成 → 金額が手計算と一致（運送保険 −1,000 と経過措置が乗るか）
- [ ] 請求書を1件確定 → `invoices` に行が増える
- [ ] PDFが出る（自社情報が反映されている）
- [ ] cron を手動実行して成功（`gh workflow run defensive-alerts-cron.yml`）

### 9. 現行DBをテスト環境として残す（ボス）

- **消さない。** 開発・検証はこちらで行う
- ⚠️ **今後この環境でスキーマを変えるときも必ずマイグレーションファイル経由**。
  ダッシュボードで直接いじると、本番（新DB）との一致が崩れる

## ロールバック

切り替え後に問題が出たら、**GitHub secrets と Worker secrets を旧プロジェクトの値に戻して再デプロイ**すれば元に戻る。
新DBは消さずに残しておけば、原因を調べてからやり直せる。

⚠️ 旧DBを消さない限りロールバックは常に可能。**だから旧DBの削除は最後まで行わない。**

## やってはいけないこと

- MCPの `apply_migration` で新DBを作る（版番号がズレて前提が崩れる）
- デモデータ投入スクリプトを新DBで流す
- `NEXT_PUBLIC_*` を変えて再デプロイしない
- 旧DBを早々に削除する
- `app_metadata.tenant_id` の設定を忘れる（書き込みが全部失敗する）

## 未確定事項

- **新組織をProにするか**（日次バックアップ7日分が付く。Freeは `supabase db dump` のみ）
- **`ENCRYPTION_KEY` を新旧で共通にするか**（共通なら口座暗号文をコピーできる）
- 実運用開始日
