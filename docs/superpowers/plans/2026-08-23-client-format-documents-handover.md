# 引き継ぎ: 導入先ごとの帳票様式（請求書・支払明細書）再現機能

作成: 2026-08-23（Mac mini / BLACKICE のセッションから）
要件定義の正本: `docs/superpowers/specs/2026-08-23-client-format-documents-design.md`
ステータス: **要件合意済み・実物様式の入手待ち・土台①は実装済み（ブランチ `feat/document-issuance-foundation`・本番DB未適用・画面未検証）・様式②は未着手**

## 土台①の状態（2026-08-23 実装）

計画: `docs/superpowers/plans/2026-08-23-document-issuance-foundation.md`（Task 1〜8 すべて完了、コミット済み）。
内容の要約は `HANDOVER_MASTER.md` §5-4 2026-08-23 の 4 を参照。

### 本番適用手順（ボス作業・1コマンドずつ・順番厳守）

1. ブランチ `feat/document-issuance-foundation` を確認し main にマージ（`git log main..feat/document-issuance-foundation --oneline` で 7 コミット）
2. Supabase ダッシュボード > SQL Editor で `supabase/migrations/20260823150000_document_issuance_foundation.sql` を**全文**実行（BEGIN〜COMMIT 一括）
3. `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260823150000','document_issuance_foundation');`
4. デプロイ（main へ push → Actions）
5. 画面確認: 設定 > 自社情報 に「請求書番号の書式」「標準の請求書様式」が出る → 保存できる
6. 売上・請求管理 → 確定済み請求書の PDF → 「確定発行（控え保存）」→ 番号が `INV-YYYYMM-0001` 形式に変わる
7. 発行控え（`/admin/documents`）で検索・表示・取消・再発行を1件ずつ試す
8. 問題があれば `issued_documents` / `document_history` は DROP せず残し、コードを revert する（不変ログ扱い）

### 未検証事項（DB 適用後に必ず確認）
- `next_document_sequence` の RPC 呼び出し（service_role 経由）が Supabase 型 `Functions` と一致して動くか
- guard トリガが「取消」の UPDATE を通し、それ以外を拒否するか
- ドライバーが `getIssuedDocument` で他人の控えを取れないこと

## おおば運送の運用スケジュール（2026-08-23 確定）

- **2026年9月: 試験運用**。**9月が決算、10月から来期＝本番運用**（おおば社長の意向）
- 期限から逆算した必須作業: **10/1 までに RLS テナント基準化を完了**（必須3項目の①）。9月の試験運用と並行で最優先
- 目安: 8月末まで 土台①適用・バックアップ確認・おおば様式② / 9月上旬 テナント作成・試験運用開始 / 9月上〜中旬 RLS（棚卸し→A→B→C） / 9月下旬 決算締めを試験運用で通す・2テナント分離テスト完了
- 事前に決めること: (1) 9月の試験データを10月前に消すか残すか（不変トリガは DELETE を拒否するため、消すならテナント単位の消去手順を別途設計） (2) おおばの決算月設定（10月新年度なら `fiscal_year_end_month=9`。採番書式に `{FY}` を使う場合は必須） (3) 9月中旬に RLS を再見積もりし、間に合わない場合は早めに報告


## 2026-08-23 夜 — 帰宅後にボスがパソコンで行うこと（試験運用前の必須4項目）

こちらで済ませた分: P0（`cd7b298`）と P1 の高 5 箇所（`fb5b5ba`）。ブランチ `feat/document-issuance-foundation`（土台①と同じブランチ）。

1. **ブランチ確認とマージ**
   ```
   git log main..feat/document-issuance-foundation --oneline
   git checkout main && git merge --no-ff feat/document-issuance-foundation
   ```
