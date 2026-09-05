# リモート運用の仕組み化（BLACKICE / ICEBREAKER / iPhone）

作成日: 2026-09-05（クラウドセッションで起案。**実装・検証は Mac mini（BLACKICE）上で行う**）

## 目的

バックミニ導入から約1か月。道具（Tailscale / ssh+tmux / remote-control / 画面共有 / クラウドセッション）は揃ったが、
「どの入口を使うか」「困った時にどこを見るか」「今どういう状態か」が決まっておらず、リモート周りのトラブル対応に時間を取られている。
新しい道具を増やさず、今ある部品を1つの仕組みにまとめる。

## 現状の課題

- 入口が4つあり、場面ごとの使い分けが決まっていない
- 資料が4か所に散っている（`REMOTE_DEV_CHECK.md` / `RUNBOOK_セッション切断時の対処.md` / `2026-09-03_…やさしい解説.md` / HANDOVER 9/3 節）
- mini 側の仕組み（`~/.claude/scripts/*.sh`、launchd plist 2本、`~/.tmux.conf`、Air の `~/.ssh/config`）がリポジトリ外で、再現できない
- 状態（Tailscale / remote-control / tmux / dev サーバー / スリープ設定）を一発で見る手段がない
- 移動中のテザリング⇄Wi-Fi 切替で ssh が切れる

## 方針（4本柱）

### 1. 入口を3つに固定する

| 場面 | 使う入口 | 使わない |
|---|---|---|
| 外出先・スマホ・短い指示や確認 | iPhone の Claude アプリ（remote-control） | 画面共有 |
| Air で腰を据えて作業 | `ssh mini` → tmux `hibiki` 内の CLI Claude | Air 単体でのリポジトリ操作 |
| コード読み・仕様相談・mini 不要の作業 | クラウドセッション | ビルド検証（`npm ci` 不可） |
| GUI が必要な時だけ | 画面共有の高パフォーマンスモード | 常用 |

ルール: **1タスク1機械。機械をまたぐ時は HANDOVER に区切りを書いてから。**

### 1.5 プロジェクトの配置ルール（2026-09-05 ボス判断）

| 置き場所 | 対象 | 理由 |
|---|---|---|
| **mini（BLACKICE）** | HIBIKI のような重いプロジェクト。実データ・`.env.local`・本番デプロイ権限を伴うもの | 常時稼働・回線固定・秘密情報を外に持ち出さない。iPhone / Air から remote-control か ssh で触る |
| **Air（ICEBREAKER）** | 軽いプロジェクト。単体で完結し、実データや本番権限を必要としないもの（試作・スクリプト・BGM チャンネル関連など） | 手元で速く回せる。mini の負荷や tmux を汚さない |

- **1プロジェクトは1台にだけ置く。** 同じリポジトリを両方に置かない（9/3 に Air 側の HIBIKI クローンを消したのはこのため）
- **mini に置くのは「mini にしか無いもの（実データ・`.env.local`・本番権限・常駐）が要るプロジェクトだけ」。それ以外は Air。**
  理由: mini に置いた分だけリモート経路（Tailscale / ssh / tmux / remote-control）に乗るので、切断や接続トラブルに当たる確率がそのまま上がる。リモートに頼る面積は最小にする
- 軽いプロジェクトが上の条件のどれかに当たった時点で mini へ引っ越す。それまでは Air で完結させる
- 迷ったら Air。「Air 単体で終わるなら Air」が既定

### 2. 正本を1枚にする: `docs/REMOTE_OPS.md`

構成図・決定表・日常手順（つなぐ／抜ける／戻る）・症状別対処を統合。既存3ファイルは詳細版として残し、正本からリンクする。

### 3. mini の仕組みをリポジトリ管理下に: `ops/mini/`

- `recent-sessions.sh` / `rotate-remote-control-log.sh` を `~/.claude/scripts/` から回収
- launchd plist 2本のテンプレート（`com.kawapon.claude-remote-control` / `com.kawapon.claude-rc-logrotate`）
- `tmux.conf`、Air 側 `~/.ssh/config` 見本（`ServerAliveInterval` 付き）
- `setup.sh`（冪等。何度実行しても同じ状態になる）
- 秘密情報・実 IP・ユーザー名は含めず変数化

### 4. 状態を一発で見る: `ops/mini/doctor.sh`

Air から `ssh mini ~/dev/unsou-system/ops/mini/doctor.sh` で OK/NG 表を出す。

- Tailscale 接続状態
- remote-control の生死（launchctl）と、ログ末尾が `Connected` か `Reconnecting` か
- tmux `hibiki` の有無
- dev サーバー（3000）の起動有無
- スリープ設定（`pmset -g`）・ディスク残量・remote-control ログのサイズ
- NG 行には `REMOTE_OPS.md` の対処見出しを添える

## 切断対策（追加）

