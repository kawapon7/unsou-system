# 本番DB切替手順書: hbpnhbsm → hibiki-production (lsgv)

作成: 2026-08-24（ボス決定: 本番は新org の `hibiki-production` で運用する）

## 前提（2026-08-24 実測）

- 現在の本番URL `https://unsou-system.hibiki-app.workers.dev` は**旧DB `hbpnhbsmsuhjyrohpluu`** を向いている（切替未実施のまま）。
- **両DBとも白紙**: hbpnhbsm は 8/21 のフィールドテスト準備で初期化済み（schedules/contractors/companies/issued_documents 全0、users 1件のみ）。lsgv は 8/21 構築時から空。**データ移行は不要 = 切替リスクが最小の今が好機**。
- lsgv には 8/21 時点の57本まで適用済み。**未適用マイグレーション8本**:
  `20260821140000_tighten_rls_3tables` / `20260821153000_fix_function_search_path` / `20260823100000_contractors_is_internal`（⚠️hbpnhbsm では version `20260823010356` で記録されているがファイル名版でOK・IF NOT EXISTS） / `20260823150000_document_issuance_foundation` / `20260823180000_users_tenant_id` / `20260824000000_contractors_apply_transport_insurance` / `20260824010000_companies_seal_image` / `20260824120000_payment_notices_status_default`（statusのDEFAULT付与。現行コードはstatusを書き続けるので適用しても無害）
- リポジトリは lsgv にリンク済み（`supabase/.temp/project-ref`）。ただし **CLI 認証はヘッドレスセッションから通らない**（keychain）。db push はボスのターミナルで実行する。
- Claude は lsgv に到達する手段が無い（MCPは旧orgのみ・DBパスワード不所持）。**lsgv への操作は全てボス実行**、Claude は SQL・コマンドの用意と検証クエリの読み合わせを担当。

## 手順（この順番厳守・1ステップずつ確認）

### Phase 1: lsgv を最新スキーマへ（ボスのターミナル）

1. `cd ~/dev/unsou-system && supabase db push`（リンク先=lsgv。8本が適用予定として並ぶことを確認してから yes）
2. 検証: `supabase migration list --linked` で 65本＝ローカルと1:1一致。
3. 指紋照合: `supabase/schema-fingerprint.sql` を lsgv（SQL Editor）で実行し、hbpnhbsm 側（Claude が MCP で実行）と突合。
   ⚠️ 完全一致は期待しない: hbpnhbsm には `contractors_is_internal` の version ズレ（20260823010356）と `backup_f0` 残骸があるため、**public スキーマのオブジェクト件数・md5 が一致すればOK**。

### Phase 2: lsgv の認証設定（ボス・Supabase ダッシュボード）

4. Auth > URL Configuration: Site URL = `https://unsou-system.hibiki-app.workers.dev`、Redirect URLs に `https://unsou-system.hibiki-app.workers.dev/**` を追加。
5. Auth > Users で管理者ユーザーを作成（メールはボスの実メール推奨。パスワードはボスのみが扱う）。
6. SQL Editor で管理者の紐づけ（Claude が SQL を用意済み・下記）:
   ```sql
   -- <ADMIN_USER_ID> は手順5で作成したユーザーの UUID に置換
   update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb)
     || '{"tenant_id":"00000000-0000-0000-0000-0000000000a1"}'::jsonb
   where id = '<ADMIN_USER_ID>';
   insert into public.users (id, email, role, tenant_id)
   values ('<ADMIN_USER_ID>', '<ADMIN_EMAIL>', 'master', '00000000-0000-0000-0000-0000000000a1');
   ```
   ⚠️ lsgv の `tenants` には A社1行（`...0000a1`）が既に入っている（8/21構築時）。

### Phase 3: シークレット切替（ボスのターミナル）

対象は lsgv の URL / anon key / service_role key。**ENCRYPTION_KEY・GEMINI_API_KEY・RESEND_API_KEY・CRON_SECRET は変更しない**。

7. GitHub secrets（ビルド時焼き込み用）:
   ```
   gh secret set NEXT_PUBLIC_SUPABASE_URL       # → https://lsgvnxiuidvwefihjbcu.supabase.co
   gh secret set NEXT_PUBLIC_SUPABASE_ANON_KEY  # → lsgv の anon key
   ```
8. Worker runtime secrets:
   ```
   cd web
   wrangler secret put NEXT_PUBLIC_SUPABASE_URL
   wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   ```
9. 再デプロイ: `gh workflow run deploy.yml`（または空コミット push）。run success を確認。

### Phase 4: 検証と後片付け

10. 本番URL /login が 200 → ボスがログイン → **自社情報の登録から開始**（未登録のうちは帳票系が fail-closed でエラーになる仕様）。
11. 旧DB hbpnhbsm を**テスト環境**として位置づけ:
    - Supabase Auth の Site URL / Redirect URLs から本番URLを外す（誤ログイン防止）
    - `web/.env.local.prod-backup` は**旧DB向けのため名称を `.env.local.test-backup` に変える**（「prod」の名で残すと将来の事故のもと）
    - 以後のテストはローカル Supabase（第一候補）または hbpnhbsm を使う
12. HANDOVER_MASTER.md の更新（切替完了・テスト環境化・.env の整理を記録）。
13. （任意・後日）lsgv の Pro 化はA社実運用開始のタイミングで。

## 中断時の安全性

Phase 1〜2 は本番挙動に一切影響しない（lsgv はまだどこからも参照されていない）。
ポイントオブノーリターンは **Phase 3 の手順9（再デプロイ）**。それ以前ならいつでも中断可能。
手順9の後に問題が出た場合の巻き戻しは、GitHub secrets と wrangler secrets を hbpnhbsm の値へ戻して再デプロイ（両DB白紙のためデータ不整合は起きない）。
