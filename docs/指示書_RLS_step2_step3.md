# 指示書：RLS強化マイグレーション作成（step②）＋適用手順（step③）

> 実装担当：Cursor（Sonnet 4.6）
> この指示書は単体で完結している。前提知識なしで実行できるよう書いてある。前置き・要約は不要、指示通りに実装すること。

---

## 0. 背景（必読・この前提が崩れると危険）

- 本アプリ（Next.js + Supabase）の**DBアクセスは全て Server Actions 経由で `service_role` キーを使用**している。`service_role` は **RLS（行レベルセキュリティ）を常にバイパス**する（ポリシーの有無に関わらず全行アクセス可）。
- 直前の改修で、対象5テーブルへの「RLSクライアント（cookieセッション/anonキー）直読み」は**全廃済み**（唯一残っていた `fetchMyProjects` を `service_role` 化済み）。**ブラウザからのDB直クエリも存在しない**。
- 従って、対象5テーブルの RLS ポリシーは**現在アプリ機能に一切関与していない**。にもかかわらず `USING (true)`（＝誰でも全行アクセス可）の緩いポリシーが残っており、これは「鍵をかけたフリ」のセキュリティホール。
- **結論：対象5テーブルのポリシーを全削除して deny-by-default にしても、`service_role` 経由のアプリは無影響。消えるのは穴だけ。**

### 対象5テーブル（これ以外は触らない）
```
contractors
expense_records
schedules
notification_logs
driver_project_assignments
```

---

## 1. タスク

`supabase/migrations/` に**マイグレーションSQLファイルを1本だけ新規作成する**。内容は「対象5テーブルの既存ポリシーを全削除し、RLSを有効のまま deny-by-default にする」こと。

**重要：このタスクで実DBへの適用（push/db push/SQL実行）は行わない。ファイル作成のみ。** 適用は人間が step③ の手順で行う。

---

## 2. 厳守事項（違反するとアプリ全断 or 穴残置）

1. **対象5テーブル以外のポリシーを変更しない**（特に `projects` / `clients` / `invoices` / `work_records` / `payment_notices` / `approval_history` には触れない。これらは別途検討対象）。
2. **`FORCE ROW LEVEL SECURITY` を使わない**。`ENABLE` のみ。（FORCE はテーブル所有者にもRLSを強制し、運用ロール次第で `service_role` 以外の管理経路を阻害しうるため）
3. **トリガーを削除・変更しない**。`notification_logs` は「INSERTのみ許可・UPDATE/DELETE禁止」の不変ログであり、これは**トリガーで担保**する設計（RLSでは `service_role` を縛れないため）。RLSポリシー削除はトリガーに影響しないが、トリガー定義には一切触れないこと。
4. **deny-by-default の意味**：RLSが有効かつポリシーが0件なら、`anon`/`authenticated` ロールは全アクセス拒否、`service_role` のみ（バイパスで）アクセス可。これが目標状態。新規ポリシーは**作らない**（最小権限＝ゼロ）。
5. **マイグレーション全体を `BEGIN; ... COMMIT;` で囲む**（途中失敗時に中途半端な適用を防ぐ）。
6. 自動生成物（`.next/` `.open-next/` 等）や `.env*` を絶対にコミットに巻き込まない。

---

## 3. 実装手順

### 3-1. （任意・推奨）現行ポリシーの確認
Supabase SQL Editor で以下を実行し、削除対象の現状を把握してよい（実装の確認用。アプリには影響しない読み取り専用クエリ）。
```sql
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('contractors','expense_records','schedules','notification_logs','driver_project_assignments')
ORDER BY tablename, policyname;
```

### 3-2. マイグレーションファイル作成
- パス：`supabase/migrations/20260627000000_rls_tighten_5tables.sql`
  （命名は既存慣習＝`YYYYMMDDHHMMSS_説明.sql`。既存の最新が `20260624000001_*` なのでそれより後のタイムスタンプにすること。衝突する場合は連番をずらす）
- 内容は以下の通り。**ポリシー名を列挙せず、`pg_policies` を走査して対象5テーブルの全ポリシーを動的に削除する**（過去マイグレーションでポリシー名が乱立しており、列挙だと取りこぼすため）。

