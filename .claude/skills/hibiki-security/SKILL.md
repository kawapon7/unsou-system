---
name: hibiki-security
description: HIBIKIで口座情報・DBアクセス・不変ログ(approval_history/notification_logs)に触れるとき、または git commit/add・デプロイ設定に進む直前に使う軽量セキュリティゲート。既存規約を指すチェックリストで即判定する。
---

# hibiki-security — セキュリティ軽量ゲート

規約本文は複製しない（実体は CLAUDE.md §2 と HANDOVER §2-6S に一元管理）。
ここは「触れたら確認する入口」。該当項目だけ即チェックし「OK/要対応」を一言宣言する。

## 発動トリガー（いずれかに触れたら）

- 口座情報の読み書き・表示・保存
- DBアクセスを書く/変える（Server Action・RLS・クライアント直クエリの疑い）
- `approval_history` / `notification_logs` を扱う
- **git commit/add に進む直前**（最頻・最重要）
- `.env.local` / デプロイ設定 / 認証フラグに触れる

## チェックリスト（判定と参照先のみ）

| # | 確認 | 参照 |
|---|---|---|
| 1 | 口座情報を平文でDBに入れていないか（`utils/crypto.ts` の AES-256-GCM 経由か） | CLAUDE.md §2 |
| 2 | クライアント直クエリになっていないか（全DBアクセスは Server Actions 経由か） | CLAUDE.md §2 |
| 3 | `approval_history`/`notification_logs` に UPDATE/DELETE を書いていないか（INSERTのみ） | CLAUDE.md §2 |
| 4 | コミット前3ステップ（下記）を通したか | HANDOVER §2-6S |
| 5 | `.env.local` の挙動フラグをビルドに焼き込んでいないか（deploy時 `ALLOW_DEV_AUTH_BYPASS=false` 強制） | HANDOVER §2-6S |

## #4 コミット前3ステップ（git操作時は必ず・スキップ禁止）

1. `git status` で `.next/`・`.open-next/` がステージング候補に無いことを確認
2. シークレット漏れスキャン:
   `git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"` が空
3. `git add .` の一括ではなくファイルを明示して add

詳細な背景・事故経緯は HANDOVER §2-6S を参照。
