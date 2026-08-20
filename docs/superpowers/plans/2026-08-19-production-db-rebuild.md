# 新本番DBの構築（切替なし） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新しいSupabase組織・プロジェクトを作り、マイグレーション56本を適用して、現行本番DBとスキーマが完全一致することを機械照合で証明する（切替は行わない）。

**Architecture:** 新DBはマイグレーションから空で生成する。適用は Supabase CLI の `db push`（MCPの `apply_migration` は version を自動採番するため禁止）。検証は「カテゴリ別の件数＋定義文のmd5指紋」を両DBで取り、7カテゴリすべてが一致することをもって完了とする。

**Tech Stack:** Supabase (PostgreSQL 17系), Supabase CLI v2.115.0, Supabase MCP（読み取り照会のみ）

**設計書:** `docs/superpowers/specs/2026-08-19-production-db-rebuild-design.md`

## Global Constraints

以下は全タスクの要件に暗黙的に含まれる。

- **現行本番DB（`hbpnhbsmsuhjyrohpluu` / `unsou-system`）には一切書き込まない。** 読み取り照会のみ。
- **MCP の `apply_migration` を使わない。** マイグレーション適用は Supabase CLI の `supabase db push` のみ。理由: MCPは `schema_migrations` の version を自動採番するため、2026-08-19に是正したファイル名⇔version の1:1一致が新DBで再び崩れる。
- **DBパスワードはボスが入力する。** 値を会話・ログ・ファイル・コミットに残さない。
- **切替に関わるものを一切触らない。** `.env` / `.env.local` / GitHub secrets / `wrangler.toml` / `deploy.yml` は対象外。
- **スキーマ照合の対象は `public` と `internal` の2スキーマのみ。** `backup_f0`（現行DBのF0バックアップ・18テーブル）と Supabase管理スキーマ（`auth` / `storage` / `realtime` / `vault` / `graphql` 等）は除外する。含めると必ず偽の差分が出る。
- **正準テナントUUIDは `00000000-0000-0000-0000-0000000000a1`。** 新規採番しない（マイグレーションが自動で投入する）。
- 組織名の既定値: `hibiki-production-org` / プロジェクト名の既定値: `hibiki-production` / リージョン: `ap-northeast-1`（東京）/ プランは Free で作成する。
- ボスの手作業が必要な箇所は **🙋 ボス作業** と明記してある。そこで実装者の手は止まる。勝手に代替手段へ回らない。

## 2026-08-20 実測で確定した前提の変更（計画作成時からの差分）

Task 1 は完了済み。以下は実行中に判明した事実で、**Task 2 以降の手順を変更する**。

| 項目 | 確定値 |
|---|---|
| 新組織 | `hibiki-production-org`（Free） |
| 新プロジェクト名 | `kawapon7's Project`（⚠️既定名のまま。`hibiki-production` へのリネームは任意・未実施） |
| project ref | `lsgvnxiuidvwefihjbcu`（要確認: link 実行時にrefが違えばエラーになるので、そこで確定する） |
| Region | `ap-northeast-1`（Northeast Asia (Tokyo)）✅ 現行と同一 |
| Status | Healthy / マイグレーション0件 |

### ⚠️ 変更1: MCPから新プロジェクトが見えない

`list_projects` が現行の `unsou-system` 1件しか返さない（2026-08-20実測）。MCPトークンが旧組織にスコープされているため。**Task 2 Step 5・6 と Task 3 の「MCPツール `execute_sql` / `list_migrations` を新プロジェクトに対して実行」は使えない。**

代替手段（動作確認済み）:

```bash
# 任意のSQLを新DBへ流す（--linked は Management API 経由）
npx supabase db query --linked -f supabase/schema-fingerprint.sql

# マイグレーション一覧
npx supabase migration list --linked
```

### ⚠️ 変更2: 先に `supabase login` が要る

CLIが未認証（`LegacyPlatformAuthRequiredError`）。`link` も `db push` も Management API を使うため、ログインが前提になる。

🙋 **ボス作業**: ターミナルで `npx supabase login` を実行する（ブラウザ認証）。アクセストークンはCLIがローカルに保存し、チャットには出ない。

