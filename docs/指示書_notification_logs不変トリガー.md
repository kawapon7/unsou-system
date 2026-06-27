# 指示書：notification_logs 不変性トリガー追加（マイグレーション作成のみ）

> 実装担当：Cursor（Sonnet 4.6）
> この指示書は単体で完結している。前提知識なしで実行できるよう書いてある。前置き・要約は不要、指示通りに実装すること。

---

## 0. 背景（必読・この前提が崩れると危険）

- 本アプリ（Next.js + Supabase）の **DBアクセスは全て Server Actions 経由で `service_role` キーを使用**している。`service_role` は **RLS（行レベルセキュリティ）を常にバイパス**する。
- `notification_logs` は「**INSERTのみ許可・UPDATE/DELETE禁止の不変ログ**」設計（CLAUDE.md §2.4「不変ログの保護」）。
- ところが現状、その不変性は **「UPDATE/DELETEポリシーを未定義にして RLS で拒否」する前提のみ**で担保されている（マイグレーション `20260613000000_add_schedules_and_notification_logs.sql` のコメント参照）。
- **これは穴**：`service_role` は RLS をバイパスするため、Server Actions からの `UPDATE` / `DELETE` が素通りしてしまう。RLS では不変性を担保できない。
- 同じ不変ログである `approval_history` は、**RLSではなくトリガー**で UPDATE/DELETE を物理的に禁止している（`20260613000001_approval_history_immutability_triggers.sql`）。`notification_logs` も**同パターンのトリガーで担保する**。これが本タスク。

---

## 1. タスク

`supabase/migrations/` に **マイグレーションSQLファイルを1本だけ新規作成する**。内容は「`notification_logs` への `UPDATE` / `DELETE` を全ロールに対しトリガーで禁止する」こと。

**重要：このタスクで実DBへの適用（push / `supabase db push` / SQL直接実行）は行わない。ファイル作成のみ。** 適用は人間が別途行う（RLS step③の本番適用と同時反映する想定）。

---

## 2. 厳守事項（違反するとアプリ不具合 or 穴残置）

1. **`notification_logs` 以外のテーブルに触れない。** 既存トリガー（`approval_history` の `trg_approval_history_no_*`、`schedules` の `trg_schedules_updated_at` 等）を削除・変更しない。
2. **INSERT は禁止しない。** トリガーは `BEFORE UPDATE` と `BEFORE DELETE` のみ。INSERT を縛ると Server Actions のログ書込みが全断する。
3. **RLSポリシーは追加・変更・削除しない。** 本タスクはトリガーのみ。RLS は別マイグレーション（`20260627000000_rls_tighten_5tables.sql`）の管轄。
4. **関数名・トリガー名は下記の指定どおりにする**（`approval_history` の命名規則に合わせる）。
5. `CREATE OR REPLACE FUNCTION` と `DROP TRIGGER IF EXISTS` を使い、**再実行（冪等）しても壊れないようにする**。
6. 自動生成物（`.next/` `.open-next/` 等）や `.env*` を絶対にコミットに巻き込まない。`git add` は対象ファイルを明示し、実行後 `git status` で目視確認すること。

---

## 3. 実装手順

### 3-1. （任意・推奨）参考にする既存ファイルを読む
`supabase/migrations/20260613000001_approval_history_immutability_triggers.sql` を読み、同じ構造で `notification_logs` 版を作る。

### 3-2. マイグレーションファイル作成
- パス：`supabase/migrations/20260627000001_notification_logs_immutability_triggers.sql`
  （命名は既存慣習＝`YYYYMMDDHHMMSS_説明.sql`。RLS step② が `20260627000000_*` なのでそれより後の `20260627000001` とする。衝突する場合のみ連番をずらす）
- 内容は**以下をそのまま使用**：

```sql
-- ================================================================
-- notification_logs 不変性トリガー
-- ----------------------------------------------------------------
-- 背景:
--   notification_logs は「不変ログ（INSERTのみ）」設計だが、これまで
--   UPDATE/DELETE ポリシー未定義（RLS deny）のみで担保していた。
--   しかし Server Actions は service_role を多用しており、service_role は
--   RLS をバイパスするため UPDATE/DELETE が素通りしてしまう。
--   approval_history（20260613000001）と同様、RLSではなくトリガーで
--   全ロールに対し UPDATE/DELETE を物理的に禁止する。
--   ※ CLAUDE.md §2.4「不変ログの保護」準拠。
-- ================================================================

-- UPDATE/DELETE 禁止関数
CREATE OR REPLACE FUNCTION prevent_notification_logs_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '通知ログ（notification_logs）の変更・削除は禁止されています。';
END;
$$;

-- 既存トリガーが存在する場合は上書き
DROP TRIGGER IF EXISTS trg_notification_logs_no_update ON notification_logs;
DROP TRIGGER IF EXISTS trg_notification_logs_no_delete ON notification_logs;

CREATE TRIGGER trg_notification_logs_no_update
  BEFORE UPDATE ON notification_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_notification_logs_modification();

CREATE TRIGGER trg_notification_logs_no_delete
  BEFORE DELETE ON notification_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_notification_logs_modification();
```

---

## 4. 完了条件（このタスクのDone）

- [ ] `supabase/migrations/20260627000001_notification_logs_immutability_triggers.sql` が上記内容で存在する。
- [ ] 他ファイル（マイグレーション含む）への変更が無い（`git status` で新規1ファイルのみ）。
- [ ] 実DBへの適用（push / db push / SQL実行）は**していない**。

---

## 5. 適用時の検証（人間が後で実施・参考情報。Cursorは実行不要）

適用後、Supabase SQL Editor で以下を確認：
```sql
-- トリガーが2本存在することを確認
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.notification_logs'::regclass
  AND tgname IN ('trg_notification_logs_no_update','trg_notification_logs_no_delete');
-- → 2行返ればOK
```
動作確認（service_role / SQL Editor で UPDATE が弾かれること）：
```sql
-- 既存行が無ければ先にテスト行をINSERTしてから試す。例外が出れば成功。
UPDATE notification_logs SET status = 'failed' WHERE id = '<任意のid>';
-- → ERROR: 通知ログ（notification_logs）の変更・削除は禁止されています。 が出ればOK
```

### 注意
- トリガーは `service_role` にも効くが、**superuser が `session_replication_role = 'replica'` を設定すると無効化**される（`approval_history` と同じ前提・通常運用では問題なし）。
