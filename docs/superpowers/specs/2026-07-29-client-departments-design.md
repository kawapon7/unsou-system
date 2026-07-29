# 取引先の部署分割対応 ＋ 請求書書き込みの一本化 設計書

作成日: 2026-07-29
ステータス: 設計確定（実装計画は未作成）

---

## 1. 背景

### 1-1. 発端

取引先（株式会社エス.アール.シー）が、**同一会社でありながら部署ごとに請求書を分けて提出**することを求めている。

- 「人材派遣部」からの案件（協和冷蔵デバンニング作業・好川商通 安佐北区飯室荷役作業）
- 「運送事業部」からの案件

現状の HIBIKI は `clients` 1行 = 1請求先という前提で、請求書は「荷主 × 対象月」で1枚しか作れない。部署単位で分けられない。

### 1-2. ボスの方針

- 取引先のスタイルに合わせる方針。今後も違った形式が出る可能性がある
- 取引会社は成長とともに部署追加が十分あり得る。部署分割の有無は**後から変更可能**にする
- 「取引会社の成長を加速させるのも委託業者の務め」

### 1-3. 参照した実物サンプル

`ooba/` ディレクトリ（未コミット）に実データあり:

| ファイル | 内容 |
|---|---|
| `請求書 (株)エス.アール.シー2026年6月分 (2).pdf` | 実際に提出している請求書。宛名は「株式会社エス.アール.シー 御中」（**部署名なし**） |
| `協和冷蔵　2026年　デバンニング作業人員結果表 (1).xlsx` | 請求書の補足資料。日別の人員配置表（①②の2名体制・コンテナ本数） |
| `IMG_6712.PNG` | 会社の角印画像 |

---

## 2. スコープ

### 2-1. 本設計書が扱う範囲

1. `clients` に部署の概念を追加する（`client_departments` テーブル新設）
2. 部署分割の有無を切り替えるフラグと、その切替時の挙動
3. 請求書を部署単位で分けて生成できるようにする
4. `invoices` への書き込み4経路を1つの窓口に集約する
5. 上記に伴って発見された既存バグ3件の修正

### 2-2. 本設計書が扱わない範囲（別タスク）

以下はボスとの分解合意により、**それぞれ別の設計書**とする:

| 別タスク | 概要 |
|---|---|
| 日別配置表（Excel）の自動生成 | ドライバーカレンダーから協和冷蔵形式の人員配置表を自動入力。①②の2名体制・表示順固定 |
| 請求書テンプレートの取引先別カスタマイズ | 実物レイアウトの再現・角印の埋め込み・案件によってドライバー名を出す/出さない |
| 未使用の重複ファイル `pdfActions.ts` の整理 | 2026-07-29から未着手のまま残存 |

### 2-3. 単価の違いへの対応（スキーマ変更なしで決着）

当初「同一案件内で作業区分ごとに別単価」（協和冷蔵の「1本」13,000円 / 「2本」16,000円）に対応するため
`project_payees` の単価モデル拡張が必要と考えたが、**ボス判断により案件を名前で分ける運用とする。**

- 「協和冷蔵デバンニング作業 1本」「協和冷蔵デバンニング作業 2本」を**別の案件として登録**する
- 現行の「1案件 = 1単価」モデルがそのまま使える
- **スキーマ変更・コード変更ともに不要**

---

## 3. データモデル

### 3-1. 新テーブル `client_departments`

```sql
CREATE TABLE client_departments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name         text NOT NULL,           -- 「人材派遣部」「運送事業部」
  contact_name text,
  email        text,
  phone        text,
  sort_order   int  NOT NULL DEFAULT 0, -- 画面・帳票の並び順
  tenant_id    text NOT NULL DEFAULT 'local-dev',
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE client_departments ENABLE ROW LEVEL SECURITY;
-- アクセスは全て Server Actions のサービスロール経由（CLAUDE.md の規約）
CREATE POLICY "service role full access" ON client_departments FOR ALL USING (true) WITH CHECK (true);
```

**⚠️ `tenant_id` は必ず `text` にする。`uuid` にしてはならない。**
2026-07-26 に `driver_project_assignments` を `uuid` で作って本番の保存が必ず失敗した事故と同型
（HANDOVER §5-2）。既存テーブルは全て `text` + `'local-dev'` である。

`ON DELETE RESTRICT`（`clients` → `client_departments`）は、部署がぶら下がった荷主を誤って
消せなくするため。

