# 設計書: マルチテナント分離（DB側RLS強制）

- 日付: 2026-06-27
- 対象: HIBIKIシステム（Next.js App Router + Supabase）
- ステータス: 設計確定待ち（実装はB社導入前まで・本セッションは設計まで）
- 実装担当（予定）: Cursor（Sonnet 4.6）／フェーズ単位の指示書に分割

---

## 1. 背景と目的

HIBIKIを複数の運送会社（A社・B社・C社…）に**同一システム（共有DB）で販売**する計画。
現状はほぼ全DBアクセスが `service_role`（マスターキー＝RLS素通り）経由のため、
共有DB化した瞬間に「A社の管理者がB社のデータを閲覧できる」重大事故が起きうる。

**目的**: コードにバグや書き忘れがあっても他テナントのデータが漏れないよう、
**Postgres RLS（DB側）でテナント境界を物理的に強制**する。事故率を限りなくゼロに近づけつつ、
単一コードベース・単一DBの運用負荷の低さを維持する。

### 用語
- **テナント** = HIBIKIを導入した会社（A社/B社/C社）。`companies` テーブル・`tenant_id` で識別。
- **受託元** = 各社のお客さん（`clients`）。テナント内の業務データ。
- **委託先（子分）** = 各社が仕事を振る相手（`contractors`）。テナント内の業務データ。

---

## 2. 確定した原則

1. **マスターキー（service_role）は各社管理者に渡さない。** 開発者（提供者）のサーバー内のみに存在し、ブラウザには出さない。
2. **各社の管理者（親分）も子分も「同じテナントの一般ログインユーザー」**（role差はある）。普段のCRUDはログイン接続で行い、RLSが自社データのみに制限する。
3. **RLSが守るのはテナント境界**。「子分は自分の分だけ」等の既存の所有権・role判定はアプリ側に残す（多層防御）。
4. **特権操作（ユーザー作成等）も呼び出した人のテナントに縛って実行**する。A社管理者はA社ユーザーしか作れない。
5. **画面・帳票・計算ロジックは原則変更しない。** 変えるのは「どの接続でDBを叩くか」と「DB側RLS設定」。

---

## 3. 現状調査で判明した要修正点

1. **`user_metadata.tenant_id` は本人が改変可能**（[utils/tenant.ts:17](../../../web/src/utils/tenant.ts)）。
   このままRLSを組むと「自分のtenant_idをB社に書き換えて閲覧」が可能 → **改変不能な `app_metadata` へ移す**。
2. **`tenant_id` の不統一**: 現在 `TEXT`型・デフォルト`'local-dev'`で、
   clients / contractors / projects / work_records / expense_records / schedules / driver_project_assignments には存在するが、
   **invoices / payment_notices / notification_logs / project_payees / scan_jobs 等の請求・支払系に欠落**。
   さらに別概念 `company_id`(UUID) が work_records / expense_records に中途半端に残存 → **`tenant_id`(UUID) に一本化**。
3. ほぼ全Server Actionが `createServiceClient()` 経由（RLS素通り）。通常CRUDをログイン接続へ移行する必要がある。

---

## 4. 目標アーキテクチャ（移行後の姿）

```
ログイン（A社の親分） → JWT app_metadata.tenant_id="A社"（本人改変不可）
        ↓
通常CRUD → createClient()（ログイン接続。service_role を使わない）
        ↓
Postgres RLS が自動で「tenant_id = A社 の行だけ」に制限（DBが物理強制）
        ↓
新規INSERT → BEFORE INSERT トリガーが tenant_id を JWT から自動セット（書き忘れ・詐称不可）
```

**接続の使い分け（移行後）**

| 接続 | 用途 | RLS |
|---|---|---|
| `createClient()`（ログイン接続） | 通常CRUD全般（一覧/登録/編集/削除） | 効く（テナント自動制限） |
| `createServiceClient()`（マスターキー） | 後述の許可リストの操作のみ | 素通り（限定使用） |

**service_role 許可リスト（これ以外での使用を禁止）**
- ユーザー作成・パスワード変更等の `auth.admin` 操作（※呼び出し元テナントに強制スコープ）
- ログイン前処理（認証コールバック等、まだ主体が確定しない処理）
- 不変ログ（approval_history / notification_logs）のINSERT
- （将来）提供者による全テナント横断の運営者ビュー

---

## 5. コンポーネント（作る/変える部品）

### ① テナントIDの置き場所を安全化
- `user_metadata.tenant_id` → `app_metadata.tenant_id`（管理者のみ設定可）へ移行。
- 既存ユーザー全員に `app_metadata.tenant_id`（=A社）を設定（backfill）。
- `getCurrentTenantId()` を app_metadata から読むよう変更。未設定なら例外（fail-closed）を維持。

### ② DBスキーマの統一
- 全テナント対象テーブルに `tenant_id UUID NOT NULL` を統一付与（欠落テーブルへ追加）。
- `companies(id)` への外部キー。型を TEXT→UUID へ移行。
- 別概念 `company_id` を廃止し `tenant_id` に一本化。
- 既存行を A社の tenant_id で backfill。