```sql
-- RLS強化: 対象5テーブルを deny-by-default 化（USING(true) 等の緩いポリシーを全廃）。
-- 前提: アプリのDBアクセスは全て service_role 経由（RLSバイパス）。よってポリシー全削除でも機能影響なし。
-- service_role はRLSを常にバイパスするため、本マイグレーションで service 用ポリシーは不要。

BEGIN;

-- ① 対象5テーブルの既存ポリシーを全削除（名前は動的に取得）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'contractors',
        'expense_records',
        'schedules',
        'notification_logs',
        'driver_project_assignments'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ② RLSを有効化（ポリシー0件 ＝ anon/authenticated は全拒否、service_role のみバイパスで可）
ALTER TABLE public.contractors                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_records            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_project_assignments ENABLE ROW LEVEL SECURITY;

COMMIT;
```

### 3-3. ロールバック用SQLをコメントで併記
同ファイル末尾に、緊急時に緩いポリシーを一時復活させる逆操作を**コメントアウトで**残す（実行はしない）。
```sql
-- ===== ROLLBACK（緊急時のみ手動実行）=====
-- BEGIN;
-- CREATE POLICY "tmp_allow_all" ON public.contractors                FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "tmp_allow_all" ON public.expense_records            FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "tmp_allow_all" ON public.schedules                  FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "tmp_allow_all" ON public.notification_logs          FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "tmp_allow_all" ON public.driver_project_assignments FOR ALL USING (true) WITH CHECK (true);
-- COMMIT;
```

---

## 4. 完了条件（この指示の達成基準）

- [ ] 上記1ファイルのみ新規作成されている（他ファイル変更なし）。
- [ ] `BEGIN/COMMIT` で囲まれ、`FORCE` を使っていない。
- [ ] 新規 `CREATE POLICY` が（ROLLBACKコメント以外に）存在しない＝deny-by-default。
- [ ] **実DBへは未適用**。
- [ ] `git add` は当該SQLファイルのみ明示指定。コミットメッセージ例：
      `feat: RLS強化 対象5テーブルをdeny-by-default化（USING(true)撲滅）`
      （コミット前に `git status` で `.next/`・`.open-next/`・`.env*` が含まれないことを目視確認）

---

## 5. 適用手順（step③・人間が実施。Cursorは実行しないこと）

> ⚠️ 本番DBに触れる操作。必ず以下の順で行う。

1. **バックアップ取得**：Supabase ダッシュボード → Database → Backups でスナップショット作成（または PITR 確認）。
2. **ステージングで先行検証**：Supabase の Branch DB（または本番スナップショットの復元先）に対し本マイグレーションを適用し、下記スモークテストを全てパス確認。
3. **本番適用**：`supabase db push`（またはダッシュボードSQL Editorで本ファイルの中身を実行）。
4. **適用後スモークテスト（各1回・全画面が正常表示されること）**：
   - 親分：ダッシュボード／案件カレンダー／売上(IN)／支払(OUT)／収支ビュアー／取引先マスタ／予定アラート
   - 子分：予定カレンダー（schedules読み書き）／稼働記録登録／立替金登録／支払通知書の確認・承認
   - 特に **schedules / driver_project_assignments / expense_records** に依存する子分カレンダーと立替金は重点確認。
5. **異常時**：本ファイル末尾の ROLLBACK ブロックを実行して緩いポリシーを一時復活 → 原因調査。

### 適用後の確認クエリ（ポリシーが0件になったか）
```sql
SELECT tablename, count(*) AS policy_count
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('contractors','expense_records','schedules','notification_logs','driver_project_assignments')
GROUP BY tablename;
-- 期待結果：5テーブルとも 0 件（または行が返らない）
```

---

## 6. 補足・次の論点（このタスクの範囲外。やらないが認識しておくこと）

- `notification_logs` / `approval_history` の不変性（UPDATE/DELETE禁止）は**トリガーで担保**する必要がある（`service_role` はRLSを無視するため）。トリガーが未設定なら別タスクで追加検討。
- 対象5テーブル以外（`projects` 等）にも `createClient()`（RLSクライアント）直読みが一部残存（`createProject` / `fetchClientOptions` 等）。それらのテーブルをRLS強化する場合は、先に service_role 化が必要（本タスクの対象外）。