### 3-2. 既存テーブルへの追加

```sql
-- 部署分割を使うかどうかのフラグ
ALTER TABLE clients ADD COLUMN use_departments boolean NOT NULL DEFAULT false;

-- 案件がどの部署に属するか
ALTER TABLE projects ADD COLUMN department_id uuid REFERENCES client_departments(id) ON DELETE SET NULL;

-- 請求書がどの部署のものか
ALTER TABLE invoices ADD COLUMN department_id uuid REFERENCES client_departments(id) ON DELETE RESTRICT;
```

`invoices` 側を `ON DELETE RESTRICT` にするのは、**確定済み請求書がぶら下がっている部署を
消せなくする**ため。取引先に提出した紙の根拠が消えるのを防ぐ。

すべて nullable / DEFAULT 付きの追加のみ。**既存データの移行は不要**（既存の荷主・案件・請求書は
`department_id = NULL`・`use_departments = false` のまま従来どおり動く）。

### 3-3. 採用しなかった案

**案B: `clients.parent_client_id` の自己参照で部署も `clients` の行にする** — 却下

ボスへの確認の結果、**部署ごとに異なるのは担当者・連絡先のみ**で、締め日・支払サイト・振込先口座・
インボイス登録番号・税区分はすべて会社で共通と判明した。案Bだとこれらが部署ごとに複製され、
共通のはずの値がズレる。さらに会社単位の集計がすべて `COALESCE(parent_client_id, id)` になり、
既存の集計クエリを全面的に書き換える必要が出る。利点がない。

**案C: `projects.billing_group` にテキスト欄を追加するだけ** — 却下

テーブル追加ゼロで最軽量だが、担当者名の置き場がなく要件を満たさない。また自由入力のグループキーは
表記ゆれで幽霊請求グループを生む。

---

## 4. 一意性制約の張り替え（本設計で最も慎重を要する箇所）

### 4-1. 問題

2026-07-28 に `20260728070404_invoices_unique_client_month.sql` で
**`UNIQUE(client_id, invoice_month)`** を追加した（二重請求の防止のため）。

部署分割とは**正面から衝突する**。同一荷主・同一月に「人材派遣部」「運送事業部」の2枚を作ろうとすると、
2枚目が `23505 duplicate key` で弾かれる。

### 4-2. 対応

既存の制約を削除し、部分ユニークインデックス2本に張り替える。

```sql
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_client_id_invoice_month_key;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_uniq_with_dept
  ON invoices (client_id, department_id, invoice_month)
  WHERE department_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_uniq_no_dept
  ON invoices (client_id, invoice_month)
  WHERE department_id IS NULL;
```

**⚠️ 単純に `UNIQUE(client_id, department_id, invoice_month)` と書いてはならない。**
PostgreSQL の UNIQUE 制約は NULL 同士を「別物」とみなす（NULLS DISTINCT がデフォルト）ため、
部署を持たない荷主（`department_id IS NULL`）の請求書が同じ月に何枚でも作れてしまう。
部分インデックス2本に分けることで、PostgreSQL のバージョンに依存せず確実に防げる。

### 4-3. 制約削除の副作用

`finalizeInvoice`（`web/src/app/_actions/billing-actions.ts:151`）は
`{ onConflict: 'client_id,invoice_month' }` を指定した upsert を使っている。
**制約を削除するとこの upsert は `42P10 no unique constraint matching` で失敗する。**

→ §5 の共通ライタ（SELECT → UPDATE / INSERT 方式）へ移行することで解消する。
制約の張り替えとライタの移行は**同一の変更として扱い、片方だけ先に本番へ出さない**こと。

---

## 5. `invoices` 書き込みの一本化

### 5-1. 現状: 4経路に分裂している

| # | 関数 | 場所 | 方式 | 金額の決め方 | status | tenant_id |
|---|---|---|---|---|---|---|
| 1 | `finalizeInvoice` | `_actions/billing-actions.ts:151` | upsert (onConflict) | 稼働実績から自動計算 | `draft` | ❌ 未指定 |
| 2 | `saveClientScanResult` | `_actions/scan-actions.ts:89` | insert | AI読取値 | `draft` | ✅ |
| 3 | `upsertInvoice` | `admin/sales/actions.ts:406/424` | SELECT→UPDATE/INSERT | 稼働実績から自動計算 | `issued` | ❌ 未指定 |
| 4 | `commitManualInvoice` | `admin/sales/actions.ts:739` | insert | 手入力 | `draft` | ✅ |