2. **バックアップ確認**（項目3）: Supabase ダッシュボード > Project Settings > Database > Backups で日次バックアップが有効か確認。可能なら Point-in-time Recovery の有無も。**復元手順（どこを押すか）を本書に 3 行で書き残す**。本番でリストアは試さない
3. **マイグレーション適用（SQL Editor・1 ファイルずつ・順番厳守）**
   1. `supabase/migrations/20260823150000_document_issuance_foundation.sql` 全文（土台①）
   2. `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260823150000','document_issuance_foundation');`
   3. `supabase/migrations/20260823180000_users_tenant_id.sql` 全文（P0）
   4. `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260823180000','users_tenant_id');`
   5. 確認: `SELECT email, role, tenant_id FROM public.users WHERE tenant_id IS NULL;` → **0 行**（admin@hibiki.com が A社 `…00a1` に紐づく）
4. **本番 admin の app_metadata 確認**: Authentication > Users > admin@hibiki.com > Raw App Meta Data に `"tenant_id": "00000000-0000-0000-0000-0000000000a1"` があるか。無ければ `node web/scripts/set-production-tenant.mjs admin@hibiki.com 00000000-0000-0000-0000-0000000000a1`。P0 以降は users.tenant_id でも解決できるので無くても落ちないが、揃えておく
5. **デプロイ**: `cd web && npm run deploy`
6. **画面一巡**: ログイン → ダッシュボード（数字が出る）→ 設定 > 自社情報（「請求書番号の書式」が出る・保存できる）→ 売上・請求管理 → 請求書 PDF → 「確定発行」→ 発行控え一覧で表示・取消・再発行
7. **おおば運送テナント作成**（試験運用の準備。様式②は見本入手後に別途）
   ```
   cd web && set -a && source .env.local && set +a
   node scripts/create-tenant.mjs "おおば運送" <おおば社長のメール> '<初期パスワード>'
   ```
   出力の tenant_id を控える。その master でログインし 設定 > 自社情報 を登録してもらう
8. **ボスがおおばテナントの委託先として入る場合**: おおば側 取引先マスタでボスの会社を委託先登録 → ユーザー管理 > ドライバー作成（別メールアドレス・別アカウント方式）

残り（並行で進める）: P1 の中・低、P2（tenantScoped ラッパ＋番人テスト）、P4（分離テスト）、P3（DB ポリシー）、様式②。

## 商用化（他社導入）前の必須3項目（2026-08-23 ボス決定）

「SaaS として他社に売る」前に最低限済ませる。様式②の前後で計画に組み込む。

1. **RLS のテナント基準化**: 棚卸し完了（2026-08-23）→ `docs/superpowers/specs/2026-08-23-rls-tenant-inventory.md`。結論: アプリは 100% service_role なので DB の RLS だけでは守れない。P0（users.tenant_id＋app_metadata 書き込み＋テナント作成）→ P1（無絞りクエリ修正）→ P2（tenantScoped ラッパ＋番人テスト）→ P4（2テナント分離テスト）→ P3（DB ポリシー）の順、合計 13〜18h。**P0 は様式②より先**（おおば運送のアカウントを作ると getCurrentTenantId が throw するため）。
   旧記述: 現状の RLS はロール（owner/本人）基準で、テナントの絞り込みはアプリ側 `getCurrentTenantId()` の `.eq('tenant_id', …)` 頼み。DB 側のポリシーに「自分のテナントの行しか見えない」条件を入れ、アプリの書き漏れがあっても他社データが漏れない構造にする。全テーブル横断・1箇所の漏れが不可逆なので Opus で設計し、段階適用する
2. **バックアップ・復旧の確認**: Supabase の自動バックアップ設定と復元手順を確認し、実際に1回リストアを試して手順書化する。障害時の連絡・監視も決める
3. **利用規約・料金・オンボーディング**: 利用規約・プライバシーポリシー（ドライバー口座情報の取扱い含む）、料金プラン、申込→テナント作成→初期設定の手順を整備する


## 次のセッションで最初にやること（この順）

