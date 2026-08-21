# 外出先から Mac mini の実データで HIBIKI を確認する手順

作成日: 2026-08-21

**仕組み**: Tailscale（自分のデバイス同士だけをつなぐ私設ネットワーク）で MacBook/スマホ → Mac mini に接続し、SSH で dev サーバーを起動して、ブラウザで実データの画面を確認する。

## 0. 事前準備（自宅で1回だけ）

1. Mac mini と MacBook の両方で Tailscale アプリを起動し、**同じアカウントでログイン**
2. Tailscale のメニューから各マシンの名前を確認しておく（例: `mac-mini`）
3. Mac mini: システム設定 → 一般 → 共有 → **「リモートログイン」をオン**（SSH受付）
4. Mac mini: システム設定 → エネルギー → **スリープさせない設定**にする
   （スリープすると外から届かなくなる）

## 1. 外出先から dev サーバーを起動する

MacBook のターミナルで:

```bash
# Mac mini に SSH 接続（ユーザー名・マシン名は自分のものに置き換え）
ssh <ユーザー名>@mac-mini

# プロジェクトへ移動して最新を取得
cd ~/path/to/unsou-system/web
git pull

# dev サーバーを起動（SSHを切っても生き残る形で）
nohup npm run dev -- --hostname 0.0.0.0 > /tmp/dev.log 2>&1 &
```

- `--hostname 0.0.0.0` は必須。付けないと Mac mini の中からしか見えない
- 特定ブランチを確認するときは `git pull` の前に `git checkout <ブランチ名>`

## 2. ブラウザで確認する

MacBook またはスマホ（Tailscale にログイン済みのもの）のブラウザで:

```
http://mac-mini:3000/admin
```

実データ・本物の `.env.local` で動く画面が表示される。

## 3. 終わったら止める

```bash
ssh <ユーザー名>@mac-mini
pkill -f "next dev"
```

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| SSH がつながらない | 両マシンで Tailscale が起動・ログイン済みか確認。Mac mini の「リモートログイン」がオンか確認 |
| ブラウザで開けない | `--hostname 0.0.0.0` を付け忘れていないか。`ssh` して `tail /tmp/dev.log` で起動エラーを確認 |
| 3000 が使用中と出る | 別プロセスが使用中。`npm run dev -- --hostname 0.0.0.0 --port 3001` にして `http://mac-mini:3001` で開く |
| 途中でつながらなくなった | Mac mini がスリープした可能性。手順0-4 の設定を確認 |

## ⚠️ セキュリティ上の注意

- この方法で見えるのは **Tailscale にログインした自分のデバイスだけ**。それが安全の前提
- ルーターのポート開放・ngrok 等での一般公開は**厳禁**（dev サーバーは開発用設定で動いているため）
- `.env.local` は Mac mini の外に持ち出さない

## 補足: UI確認だけを MacBook ローカルでやる場合（実データ不要のとき）

MacBook にクローンして、ダミー設定の `web/.env.local` を作れば DB なしで UI だけ確認できる:

```bash
ALLOW_DEV_AUTH_BYPASS=true
NEXT_PUBLIC_SUPABASE_URL=https://dummy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy
```

データ部分は空・エラー表示になるが、レイアウト・配色・タブ切替の確認には十分。
⚠️ `ALLOW_DEV_AUTH_BYPASS=true` は開発専用。この `.env.local` をコミットしないこと。