**金額の決め方が4つとも異なる。** ここは本来別々であるべきで、統合してはならない。
共通なのは「DBへ書き込む」最終段のみ。

この分裂が原因で、同型のバグが3回発生している（2026-07-27 支払通知書 / 07-28 請求書 / 07-29 target_month）。

### 5-2. 方針: 計算は分けたまま、書き込みだけ集約する

新規ファイル `web/src/utils/invoice-writer.ts`（仮称）に、書き込み専用の関数を1つ置く。

```ts
export type InvoiceWritePayload = {
  clientId:     string
  departmentId: string | null
  yearMonth:    string          // 'YYYY-MM'
  subtotal:     number          // 税抜合計
  taxAmount:    number          // 消費税額
  totalAmount:  number          // 税込合計
  status:       'draft' | 'issued' | 'paid'
  dueDate:      string | null
  issuedAt:     string | null
  tenantId:     string          // ⚠️ 必須。DEFAULT 依存をやめる（F0テナント分離への布石）
}

export async function writeInvoice(
  service: SupabaseClient,
  payload: InvoiceWritePayload,
): Promise<{ id: string | null; error: string | null }>
```

**この関数が保証すること:**

1. NOT NULL・DEFAULT なしの旧列（`target_month` / `total_amount_ex_tax` / `total_tax`）を
   新列（`invoice_month` / `total_tax_excluded` / `consumption_tax`）と**必ず同値で**埋める
2. 既存行の判定を `(client_id, department_id, invoice_month)` で行い、
   あれば UPDATE・なければ INSERT する（`onConflict` は使わない。部分インデックスのため）
3. `tenant_id` を必ず明示的に書き込む

4経路はいずれも自前の計算を済ませたうえで、この関数を呼ぶだけになる。

**⚠️ この関数が保証しないこと: 確定済み請求書のロック判定。**

`finalizeInvoice` は現在、`status` が `issued` / `paid` の請求書を上書きしようとすると停止し、
開発者アンロック（理由の入力）を要求する（`billing-actions.ts:113-122`）。
この判定は**業務ロジックであり、呼び出し側に残す。** 共通ライタは渡された内容をそのまま書く。

一本化にあたって、この責務境界を明示しておかないと「ライタが守ってくれるはず」と思い込んだ
呼び出し側が判定を落とし、**発行済み請求書が黙って上書きされる**事故になりうる。
4経路それぞれについて、ロック判定が必要かどうかを移行時に判断し、判断結果をコード内にコメントで残すこと。

### 5-3. 一本化で同時に解消される既存バグ

調査の過程で、既知の1件に加えて**新たに2件のバグを発見した**。いずれも共通ライタ導入で解消する。

| バグ | 内容 | 現状 |
|---|---|---|
| **B-1** | `commitManualInvoice` の insert が `target_month` / `total_amount_ex_tax` / `total_tax` を渡していない。3つとも NOT NULL・DEFAULT なしのため `23502` で必ず失敗する | 2026-07-29 の修正から**漏れていた4本目**。未修正 |
| **B-2** | `saveClientScanResult` が既存行を確認せず素の insert をしている。同一荷主・同一月に2枚目をスキャンすると `23505 duplicate key` で失敗する（7/28 に UNIQUE 制約を追加したため顕在化） | 未修正・未検証 |
| **B-3** | `commitManualInvoice` も同様に素の insert。同一荷主・同一月の2回目の実行が `23505` で失敗する | 未修正・未検証 |

**B-1 は型定義から確定的に言える**（`Insert` 型で3列とも必須）。B-2 / B-3 は制約の性質からの推論であり、
§8 のベースライン取得で実地確認する。

---

## 6. 請求書生成ロジックの変更

### 6-1. 対象案件の絞り込み

`fetchInvoicePreview`（`admin/sales/actions.ts:285-291`）は現在、荷主に紐づく**全案件**を集めて1枚にしている。

```
現状: projects WHERE client_id = ?
変更: projects WHERE client_id = ? AND department_id = ?   （部署制ONの場合）
```

### 6-2. フラグによる分岐