### ⚠️ 変更3: GRANT（GRA）を照合対象に追加した

指紋クエリが**テーブル権限を見ていなかった**。プロジェクト作成時の "Automatically expose new tables" 設定が権限に効くため、ここがズレると**指紋は一致するのにアプリが動かない**。`supabase/schema-fingerprint.sql` に `GRA` カテゴリを追加し、現行DBの基準値（441件）を実測済み。照合カテゴリは7→**8**になった。

---

## 現行本番DBの基準値（2026-08-19 実測・照合の期待値）

| カテゴリ | 件数 | 指紋 (md5) |
|---|---|---|
| TBL | 21 | `7b858a936e5b2ee7719f47e8e1b11dd8` |
| COL | 293 | `2cb386a69f97e024ca8c620185875d06` |
| CON | 97 | `95c543ce858f9b12f9d95936938c87a6` |
| IDX | 67 | `01856d89e73e443d6f71e82dc4834387` |
| POL | 28 | `76355f392068b638b9c6f20c74bf755e` |
| TRG | 7 | `bf6a3e93dd5166dae9db254bdd3ddd8a` |
| FN | 6 | `f702cb6786c0a6d150107408bcb3ea0d` |
| GRA | 441 | `11f1c70a4e78f5a7edabe0dc97d4486b` |

⚠️ この基準値は**現行DBが変わらない限り不変**。もし Task 3 の実行前に現行DBのスキーマを触った場合は、基準値を取り直すこと。

## File Structure

| ファイル | 役割 | 状態 |
|---|---|---|
| `supabase/schema-fingerprint.sql` | スキーマ指紋クエリ。両DBに対して同一のものを流す唯一の正本 | 作成済み（2026-08-19） |
| `supabase/migrations/*.sql`（56本） | 新DBへ流す対象。**本タスクでは1文字も変更しない** | 既存 |
| `docs/HANDOVER_MASTER.md` | 結果の記録 | Task 4 で追記 |

---

### Task 1: 新組織と新プロジェクトを作る

**Files:**
- 変更なし（Supabase側の操作のみ）

**Interfaces:**
- Produces: 新プロジェクトの **project ref**（20文字の英数字）。Task 2・3 がこれを使う。

- [ ] **Step 1: 🙋 ボス作業 — 新組織を作る**

Supabase MCP に組織作成のAPIは無い。ボスがダッシュボードで作成する。

1. https://supabase.com/dashboard を開く
2. 左上の組織セレクタ → `New organization`
3. Name: `hibiki-production-org` / Plan: **Free**（Pro化は実データ投入の直前に行う）
4. 作成完了後、実装者に「作った」と伝える

- [ ] **Step 2: MCPから新組織が見えるか確認する**

MCPツール `list_organizations` を実行。

期待: 組織が2件返り、うち1件が `hibiki-production-org`。

⚠️ **1件しか返らない場合**、MCPトークンが新組織を参照できていない。その場合は Step 3 をMCPで実行できないため、**Step 3-alt**（ダッシュボード手作業）へ進むこと。トークンの再発行を試みない（会話にキーが出るリスクを避ける）。

- [ ] **Step 3: 新プロジェクトを作る（MCPが新組織を見える場合）**

まずコストを確認する。MCPツール `get_cost` に `type: "project"` と新組織のIDを渡す。

期待: `amount: 0` / `recurrence: "monthly"`。**0でなければ止まってボスに確認する。**

次に `confirm_cost` でコストIDを取得し、`create_project` を実行する。

- name: `hibiki-production`
- organization_id: 新組織のID
- region: `ap-northeast-1`
- confirm_cost_id: `confirm_cost` が返した値

- [ ] **Step 3-alt: 🙋 ボス作業 — ダッシュボードで新プロジェクトを作る（MCPが新組織を見えない場合のみ）**

1. 新組織を選択した状態で `New project`
2. Name: `hibiki-production` / Region: `Northeast Asia (Tokyo)` / Plan: Free
3. Database Password はボスが決めて**ボス自身が保管する**（会話に貼らない）
4. 作成完了後、URLに含まれる project ref（`https://supabase.com/dashboard/project/<ここ>`）を実装者に伝える

