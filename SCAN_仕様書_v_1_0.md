# SCAN_仕様書_v_1_0
## 運送業務管理システム「響き（HIBIKI）」請求書データ取り込みサポート拡張オプション
### 参照元コア仕様書：`HIBIKI_仕様書_v_1_9.md`

* **作成日：** 2026年6月7日
* **ステータス：** 設計フェーズ（実装待ち）
* **対応コアバージョン：** HIBIKI v1.9以降
* **オプション区分：** プラグイン型疎結合（コアDB・RLS・ロジックへの直接依存禁止）

---

## 1. 概要・目的

### 1-1. コンセプト
紙媒体のスキャン画像・PDF・Googleスプレッドシート・Excelなど、多種多様な形式で外部から送られてくる請求書のデータを自動抽出し、HIBIKIのマスタと照合しながら入力業務を**半自動でサポート**する拡張オプション。

**完全自動化ではなく「人間が最終確認・承認する半自動設計」を徹底する。** AIが抽出・提案し、人間が判断・確定するUX。

### 1-2. 解決する課題

| 現状の課題 | SCANオプションによる解決 |
| :--- | :--- |
| 荷主から届く請求書フォーマットが各社バラバラ | AIが多様な形式を統一的に解析・構造化データとして抽出 |
| 手入力による転記ミス・時間ロス | 抽出結果をフォームにプリセットし確認ステップで精度補完 |
| 未登録取引先の手動照合作業 | マスタ自動照合＋新規登録ナビで漏れなく対応 |
| 大量件数処理時のシステム負荷 | 非同期キュー設計で将来の大量処理に対応 |

### 1-3. 設計原則
* HIBIKIコアのDB・ロジック・RLSポリシーを**一切改変しない**疎結合設計
* SCANオプション側からSupabase DBへの直接書き込みは**厳禁**とし、必ずHIBIKI APIを経由する
* HIBIKIコアのセキュリティ要件（AES-256-GCM暗号化・RLS全面遮断）を完全継承
* AIは「提案者」に徹し、データの確定は必ず人間が行う

---

## 2. 対応入力形式

| 形式 | 対応方法 | 備考 |
| :--- | :--- | :--- |
| 紙スキャン画像（PNG / JPEG） | Gemini Vision APIで画像解析 | スマホカメラ撮影も可 |
| PDF | PDF→画像変換後にVision API解析 | テキストレイヤー有無に関わらず対応 |
| Googleスプレッドシート | Google Sheets APIでセル値取得後に構造解析 | 共有URL貼り付けで取込 |
| Excel（.xlsx） | SheetJS等でパース後に構造解析 | ファイルアップロード形式 |
| CSVテキスト | テキストパース後に構造解析 | コピー&ペースト入力も可 |

---

## 3. 技術アーキテクチャ

### 3-1. 全体アーキテクチャ図

```
[親分ブラウザ]
  │ ファイルアップロード / URL貼り付け
  ↓
[SCAN APIエンドポイント]（/api/scan/upload）
  │ ファイルを受取り、ジョブIDを即時返却（非同期分離）
  ↓
[ジョブキュー]（Cloudflare Queues / Supabase Edge Functions等）
  │ 非同期でAI解析ジョブを実行
  ↓
[AI解析モジュール]（Gemini 1.5 Flash API）
  │ 請求書データを構造化JSONとして抽出
  ↓
[マスタ照合モジュール]（HIBIKI API経由）
  │ 取引先名・案件名をHIBIKIマスタと照合
  ↓
[サジェスト結果DB保存]（scan_jobs テーブル）
  ↓
[親分ブラウザ]
  │ ジョブIDでポーリング or WebSocket通知
  ↓
[確認・承認UI]（サジェスト表示→人間が承認→HIBIKI APIへ確定送信）
  ↓
[HIBIKI コアDB]（RLS保護下・service_role経由のみ）
```

### 3-2. AI技術選定

