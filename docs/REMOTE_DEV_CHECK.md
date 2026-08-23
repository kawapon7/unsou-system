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

## 4. Claude Code を mini で動かして Air から操作する（2026-08-23 追記）

画面共有ではなく、**mini 上の tmux の中で CLI 版 Claude Code を動かし、Air のターミナルから操作する**。文字はローカル描画なので解像度・色の問題が出ない。

```bash
# Air から。tmux セッション hibiki に入る（無ければ作る）。Claude は mini で動き続ける
ssh mini -t '/opt/homebrew/bin/tmux new -A -s hibiki'
```

- 抜けるときは **`Ctrl-b` → `d`**（デタッチ）。`exit` / `Ctrl-d` はセッションごと消えるので使わない
- 同じリポジトリで CLI 版とデスクトップ版の Claude を**同時に動かさない**（互いの編集を上書きする）
- mini の `~/.tmux.conf`（設定済み）: `set -g mouse on` / `set -g bell-action none` / `set -g history-limit 50000`

### ベルが鳴り続ける（キンコンカンコン）ときの原因と対処
1. **スクロールやカーソル操作で鳴る** → Claude Code が有効にしたマウス追跡モードの残骸。SSH 切断後もターミナルが覚えていてマウスイベントをシェルに送り、zsh がビープする。即時対処は Air 側で `reset`。再発防止は tmux の `mouse on`（tmux がイベントを消費する）と Air の `~/.zshrc` に `setopt NO_BEEP`
2. **放置中に定期的に鳴る** → Claude Code の要注目通知。`claude config set --global preferredNotifChannel notifications_disabled` で止まる（許可待ちで止まっている可能性が高いので、放置作業は許可プロンプトが出ない設定にしておく）

### 画面共有が必要なとき（Simulator・Browser ペインなど）
- macOS「画面共有」の**高パフォーマンスモード**（両方 Apple silicon・mini は macOS 26.5 で条件充足）は Air と同じ解像度の仮想ディスプレイを作るので、mini の 1080p モニタに縛られず文字が読める。ただし**ポインタ消失・メニューの描き残し**が既知の荒さ（`Esc`・デスクトップクリック・表示モードの切替で再描画）
- GUI 操作時間が長いなら Jump Desktop（Fluid）への乗り換えが定番の解決策
- Warp ターミナルは tmux 内では利点がほぼ無い（ブロック表示・補完・AI が無効になる）ため導入見送り