- [ ] **Step 4: 新プロジェクトが起動したことを確認する**

MCPツール `list_projects` を実行。

期待: 新プロジェクトの `status` が `ACTIVE_HEALTHY`、`region` が `ap-northeast-1`。

⚠️ 作成直後は `COMING_UP` の場合がある。その場合は1〜2分待って再実行する。`ACTIVE_HEALTHY` になるまで Task 2 へ進まない。

- [ ] **Step 5: PostgreSQLのメジャーバージョンを記録する**

`list_projects` の結果に含まれる `database.version` を控える。

現行は `17.6.1.127`（メジャー17）。**新DBのメジャーが17でない場合**、Task 3 の指紋が定義文のレンダリング差で不一致になる可能性がある。その場合の判定手順は Task 3 Step 4 に書いてある。ここでは記録するだけで、止まらなくてよい。

- [ ] **Step 6: コミットは無し**

このタスクはリポジトリのファイルを変更しない。コミットするものは無い。

---

### Task 2: マイグレーション56本を新DBへ適用する

**Files:**
- 変更なし（`supabase/migrations/*.sql` は読むだけ。**1文字も変更しない**）

**Interfaces:**
- Consumes: Task 1 の project ref
- Produces: 新DBの `supabase_migrations.schema_migrations` に56件

- [ ] **Step 1: 適用前の状態を確認する**

ローカルのマイグレーション本数を数える。

```bash
ls supabase/migrations/*.sql | wc -l
```

期待: `56`

⚠️ 56でなければ、リポジトリの状態が計画作成時（2026-08-19）と違う。**そのまま進めず**、差分の理由を確認すること。

- [ ] **Step 2: 新プロジェクトへ link する**

```bash
npx supabase link --project-ref <Task 1 の project ref>
```

🙋 **ボス作業**: DBパスワードの入力を求められる。ボスが入力する（画面には表示されない）。

⚠️ `--password` オプションでコマンドラインに渡さないこと。シェル履歴に残る。

- [ ] **Step 3: 何が流れるかを先に見る（dry run）**

```bash
npx supabase db push --dry-run
```

期待: 56本のファイル名が「これから適用される」として列挙される。

⚠️ **ここで0本と出たら止まる。** link 先が現行DBになっている可能性がある（現行DBは既に56本適用済みなので0本と出る）。`supabase/.temp/project-ref` の中身が新DBのrefか確認すること。**現行DBに push すると Global Constraints 違反になる。**

- [ ] **Step 4: 適用する**

```bash
npx supabase db push
```

期待: 56本すべてが `Applied` で終わる。エラーで止まった場合は、そのファイル名とエラーを記録して停止する（新DBは空なので、最悪プロジェクトごと作り直せる。$0・不可逆でない）。

- [ ] **Step 5: 56件入ったことを確認する**

MCPツール `list_migrations` を新プロジェクトに対して実行。

期待: 56件。かつ version がローカルのファイル名と一致していること。特に以下の5本が **`20260805113852`〜`20260805113940`** で入っていること（`20260804010000` 系になっていたら CLI ではなく MCP で入れてしまっている）。

```
20260805113852 create_tenants
20260805113901 companies_tenant_id_to_uuid
20260805113916 add_tenant_id_missing_tables
20260805113929 tenant_id_text_to_uuid
20260805113940 tenant_id_constraints
```

- [ ] **Step 6: テナント行が入ったことを確認する**

MCPツール `execute_sql` を新プロジェクトに対して実行。

```sql
select id, name from public.tenants;
```

期待: 1行。`id` = `00000000-0000-0000-0000-0000000000a1`、`name` = `A社`。

マイグレーション `20260805113852_create_tenants.sql` が自ら投入するため、手で入れる必要は無い。

- [ ] **Step 7: link を現行DBへ戻さない**

⚠️ このまま次のタスクへ進む。`supabase link` を現行DBへ張り直す作業は**不要**であり、やると誤って push する事故の温床になる。切替作業（別セッション）でも link の張り替えは行わない。

- [ ] **Step 8: コミットは無し**

このタスクもリポジトリのファイルを変更しない。

---