| フェーズ | 採用モデル | 理由 |
| :--- | :--- | :--- |
| **初期（コスト最優先）** | **Gemini 1.5 Flash** | 無料枠15RPM・1,000,000TPM。月10〜20件の処理なら実質ゼロコスト |
| 精度強化フェーズ | Gemini 1.5 Pro | Flash比で高精度。複雑レイアウトの請求書に対応 |
| 大量処理フェーズ | 専用AI-OCR（Document AI等） | 100件/日以上で費用対効果が逆転する場合に換装 |

**換装設計：** AI呼び出し部分を `src/utils/scan/aiExtractor.ts` に集約し、モデル変更は1ファイルの差し替えで完結するアダプターパターンを採用する。

```typescript
// src/utils/scan/aiExtractor.ts
// モデルをここだけで管理する。将来の換装はこのファイルのみ修正。
const MODEL = 'gemini-1.5-flash-latest'  // ← 1行変更で換装
```

### 3-3. AI抽出プロンプト設計（Gemini向け）

```
以下の請求書画像（またはテキスト）から、以下のフィールドをJSON形式で抽出してください。
不明なフィールドはnullとしてください。金額はすべて税抜き金額で抽出してください。

抽出フィールド：
- issuer_name: 発行者（請求元）の会社名・屋号
- issuer_address: 発行者の住所
- issuer_phone: 発行者の電話番号
- invoice_date: 請求日（YYYY-MM-DD形式）
- due_date: 支払期限（YYYY-MM-DD形式）
- invoice_number: 請求書番号
- line_items: 明細行の配列（description, quantity, unit_price, amount）
- subtotal: 小計（税抜き）
- tax_amount: 消費税額
- total_amount: 合計金額（税込み）
- notes: 備考・振込先等の特記事項

出力はJSONのみ。説明文は不要。
```

---

## 4. 業務フロー・マスタ照合ロジック

### 4-1. 全体フロー

```
① ファイルアップロード
  ↓
② AI解析・データ抽出（非同期）
  ↓
③ 取引先マスタ照合
  ├── 【一致あり】→ 自動紐付け（④へ）
  └── 【一致なし】→ 新規登録ナビ（⑤へ）
  ↓
④ 案件マスタ候補サジェスト（既存データあり）
  ↓
⑤（新規のみ）新規登録フォームに自動プリセット
  ↓
⑥ 人間による確認・承認
  ↓
⑦ 確定データをHIBIKI APIへ送信
  ↓
⑧ HIBIKIコアDBに反映（invoices テーブル等）
```

### 4-2. 取引先マスタ照合ロジック

#### 照合アルゴリズム
```
AIが抽出した issuer_name
  ↓
HIBIKI API GET /api/hibiki/clients?search={issuer_name} で照合
  ↓
一致スコアを計算（完全一致 > 部分一致 > 読み仮名一致 > 類似度スコア）
  ↓
スコア閾値（例：80%以上）で自動紐付け判定
  ↓
80%未満 → 候補リストをUI表示してユーザーが選択
```

#### 【既存データあり】の場合

```
取引先「〇〇運輸株式会社」← 既存マスタと一致（スコア95%）
  ↓
[自動紐付け済み] 表示
  ↓
関連する進行中の案件マスタ候補をプルダウンでサジェスト：
  ● 城南エリア宅配便（2026年5月〜）
  ● 企業間スポット配送（2026年4月〜）
  ↓
ユーザーが案件を選択 → 請求金額・明細を確認 → 「確定して取り込む」ボタン
  ↓
POST /api/hibiki/invoices（確定データ送信）
```

#### 【既存データなし】の場合

```
取引先「新規物流センター株式会社」← マスタに存在しない
  ↓
[未登録の取引先「新規物流センター株式会社」が検出されました。新規登録しますか？]
バナーをUI上部に表示
  ↓
「新規登録する」ボタン押下
  ↓
荷主マスタ新規登録フォームが開く
  ├── 会社名：「新規物流センター株式会社」← AIが抽出した値を自動プリセット
  ├── 住所：「東京都港区〇〇1-2-3」← AIが抽出した値を自動プリセット
  ├── 電話番号：「03-XXXX-XXXX」← AIが抽出した値を自動プリセット
  └── その他フィールド：空欄（手動入力）
  ↓
ユーザーが内容を確認・補完して「荷主を登録する」
  ↓
POST /api/hibiki/clients（HIBIKI APIへ）
  ↓
登録完了後、元の取り込み確認画面に自動遷移して処理継続
```