1. `ls ~/dev/unsou-system/ooba/` — おおば運送の雛形 Excel と印字済み見本が置かれているか確認
   - 無ければボスに依頼。Air にある場合は Air 側で `scp -r ~/dev/unsou-system/ooba mini:~/dev/unsou-system/`
   - `ooba/` は `.gitignore:42` で除外済み。実名・口座を含む実データなので Drive やチャットに再アップしない
2. 要件定義 §2（合意事項）と §9（未決事項）を読む。HANDOVER_MASTER の全文は読まない
3. 実物を読んで §9 の未決事項を埋める → `superpowers:writing-plans` で実装計画を作る
4. **計画ができるまで実装に入らない**（ボスの指示）

## 5分で分かる要点

- **おおば運送の位置づけ（2026-08-23 訂正）**: ボスの会社の荷主（委託元）であり、かつ **HIBIKI の試験運用先＝2つ目のテナント**。HIBIKI はそもそもおおば社長の事務処理軽減のために作り始めたもの。おおば社長は自社テナントの管理者として、自分の荷主への請求書・自分の委託先（ボスの会社を含む）への支払明細を HIBIKI で作る。預かる雛形は**おおば運送テナントの標準様式**（`companies.document_format_key`）。ボスはおおばテナントでは委託先（ドライバー）、自社テナントでは管理者（別アカウント方式）
- **RLS テナント基準化の優先度**: おおば運送の試験運用開始時点で 2 テナントが実データを持つ。推奨順序: ①土台①の本番適用 → ②おおば様式 → ③試験運用開始 → ④RLS テナント基準化を最優先で並行し、試験運用中に完了。試験運用前にバックアップ確認（必須3項目の②）を最低1回

- **様式の登録主体（2026-08-23 決定）**: 現段階はシステム側のみで作る。将来は利用者アップロード方式も選べるようにし、開発側作成は初期費用として請求する位置づけ。詳細は要件定義 §2-2

- 既存の PDF 生成は `web/src/components/pdf/InvoiceDocument.tsx` と `PaymentNoticeDocument.tsx`、データ取得は `web/src/app/_actions/pdf-actions.ts`、PDF 化は `PrintModal.tsx`（HTML をブラウザ印刷）。これらは「標準様式」として残す
- 新機能は「様式を導入先ごと・荷主ごとに持ち、PDF と Excel の両方で出す」。**Excel→PDF の自動変換は不可**（Workers 上に Excel が無い）ので PDF は様式ごとに HTML を1回組む
- 束ね方・呼び名・経費/控除の扱いは出力側で定義。**DB の計算は1本のまま変えない**
- 印鑑・ロゴは会社設定に画像登録（Storage でテナント隔離、Server Action 経由のみ）
- 法的要件（インボイス記載事項の補完、電子帳簿保存法の発行控え保存）は様式より先の土台
- 優先順位: ①土台（控え保存・採番・確定/再発行）→ ②おおば運送1社分 → ③荷主別切替・印鑑・端数設定 → ④メール送付ほか

## 実装計画で決めるべきこと（§9 の再掲）

- おおば運送の様式に必要な項目が既存データで揃うか
- 様式切替キーの置き場所（`companies` / `clients` の拡張範囲）
- Excel 出力ライブラリ（`xlsx` 継続か ExcelJS 追加か。書式保持が要る）
- 発行控えの保存先と 7 年保存の扱い

## 触るときの注意（既存ルール）

- 請求書の書き込みは必ず `utils/invoice-writer.ts` 経由（一意性は部分索引2本）
- 支払通知書の差引支給額は `utils/payment-notice-totals.ts` に集約済み。ここを迂回しない
- 検証は実データではなくダミーデータ（`fixtures`）で行う
- 口座情報・Storage・RLS に触れるので hibiki-security を通す

## 作業環境メモ

- Air から mini で作業: `ssh mini -t '/opt/homebrew/bin/tmux new -A -s hibiki'`、抜けるときは `Ctrl-b` `d`。詳細は `docs/REMOTE_DEV_CHECK.md` §4
- CLI 版とデスクトップ版の Claude を同じリポジトリで同時に動かさない