### Task 3: スキーマを機械照合する（完了条件）

**Files:**
- 使用: `supabase/schema-fingerprint.sql`（両DBへ流す唯一の正本）

**Interfaces:**
- Consumes: Task 1 の project ref、Global Constraints の基準値表

- [ ] **Step 1: 新DBの指紋を取る**

MCPツール `execute_sql` を**新プロジェクト**に対して実行する。クエリは `supabase/schema-fingerprint.sql` の中身をそのまま貼る。

```bash
cat supabase/schema-fingerprint.sql
```

- [ ] **Step 2: 基準値と突き合わせる**

Task 1〜2 で作った新DBの結果と、Global Constraints の「現行本番DBの基準値」表を比較する。

**8カテゴリすべてで「件数」と「指紋」が一致すれば完了。**

| カテゴリ | 期待件数 | 期待指紋 |
|---|---|---|
| TBL | 21 | `7b858a936e5b2ee7719f47e8e1b11dd8` |
| COL | 293 | `2cb386a69f97e024ca8c620185875d06` |
| CON | 97 | `95c543ce858f9b12f9d95936938c87a6` |
| IDX | 67 | `01856d89e73e443d6f71e82dc4834387` |
| POL | 28 | `76355f392068b638b9c6f20c74bf755e` |
| TRG | 7 | `bf6a3e93dd5166dae9db254bdd3ddd8a` |
| FN | 6 | `f702cb6786c0a6d150107408bcb3ea0d` |
| GRA | 441 | `11f1c70a4e78f5a7edabe0dc97d4486b` |

- [ ] **Step 3: 一致した場合 — 不変トリガーとFKを個別に確認する**

指紋一致で論理的には保証されるが、事故ったときの被害が大きい2点だけ名指しで確認する。新プロジェクトに対して `execute_sql`:

```sql
select r.relname, t.tgname
from pg_trigger t
join pg_class r on r.oid = t.tgrelid
where not t.tgisinternal
  and r.relname in ('approval_history','notification_logs')
order by 1,2;
```

期待: 4行（`approval_history` 2本・`notification_logs` 2本＝UPDATE拒否とDELETE拒否）。

```sql
select count(*) as tenant_fks
from pg_constraint c
join pg_class r on r.oid = c.confrelid
where c.contype = 'f' and r.relname = 'tenants';
```

期待: `18`。

- [ ] **Step 4: 不一致だった場合 — 差分を特定する**

**切替に進まない。** 不一致のカテゴリだけを掘る。以下は COL の例。`k` の値を不一致だったカテゴリに読み替える。

新DBと現行DBの両方で、そのカテゴリの明細を取る。

```sql
-- COL の明細（不一致カテゴリに応じて select を差し替える）
select table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'-') s
from information_schema.columns
where table_schema in ('public','internal')
order by 1;
```

両方の結果をファイルへ落として `diff` する。

```bash
diff /path/to/current.txt /path/to/new.txt
```

判定:

- **差分が「マイグレーションに存在しない定義」だった** → 現行DBがダッシュボード先行で作られた名残。2026-07-27 に同じ事象で15列見つかっている。新しいマイグレーションで追認し、両DBへ適用する。
- **差分が「型名や定義文の書き方だけ違う」** → Task 1 Step 5 で記録した PostgreSQL メジャーバージョンが現行（17）と違う場合、レンダリング差の可能性がある。この場合は**指紋ではなく明細のdiffを人が読んで**、意味が同じかどうかで判定する。意味が同じなら合格とし、その旨を Task 4 の記録に残す。
- **差分が「新DBに無い」** → マイグレーションの適用漏れ。Task 2 Step 4 のログを確認する。

- [ ] **Step 5: コミットは無し**

このタスクもリポジトリのファイルを変更しない。記録は Task 4 でまとめて行う。

---

### Task 4: 指紋クエリと結果を記録してコミットする

**Files:**
- Create: `supabase/schema-fingerprint.sql`（作成済み。未コミットならこのタスクでコミットする）
- Modify: `docs/HANDOVER_MASTER.md`

- [ ] **Step 1: 指紋クエリが未コミットなら確認する**

```bash
git status --porcelain supabase/schema-fingerprint.sql
```