### 4-3. 確認・承認UI設計

```
┌─────────────────────────────────────────────────┐
│ 請求書取り込み確認                                │
├─────────────────────────────────────────────────┤
│ 取引先：〇〇運輸株式会社 [自動紐付け済み ✅]       │
│ 案件：  [城南エリア宅配便 ▼]（プルダウン選択）     │
│ 請求日：2026年6月1日                             │
│ 支払期限：2026年6月30日                          │
├─────────────────────────────────────────────────┤
│ 明細                    数量   単価    金額        │
│ 配達業務（5月分）          43  2,500  107,500円   │
│ 立替金（高速代）            -      -    8,400円   │
├─────────────────────────────────────────────────┤
│ 小計（税抜）：115,900円   消費税：11,590円         │
│ 合計：127,490円                                  │
├─────────────────────────────────────────────────┤
│ ⚠️ AI信頼スコア: 91%（高）  元ファイルを確認する    │
├─────────────────────────────────────────────────┤
│      [修正する]         [この内容で確定する]        │
└─────────────────────────────────────────────────┘
```

* AI信頼スコアが低い場合（60%未満）は警告バナーを表示し、確定ボタンを二段階確認にする
* 「元ファイルを確認する」ボタンで元の請求書画像/PDFをオーバーレイ表示し、目視確認を促す

---

## 5. 非同期処理（キュー管理）アーキテクチャ

### 5-1. 設計方針
**アップロード処理とAI解析処理を明示的に分離する。** これにより：
* 大量ファイルアップロード時でもUIがブロックされない
* AI解析の遅延・失敗がユーザー体験を損なわない
* 将来的な100件以上の同時処理に対応できる

### 5-2. 処理フロー（非同期）

```
[フロントエンド]
  POST /api/scan/upload（ファイル送信）
    ↓ 即時レスポンス
  { jobId: "scan_abc123", status: "queued" }
    ↓ UIは「解析中...」状態に遷移
  
[バックエンド - ジョブキュー]
  scan_jobs テーブルに INSERT（status: "queued"）
    ↓ 非同期ワーカー起動
  Gemini API呼び出し（数秒〜数十秒）
    ↓ 完了後
  scan_jobs テーブルを UPDATE（status: "completed", result: {JSON}）

[フロントエンド]
  GET /api/scan/jobs/{jobId}（ポーリング or WebSocket）
    ↓ status: "completed"
  確認・承認UI表示
```

### 5-3. scan_jobs テーブル定義（追加マイグレーション予定）