| `use_departments` | `departmentId` 引数 | 挙動 |
|---|---|---|
| `false` | 常に `null` | 従来どおり。荷主の全案件で1枚 |
| `true` | **必須** | 指定部署の案件のみで1枚。未指定はエラーで停止 |

### 6-3. 部署未割当の案件をどう扱うか

`use_departments = true` の荷主で `department_id IS NULL` の案件は、**どの請求書にも入らない**。
これは請求漏れ＝売上の消失に直結するため、**必ず可視化する**（§7-3）。

意図的にこの設計にしている。未割当案件を「部署なし請求書」へ自動的に流し込むと、
部署別請求書と部署なし請求書が併存し、取引先から見て**同じ月に説明のつかない請求書が届く**ことになる。
静かに間違った請求書を出すより、画面で止めて人間に気付かせるほうが安全（fail-visible）。

---

## 7. 画面の変更

### 7-1. `/admin/partners` — 荷主マスタ

- 荷主の編集フォームに「**部署で請求を分ける**」トグル（`use_departments`）を追加
- トグルON時、部署の一覧・追加・編集・削除・並び替え（`sort_order`）UIを表示
- 部署の項目: 部署名（必須）・担当者名・メール・電話

### 7-2. `/admin/projects` — 案件マスタ

- 荷主セレクトで `use_departments = true` の荷主を選んだとき、**部署セレクトを表示（必須）**
- `use_departments = false` の荷主では部署セレクトを表示しない

### 7-3. `/admin/sales` — 請求書生成

3つの変更を入れる。

1. **部署セレクト**: 荷主選択の隣。`use_departments = true` のときのみ表示・必須
2. **未割当案件の警告**: その荷主に `department_id IS NULL` の案件があれば
   「部署未割当の案件が◯件あります。この請求書には含まれません」を常時表示（生成は止めない）
3. **既存請求書の一覧表示**: 生成前に同一 `(荷主, 対象月)` の既存請求書を必ず一覧で見せる。
   枚数・部署・状態・金額を表示する

3 は部署機能とは独立に価値のあるガードである。7/28 の調査時点で本番の `invoices` は **0件**であり、
この画面は実運用の検証をまだ受けていない。二重請求は取引先に直接迷惑がかかる種類の事故なので
fail-visible にしておく。

### 7-4. PDF テンプレート

**変更なし。** 請求書の宛名は会社名のみ（部署名は印字しない）とボスが決定済み。実物サンプルの
「株式会社エス.アール.シー 御中」もこの形式。`InvoicePdfTemplate.tsx` は触らない。

---

## 8. フラグ切替時の挙動

`use_departments` は後から変更可能とする（ボス方針）。切替の瞬間が最も危険なので、挙動を明示する。

### 8-1. 大原則: 過去データは書き換えない

**フラグをどちらへ切り替えても、既存の `invoices` および `projects` の `department_id` は一切変更しない。**
確定済みの請求書は取引先に提出した紙の根拠であり、後から改変してはならない。ボス確認済み。

### 8-2. OFF → ON（部署制を導入する）

切替直後、その荷主の既存案件はすべて `department_id = NULL` になっている。この状態で請求書を生成すると
売上が請求書から漏れる。

- 切替時に「既存案件◯件が部署未割当です」と件数を表示し、案件管理画面へ誘導する
- 未割当が残っている間、請求書生成画面に §7-3 の警告を常時表示する
- **生成自体はブロックしない**（業務が止まるため）

### 8-3. ON → OFF（部署制をやめる）

- 過去の部署別請求書は `department_id` を保持したまま残る（読み取り専用）
- 案件の `department_id` も NULL 化せず、履歴として残す
- 生成ロジックはフラグを見て `department_id` を無視するだけ
- 結果として、過去の部署別請求書と今後の部署なし請求書が共存する

§4-2 の部分インデックスは、この共存状態でも正しく機能する
（`department_id IS NOT NULL` の過去分と `IS NULL` の新規分は別インデックスで管理されるため）。

---

## 9. 実装順序

制約の張り替えが絡むため、順序を守ること。

| 順 | 作業 | 本番反映 |
|---|---|---|
| 0 | **ベースライン取得**（§10） | — |
| 1 | マイグレーション: `client_departments` 新設 ＋ 3列追加 | 単独で適用・確認 |
| 2 | 共通ライタ `invoice-writer.ts` 新設、4経路を移行（B-1〜B-3 もここで解消） | ローカル検証後 |
| 3 | マイグレーション: 一意制約の張り替え（§4-2） | **2 と同時に出す**。片方だけ先行させない |
| 4 | 画面の変更（§7） | |
| 5 | 型定義の再生成 `npx supabase gen types typescript --linked` | |