### ③ RLSポリシーと自動付与トリガー
- 各テーブルに「`tenant_id = (JWTのtenant_id)`」のRLSポリシー（SELECT/INSERT/UPDATE/DELETE）。
- BEFORE INSERT トリガーで `tenant_id` を JWT から自動セット（クライアント指定値は無視）。
- service_role バイパスは許可リストの操作のためだけに残す。
- 既存の不変ログトリガー（approval_history / notification_logs）はそのまま維持。

### ④ アプリ接続の切り替え
- 通常CRUDのServer Actionを `createServiceClient()` → `createClient()` に置換。
- 手書きの `.eq('tenant_id', …)` を撤去（RLSが担う。残置は無害だが整理）。

### ⑤ 特権操作のテナント縛り
- [admin/users/actions.ts](../../../web/src/app/admin/users/actions.ts) のユーザー作成等を、呼び出し元の `requireOwner()` 確認後、
  新ユーザーの `app_metadata.tenant_id` を呼び出し元テナントに強制設定。
- service_role 残置箇所を許可リスト化し、それ以外を禁止ルール化（レビュー観点に追加）。

### ⑥ 漏洩テスト
- 「A社でログイン → B社データを取得しようとして 0 件」を確認するテスト。
- `createServiceClient()` 使用箇所の最終grep監査（許可リスト外が残っていないこと）。

### 既存資産の扱い
- P0改修のアプリ側ガード（`requireOwner`/`requireAuth`/本人ID解決/IDOR是正）は**残す**（DBのRLSと多層防御）。
- RLS step②（5テーブル deny-by-default）は、本設計の「テナント+role を許可するRLSポリシー追加」へ自然発展（deny-by-default が出発点）。

---

## 6. 移行フェーズ（安全順）

各フェーズは独立して本番投入可。失敗時の最悪挙動は「データが見えない（fail-closed）」であり漏洩ではない。

### フェーズ0: 下ごしらえ（挙動不変）
- `tenant_id` 統一・UUID化・既存行 backfill。
- テナントIDを app_metadata へ移行・既存ユーザーへ設定。
- アプリはまだ service_role 動作 → 画面挙動は変わらない。

### フェーズ1: DB門番の設置（まだ効かせない）
- 全テーブルにRLSポリシー＋自動付与トリガー追加。
- アプリはまだマスターキー＝RLS素通り → 画面挙動は変わらない。安全に本番投入可。

### フェーズ2: 接続を機能エリア単位で付け替え（本番切替）
小分けで実施し、各エリアごとに画面確認:
1. 案件（projects）系
2. 取引先（clients / contractors）系
3. 請求・支払（invoices / payment_notices）系
4. 子分ダッシュボード（schedules / expense_records）系

問題発生時の症状は「データが見えない」であり「他社が見える」ではない（安全）。1エリア単位で切り戻し容易。

### フェーズ3: 仕上げ
- 特権操作のテナント縛り（⑤）。
- 不要な手書き `.eq('tenant_id')` と `company_id` の撤去。
- service_role 許可リスト化。

### フェーズ4: 検証
- ステージングで「A社→B社データ0件」テスト。
- `createServiceClient()` 最終監査。

---

## 7. リスクと対策

| リスク | 対策 |
|---|---|
| 接続切替で画面にデータが出なくなる | fail-closed（漏洩ではない）。フェーズ2を機能単位で小分け＋都度確認＋切り戻し容易 |
| backfill漏れでtenant_id NULL行が残る | NOT NULL制約＋backfill後に NULL 件数を検証してから次フェーズへ |
| app_metadata設定漏れユーザーがログイン不能 | `getCurrentTenantId` の fail-closed を維持しつつ、移行時に全既存ユーザーの設定を検証 |
| JWTのtenant_id取得方法の誤り | RLSポリシーは `auth.jwt()` の app_metadata 経路を単体SQLで先に検証してから全表展開 |
| service_role の取りこぼし使用 | 許可リスト化＋grep監査＋レビュー観点に明文化 |
| 既存マイグレーション未適用との競合 | 適用前に pending マイグレーションを確認（既存運用ルール踏襲）。ステージング先行 |

---

## 8. スコープ外（今回やらない）

- 提供者向けの全テナント横断・運営者ダッシュボードの実装（許可リストに枠だけ確保）。
- 課金・契約管理などSaaS運営機能。
- DB物理分割（パターン2）への切替（採用しない）。
- 画面UI・帳票・金額計算ロジックの変更。

---

## 9. 成功条件（Done）

- 全テナント対象テーブルに `tenant_id UUID NOT NULL` ＋ RLSポリシー ＋ 自動付与トリガーが存在。
- 通常CRUDが `createClient()`（ログイン接続）で動作し、画面が従来通り表示される。
- `createServiceClient()` の使用が許可リストの箇所のみ（grep監査でゼロ違反）。
- ステージングで「A社ログイン → B社データ取得 0 件」を確認。
- テナントIDが `app_metadata` 管理（本人改変不能）になっている。