- **mosh 導入**（`brew install mosh`）。tmux と併用し、回線切替で接続が死なないようにする
- **iPhone から同じ tmux に入る**: Blink Shell（mosh 対応）。remote-control 断時の予備経路
- **remote-control の出力先を `--debug-file` へ切替**（9/3 保留分）。再起動で iPhone 側が一度切れるので手が空いた時に1回だけ
- **tmux `hibiki` を mini 起動時に自動作成**（launchd 1本追加）

## 進め方

| 段階 | 内容 | 目安 |
|---|---|---|
| ① | `REMOTE_OPS.md` 正本、決定表、`doctor.sh`、ssh config の keepalive | 半日 |
| ② | `ops/mini/` へスクリプト回収と `setup.sh`、`--debug-file` 切替、tmux 自動起動 | 半日 |
| ③ | mosh、Blink Shell、必要なら Jump Desktop | 任意 |

## mini で着手する時の手順

```sh
cd ~/dev/unsou-system
git fetch origin claude/backmini-remote-setup-n2z4hs
git checkout claude/backmini-remote-setup-n2z4hs
# tmux hibiki 内で claude を起動し、この計画書を読ませて ① から開始
```

## 注意

- `~/.claude/scripts/` と `~/Library/LaunchAgents/*.plist` の現物は mini にしかない。回収は mini 上で行う
- `launchctl kickstart` を伴う作業（`--debug-file` 切替）は他セッションを巻き込むため、作業中のものが無いことを確認してから
- 各スクリプトは mini で実行して結果を確認するまで「未検証」扱い

---

## 用語のやさしい説明（帰宅後に読む用）

| 用語 | ひとことで | たとえ話 |
|---|---|---|
| **Tailscale** | 自分の機械同士だけをつなぐ私設の回線 | 会社の内線電話。外の人はかけてこられないが、自分の端末同士はどこにいても内線でつながる |
| **ssh** | 別の機械のターミナルを、手元のターミナルから操作する仕組み | mini のキーボードを Air から遠隔で叩いている状態。画面は文字だけ |
| **tmux** | ターミナルの中に「消えない作業机」を作る道具 | 机の上を片づけずに部屋を出て、戻ってきたらそのまま続きができる。接続が切れても机（＝Claude の作業）は mini に残る |
| **デタッチ（Ctrl-b → d）** | tmux の机から「離れる」操作 | 部屋を出るだけ。机は片づけない。`exit` は机ごと捨てるので使わない |
| **remote-control** | iPhone の Claude アプリと mini をつなぐ常駐プログラム | 糸電話の「糸」。切れても会話の中身は mini に残る |
| **launchd / plist** | mac の「常駐させる係」と、その指示書 | 「この係を起動時に必ず立ち上げておいて」と貼っておく付箋。remote-control はこれで常駐している |
| **launchctl kickstart** | 常駐している係を一度止めて立ち上げ直す | 係を交代させる。その瞬間 iPhone との糸は一度切れる |
| **mosh** | ssh の「切れにくい版」 | ssh が有線電話なら mosh は携帯電話。トンネルや回線切替でも通話が続く |
| **Blink Shell** | iPhone 用のターミナルアプリ（mosh 対応） | iPhone から mini の tmux の机に直接座れる。remote-control が切れた時の裏口 |
| **keepalive（ServerAliveInterval）** | 「まだいますよ」を定期的に送る設定 | 無言だと切られる電話で、ときどき相づちを打つ |
| **pmset** | mac の省電力（スリープ）設定を見る・変える命令 | mini が寝ると外から届かない。寝させない設定になっているかの確認に使う |
| **`--debug-file`** | remote-control の「記録専用の出し口」 | 画面用の出し口をファイルにつなぐとくるくるマークが積み上がる（9/3 の 81MB）。記録専用の出し口に変えれば最初から溜まらない |
| **冪等（べきとう）な setup.sh** | 何回実行しても同じ結果になる導入スクリプト | 「もう入ってるか分からないけど、とりあえず流せば正しい状態になる」 |
| **doctor.sh** | 状態を一覧で OK/NG 表示する健康診断スクリプト | 車の警告灯パネル。どこが赤いかが一目で分かる |
| **正本（REMOTE_OPS.md）** | 困った時に最初に開く1枚 | 取扱説明書の目次ページ。詳しい話はそこからリンクで飛ぶ |
| **クラウドセッション** | claude.ai 上の使い捨て環境で動く Claude | mini でも Air でもない「貸し会議室」。コードは読めるが mini の中身は触れない。ビルド検証も不可 |

### いま特に押さえておけばいい3つ

1. **会話は mini に残る。切れるのは接続だけ。** 慌てて作り直さない
2. **作業机は tmux。離れる時は `Ctrl-b → d`、`exit` は使わない**
3. **1タスク1機械。** 機械をまたぐ前に HANDOVER に一行書く