```sql
CREATE TABLE scan_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by     UUID        NOT NULL REFERENCES users(id),
  file_type       TEXT        NOT NULL,  -- 'image', 'pdf', 'spreadsheet', 'csv'
  file_url        TEXT        NOT NULL,  -- Supabase Storageの一時URL
  status          TEXT        NOT NULL DEFAULT 'queued',
                              -- queued | processing | completed | failed
  ai_model        TEXT        NOT NULL DEFAULT 'gemini-1.5-flash-latest',
  extracted_data  JSONB,                 -- AI抽出結果
  confidence_score NUMERIC(4,3),         -- AI信頼スコア（0.000〜1.000）
  matched_client_id UUID      REFERENCES clients(id),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5-4. スケーリング戦略

| 処理件数/月 | 推奨構成 | コスト目安 |
| :--- | :--- | :--- |
| 〜20件 | Supabase Edge Functions（同期処理）| ほぼ無料 |
| 20〜100件 | Edge Functions + scan_jobs テーブルによるキュー管理 | Gemini Flash APIコストのみ（数百円/月） |
| 100件以上 | Cloudflare Queues + Workers / BullMQ 等の本格キューイング | 要コスト計算 |

---

## 6. APIエンドポイント設計

| エンドポイント | メソッド | 用途 |
| :--- | :--- | :--- |
| `POST /api/scan/upload` | POST | ファイル受付・ジョブ登録 |
| `GET /api/scan/jobs/{jobId}` | GET | ジョブ状態・結果取得 |
| `POST /api/scan/jobs/{jobId}/confirm` | POST | 確認後の確定データをHIBIKIへ送信 |
| `DELETE /api/scan/jobs/{jobId}` | DELETE | ジョブ・一時ファイルの破棄 |
| `GET /api/hibiki/clients?search={name}` | GET | 取引先マスタ照合（HIBIKIコアAPI） |
| `POST /api/hibiki/invoices` | POST | 請求書の確定登録（HIBIKIコアAPI） |

#### リクエスト共通ヘッダー
```
Authorization: Bearer {Supabase Session JWT}
Content-Type: multipart/form-data  ← ファイルアップロード時
X-Option-Source: scan/1.0
```

---

## 7. セキュリティ要件の継承

| HIBIKIコア要件 | SCANオプションの実装方針 |
| :--- | :--- |
| DB直接アクセス禁止 | SCANモジュールはHIBIKI APIのみ呼び出し、Supabase clientを直接使用しない |
| 口座情報の暗号化 | SCANが取引先口座情報を抽出した場合でも、HIBIKI APIへの送信前にサーバーサイドで暗号化する |
| RLS全面遮断 | `scan_jobs` テーブルも同様にservice_role専用のRLSポリシーを設定する |
| 一時ファイルの管理 | アップロードされたファイルはSupabase Storage（プライベートバケット）に保存し、処理完了後24時間で自動削除する |
| Gemini APIへのデータ送信 | 個人情報（口座番号等）が含まれる可能性があるため、Gemini APIの「データ保持ポリシー」を確認の上、エンタープライズプランを推奨する |

---

## 8. ファイル構成

```
web/
├── src/
│   └── utils/
│       └── scan/
│           ├── aiExtractor.ts         # AI抽出ロジック（Gemini APIアダプター）
│           ├── clientMatcher.ts       # 取引先マスタ照合ロジック
│           ├── fileConverter.ts       # PDF/Excel→解析可能形式への変換
│           └── jobQueue.ts            # ジョブキュー管理ユーティリティ
└── app/
    ├── api/
    │   └── scan/
    │       ├── upload/
    │       │   └── route.ts           # ファイル受付エンドポイント
    │       └── jobs/
    │           └── [jobId]/
    │               ├── route.ts       # ジョブ状態取得
    │               └── confirm/
    │                   └── route.ts   # 確定データ送信
    └── dashboard/
        └── scan/
            ├── page.tsx               # ファイルアップロード画面
            └── [jobId]/
                └── confirm/
                    └── page.tsx       # 確認・承認UI
```

---

## 9. 開発フェーズ

| フェーズ | 内容 | 前提条件 |
| :--- | :--- | :--- |
| α版 | PDF・画像のみ対応。Gemini 1.5 Flash。同期処理（件数少のため）。取引先マスタ照合のみ | HIBIKIフェーズ3完了後 |
| β版 | Excel・スプレッドシート対応追加。新規登録ナビ実装。AI信頼スコア表示 | α版フィールドテスト完了後 |
| 正式版 | 非同期キュー処理実装。大量処理対応。AI換装オプション提供 | β版検証完了後 |

---

## 10. リスクと対策

| リスク | 対策 |
| :--- | :--- |
| 請求書フォーマットの多様性によるAI抽出精度低下 | 信頼スコア表示・確認ステップ必須化・元ファイル表示機能で人間が補完 |
| Gemini APIの利用上限（無料枠: 15RPM） | 月20件以内は無料枠で運用。超過時は有料プランへ自動切替の旨をUI通知 |
| PDFにテキストレイヤーがなく画像として処理される | Vision API経由で画像として解析するため問題なし |
| 個人情報（口座番号等）のGemini APIへの送信 | エンタープライズAPI利用・プロンプト内で口座情報の抽出を明示的に除外するオプションを用意 |
| 大量アップロード時のStorage容量増加 | 処理完了後24時間で一時ファイルを自動削除するTTL設定 |