⚠️ **手順3を単独で先に本番へ適用してはならない。** 制約を削除した瞬間に `finalizeInvoice` の
upsert が `42P10` で壊れる。手順2で共通ライタへ移行済みであることが前提条件。

---

## 10. ベースライン取得（実装前に必ず実施）

2026-07-28 時点で本番の `invoices` は **0件**だった。つまりこれらの経路の多くは、
**本番でまだ一度も成功していない可能性がある。**

改修後に不具合が出たとき「今回壊したのか、元から壊れていたのか」を判別できないと、
原因究明に時間を溶かす。改修前に現状を記録しておく。

**手順:** 改修前に、4経路すべてを画面から実行し、結果を記録する。

| # | 経路 | 実行する画面 | 記録すること |
|---|---|---|---|
| 1 | `finalizeInvoice` | `/admin/billing` | 成功/失敗・エラーコード |
| 2 | `saveClientScanResult` | `/admin/sales?tab=scan` | 同上。**2回目**（同一荷主・同一月）も実行し B-2 を確認 |
| 3 | `upsertInvoice` | `/admin/sales` | 同上（2026-07-29 に成功確認済み） |
| 4 | `commitManualInvoice` | `/admin/sales`（手動作成） | 同上。B-1 の実地確認 |

記録先は本設計書の §12 に追記する。

---

## 11. 検証計画

実装後、以下をすべて実地確認する（`read_page` 中心。スクリーンショットはレイアウト確認時のみ）。

### 11-1. 部署なし荷主（回帰確認）

- [ ] `use_departments = false` の荷主で請求書を生成でき、従来と同じ結果になる
- [ ] 案件登録画面に部署セレクトが表示されない

### 11-2. 部署あり荷主

- [ ] 部署を2つ登録でき、`sort_order` の順に表示される
- [ ] 案件に部署を割り当てられる
- [ ] **同一荷主・同一月で2枚（部署A・部署B）の請求書が生成できる**（§4 の張り替えが効いていること）
- [ ] 同じ部署・同じ月で2回生成すると、2枚目が作られず1枚目が更新される
- [ ] 部署未割当の案件があるとき、請求書生成画面に警告が出る
- [ ] 生成前に既存請求書の一覧が表示される

### 11-3. 4経路すべて（一本化の確認）

- [ ] 4経路とも保存が成功する（B-1 解消の確認を含む）
- [ ] 4経路とも `target_month` / `total_amount_ex_tax` / `total_tax` に新列と同じ値が入っている
- [ ] 4経路とも `tenant_id` が明示的に書き込まれている
- [ ] AIスキャンで同一荷主・同一月の2枚目を保存しても失敗しない（B-2 解消）
- [ ] **発行済み（`issued`）の請求書を再度確定しようとすると、従来どおり停止して
      開発者アンロックを要求する**（§5-2 のロック判定が呼び出し側に残っていること）

### 11-4. フラグ切替

- [ ] OFF → ON にすると未割当案件の件数が表示される
- [ ] ON → OFF にしても過去の請求書の `department_id` が変わらない
- [ ] ON → OFF 後に生成した請求書と、過去の部署別請求書が共存できる

---

## 12. ベースライン記録（実装前に埋める）

| # | 経路 | 実行日 | 結果 | エラー |
|---|---|---|---|---|
| 1 | `finalizeInvoice` | | | |
| 2 | `saveClientScanResult`（1回目） | | | |
| 2' | `saveClientScanResult`（2回目・同月） | | | |
| 3 | `upsertInvoice` | 2026-07-29 | 成功 | — |
| 4 | `commitManualInvoice` | | | |

---

## 13. 関連ドキュメント

- `docs/HANDOVER_MASTER.md` §5-2（タスク一覧）・§5-4（2026-07-27〜29 の作業履歴）
- `docs/superpowers/plans/2026-07-27-tenant-isolation-phase0.md` — F0 テナント分離。
  §5-2 で `tenant_id` を必須引数にするのは、この計画の Task 5B（DEFAULT 依存の INSERT の修正）に相当する
- `supabase/migrations/20260728070404_invoices_unique_client_month.sql` — §4 で張り替える対象
