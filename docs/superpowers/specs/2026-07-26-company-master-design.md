# 自社マスタ（請求書発行元情報）設計書

- 作成日: 2026-07-26
- 発見の経緯: デモデータ総合テスト中、請求書PDFに自社データが出ないことをボスが発見
- 種別: 機能追加（設計の欠落を埋める）

## 1. 何が問題か

請求書PDFに載る「発行元＝自社」の情報が、どこにも設計されていなかった。

### 1-1. 現状の実装

`InvoiceDocument.tsx` / `InvoicePdfTemplate.tsx` / `PaymentNoticeDocument.tsx` の3ファイルに、
同じ内容の定数が**重複して**ハードコードされている。

```ts
const COMPANY = {
  name:       process.env.NEXT_PUBLIC_COMPANY_NAME       ?? '○○運送有限会社',
  invoiceReg: process.env.NEXT_PUBLIC_INVOICE_REG_NUMBER ?? 'T0000000000000',
  phone:      process.env.NEXT_PUBLIC_COMPANY_PHONE      ?? '000-0000-0000',
  email:      process.env.NEXT_PUBLIC_COMPANY_EMAIL      ?? 'info@example.com',
  address:    process.env.NEXT_PUBLIC_COMPANY_ADDRESS    ?? '〒000-0000 東京都○○区',
}
```

`web/.env.local` に `NEXT_PUBLIC_COMPANY_*` は**1件も設定されていない**。
したがって本番のPDFには上記の仮の値がそのまま印字されている。

### 1-2. なぜ環境変数では駄目か

| # | 問題 | 内容 |
|---|---|---|
| 1 | 登録番号が嘘 | `T0000000000000` は実在しない番号。適格請求書に誤った登録番号を載せると請求書として無効になり、受け取った荷主が仕入税額控除を受けられない。取引先に実害が出る |
| 2 | マルチテナントで破綻 | `NEXT_PUBLIC_` はビルド時にバンドルへ焼き込まれる。1デプロイ＝1社分しか持てないため、B社を追加した瞬間にA社の会社名がB社の請求書に出る |
| 3 | 定数が3ファイルに重複 | 片方だけ直して「請求書は直ったが支払通知書は仮のまま」という事故が起きる |
| 4 | 振込先欄が存在しない | 請求書PDFに振込先の記載欄がそもそも無い。荷主が支払先を知る手段がない |

### 1-3. 既存 `companies` テーブルの状態

`id` / `name` / `created_at` の3列のみ、**0件**。どこからも参照されていない空箱。

`work_records.company_id` と `expense_records.company_id` という列が存在するが、
アプリコードからの参照は**0件**（型定義を除く）。用途不明の死んだ列。
勝手に意味を与えると後で混乱するため、**本設計では触らない**。

## 2. 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| 保持場所 | DB（`companies` テーブルを拡張） | 環境変数ではマルチテナントに耐えない |
| 発行元の数 | 1テナント＝1社 | A社は単一法人でしか請求書を出さない。`tenant_id` に UNIQUE 制約を張り、2行目を作れなくする |
| 振込先口座 | 請求書PDFに載せる | 実務上、振込先が無いと荷主が支払えない |
| 口座の保存形式 | AES-256-GCM 暗号化 | CLAUDE.md §2「口座情報の平文保存は厳禁」 |
| 未登録時の挙動 | エラーで停止（fail-closed） | 嘘の登録番号が入った請求書が社外に出るのが最悪のケース |
| 支払通知書への振込先 | **載せない** | 自社→委託先への支払通知であり、自社の振込先を載せると誤送金を誘発する |

## 3. スキーマ

既存 `companies` に列を追加する（`ALTER TABLE ... ADD COLUMN`）。既存データ0件のため変換は発生しない。

| 区分 | 列 | 型 | 備考 |
|---|---|---|---|
| 識別 | `tenant_id` | text | **UNIQUE**。1テナント1行をDB制約で保証 |
| 請求書必須 | `name`（既存） | text | 発行者の名称 |
| 請求書必須 | `invoice_reg_number` | text | 適格請求書発行事業者の登録番号 |
| 連絡先 | `postal_code` / `address` / `phone` / `email` | text | |
| 振込先 | `bank_name` / `bank_branch` / `account_type` / `account_number` / `account_holder` | text | **全てAES-256-GCM暗号化して保存** |
| 運用 | `updated_at` | timestamptz | |

**入れないもの（YAGNI）**: 代表者名・FAX・ロゴ画像。必要になってから追加する。

## 4. 実装範囲

### 4-1. 自社情報の取得（単一の情報源）

`getCompanyInfo()` を Server Action として1つ作り、PDF生成側は全てここから読む。
口座情報の復号もこの中で行う。3ファイルに重複している `COMPANY` 定数は**全て削除**する。

自社情報が未登録、または `name` / `invoice_reg_number` が空の場合はエラーを返す。
PDF生成側はそのエラーを画面に出し、「自社情報を登録してください」と案内する。

### 4-2. 編集画面 `/admin/settings/company`

- サイドナビの「マスタ管理」グループ（取引先マスタ・案件管理・アカウント管理が並ぶ場所）に「自社情報」を追加
- フォーム1枚。**親分（master）のみ編集可** — 既存の `requireOwner()` ガードを使う
- 保存は Server Action 経由（クライアントからのDB直接クエリは全面禁止）
- 口座情報は保存時にサーバーサイドで暗号化、表示時に復号

### 4-3. 請求書PDFに振込先欄を追加

合計金額ブロックの下に振込先を新設する。支払通知書PDFには追加しない。

### 4-4. 環境変数の撤去

`NEXT_PUBLIC_COMPANY_NAME` 等の参照を全て削除する。`.env.local` には元々未設定のため設定ファイル側の変更は不要。

## 5. 安全策

1. 口座情報は `utils/crypto.ts` の AES-256-GCM を必ず経由。平文保存しない
2. DBアクセスは全て Server Actions 経由。クライアント直クエリを作らない
3. 編集は `requireOwner()` で親分のみに制限
4. スキーマ変更は本番DBへの適用となるため、SQL全文を提示して承認を得てから1回で実行する
5. コミット時は3ステップ（`git status` 目視 → シークレット漏れ grep → ファイル明示 add）

## 6. 完了の定義

- [ ] `companies` に必要な列が揃い、`tenant_id` に UNIQUE 制約がある
- [ ] `/admin/settings/company` で自社情報を登録・編集でき、親分以外はアクセスできない
- [ ] 口座情報がDB上で暗号化されている（平文で読めないことを確認）
- [ ] 請求書PDFに実際の自社情報と振込先が出る
- [ ] 支払通知書PDFにも実際の自社情報が出る（振込先は出ない）
- [ ] 自社情報未登録の状態でPDF生成するとエラーで止まり、仮の値が印字されない
- [ ] `NEXT_PUBLIC_COMPANY_*` の参照がコードベースから消えている