- [ ] **Step 2: HANDOVER_MASTER.md に結果を追記する**

`docs/HANDOVER_MASTER.md` の §5-2 のタスク表（`| 優先度 | タスク | 詳細 |` の表）に行を追加する。最新の完了行の直前に挿入する。

記録する内容（実測値で埋めること。推測で書かない）:

- 新組織名・新プロジェクト名・project ref・region・PostgreSQLバージョン
- マイグレーション適用本数（期待56）と、CLI `db push` を使った旨
- 指紋照合の結果（7カテゴリ一致 / 不一致があった場合はその内容と判定根拠）
- 不変トリガー4本・tenants FK 18本の確認結果
- ⚠️ **切替は未実施**であること、本番URLは現行DBを向いたままであること
- 次にやること（A社実マスタの収集 → 投入 → 認証ユーザー作成 → 切替 → Pro化）

- [ ] **Step 3: 🔒 hibiki-security ゲートを通す**

git commit 前は必ず通す。3ステップ:

```bash
git status --porcelain
```
→ `.next/` `.open-next/` が無いこと

```bash
git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"
```
→ 空であること

⚠️ **DBパスワードと project ref に注意。** project ref は公開情報（URLに出る）なので記録してよい。**DBパスワードは絶対に書かない。**

- [ ] **Step 4: ファイルを明示してコミットする**

`git add .` は使わない。

```bash
git add supabase/schema-fingerprint.sql docs/HANDOVER_MASTER.md
git commit -m "chore(db): 新本番DBを構築しスキーマ一致を機械照合（切替は未実施）"
```

- [ ] **Step 5: push はボスの指示を待つ**

`web/**` を含まないため自動デプロイは走らないが、勝手に push しない。

---

## Self-Review

**Spec coverage:**

| 設計書の節 | 対応タスク |
|---|---|
| §2 スコープ（やる4項目） | Task 1（1・2）、Task 2（3）、Task 3（4） |
| §3-1 工程③削除 | 計画に③が存在しないことで反映。Task 4 Step 2 で「次にやること」に実マスタ収集を記録 |
| §3-2 CLI必須 | Global Constraints ＋ Task 2 Step 3-5（MCPで入れた場合を検知する確認を含む） |
| §3-3 テナント行seed不要 | Task 2 Step 6 |
| §3-4 新組織に作る | Task 1 Step 1・2（MCPで組織作成できない件を含む） |
| §4 新プロジェクト構成 | Task 1 Step 3・3-alt（名前・region・プラン） |
| §5 完了条件（機械照合） | Task 3 全体。①schema_migrations 56件 = Task 2 Step 5 ②オブジェクト照合 = Task 3 Step 2 ③不変トリガー = Task 3 Step 3 ④tenants FK18 = Task 3 Step 3 |
| §6 リスクと安全策 | Global Constraints ＋ Task 2 Step 3（誤push検知）・Step 7（link張り替え禁止）・Task 4 Step 3 |
| §7 残るもの | Task 4 Step 2 の記録項目 |

⚠️ 設計書 §5 は「行数は一致しない、照合対象はスキーマであってデータではない」としている。本計画の指紋クエリはスキーマ定義のみを対象とし、行数を一切見ていないため整合している。

**Placeholder scan:** 「適切に」「必要に応じて」等の曖昧な指示なし。全ステップに実行するコマンドかSQLの実体を記載済み。`<Task 1 の project ref>` は実行時にしか決まらない値であり、プレースホルダではなく引数。

**Type consistency:** カテゴリ記号（TBL/COL/CON/IDX/POL/TRG/FN）は `supabase/schema-fingerprint.sql`・基準値表・Task 3 Step 2 の期待値表で同一。project ref の受け渡しは Task 1 Produces → Task 2/3 Consumes で一貫。

**未検証の箇所（正直な記載）:** Task 1 Step 2 の「MCPトークンが新組織を見えるか」、および Task 2 の `db push` の実行結果は、新組織が存在しないため事前検証できていない。**未検証**。それ以外（指紋クエリ・基準値・マイグレーション56本・CLI v2.115.0 の存在）は 2026-08-19 に実測済み。
