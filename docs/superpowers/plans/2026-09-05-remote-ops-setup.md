# リモート運用の仕組み化（BLACKICE / ICEBREAKER / iPhone）

作成日: 2026-09-05（クラウドセッションで起案。**実装・検証は Mac mini（BLACKICE）上で行う**）

## 目的

バックミニ導入から約1か月。道具（Tailscale / ssh+tmux / remote-control / 画面共有 / クラウドセッション）は揃ったが、
「どの入口を使うか」「困った時にどこを見るか」「今どういう状態か」が決まっておらず、リモート周りのトラブル対応に時間を取られている。
新しい道具を増やさず、今ある部品を1つの仕組みにまとめる。

## 最重要: Claude Code remote-control を安定させる（2026-09-05 追記・主戦場）

**一番多いパターン**: 自宅 mini のデスクトップアプリで開いているセッションを、外出先の Air（デスクトップアプリ）または iPhone アプリで開いて続きをやる。
アーカイブ・切断されていた時だけ ssh でターミナルから復旧する。
→ 仕組み化の中心は ssh / tmux ではなく **remote-control そのもの**。以下は公式 docs（https://code.claude.com/docs/en/remote-control.md）で確認した事実に基づく。

### 事実1: 動かし方が2つあり、通信断への強さが違う

| 動かし方 | 正体 | mini 側の通信が切れた時 |
|---|---|---|
| デスクトップアプリのセッション（`/rc`、または「リモート制御を既定で有効」） | 対話モード | **回線が戻るまで再接続を試み続ける**（docs: retries for as long as the outage lasts） |
| launchd 常駐の `claude remote-control` | サーバーモード | **約10分つながらないとプロセスが終了**（docs: gives up after roughly 10 minutes and exits）。launchd が再起動しても新サーバーになり、前のセッションはアーカイブ側へ |

→ **9/3 の「消えた」はサーバーモードの10分ルール。** 主戦場のデスクトップアプリ経路は元々切れにくい方。補強すべきは常駐サーバー側。

### 事実2: 端末（Air / iPhone）側の断は mini のセッションに影響しない

セッションは mini のプロセス内にある。端末は覗いているだけ。Air のテザリングが切れても mini 側は何も起きない。

### 事実3: 復旧は1行で「アプリの世界」に戻せる

```sh
# ssh mini → tmux hibiki の中で
cd ~/dev/unsou-system && claude --remote-control --resume <セッションID>
```

これでそのセッションが再び Air / iPhone のアプリに出る。**作業はアプリで続ける。ターミナルで会話しない。** tmux は「窓を閉じても Claude が死なない入れ物」としてだけ使う。
- セッション ID は `sh ~/.claude/scripts/recent-sessions.sh ~/dev/unsou-system`
- 常駐サーバー側の再開は `claude remote-control --continue`（起動時のセッション）または `--session-id <id>`。**サーバー停止から約4時間以内**
- **v2.1.228 以降**なら `--continue` / `--session-id` がアーカイブ済みセッションも自動で戻す → mini の `claude --version` を確認し、古ければ更新

### mini 側で安定させる設定（優先順）

1. **デスクトップアプリを常時起動。** セッションはアプリのプロセスに乗っている（docs: Local process must keep running）。ログイン項目に登録し、「設定 → Claude Code → リモート制御を既定で有効」をオン
2. **有線 LAN・スリープ禁止**（前節）
3. **launchd 常駐サーバーを `--continue` 付き＋`--debug-file` に直す。** 10分落ち → launchd 即再起動 → 同じセッションに復帰、を狙う。ログ肥大対策も同時に片づく。**mini で実測するまで未検証**
4. **`claude` を v2.1.228 以上に更新**
5. **`doctor.sh` にデスクトップアプリの生死（`pgrep`）と `claude --version` を追加**

### 公式の注意点で運用に効くもの

- ネットワーク / VPN 切替後に HTTP 403 が出ると **3分だけ再試行し、それ以上続くと切断** → **mini の Tailscale は触らない**（入切しない）
- 対話モードは **1プロセスにつきリモートセッション1本**。複数持ちたい時はサーバーモード（既定32本）
- サーバーモードでセッションが落ちた時は、端末から1通送ると再び配信される（docs: send a message from a connected device to serve it again）
- `/plugin` `/resume` などはリモートから使えない（ローカル専用）
- 権限プロンプト以外のダイアログは既定5分で期限切れ → 既定動作で閉じる（`dialogExpiry` で変更可）

### 優先順位の組み替え

この節の1〜5 を **段階①の先頭**に置く。`REMOTE_OPS.md` と `doctor.sh` はその次。mosh / Blink は「ssh 復旧経路の快適化」なので③のまま。

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

## 通信断への設計（Air はテザリング運用が多い前提）

前提: **Air の回線は切れるもの**として設計する。目標は「切れないこと」ではなく「**切れても作業が止まらず、アーカイブもされないこと**」。

### 経路ごとに「切れたら何が起きるか」

| 作業の形 | Claude が動いている場所 | Air の回線が切れると | アーカイブ |
|---|---|---|---|
| Air ローカルの軽いプロジェクト（CLI Claude） | Air | いま送っていた1往復が失敗するだけ。回線が戻れば同じセッションで続き | されない |
| `ssh mini` → tmux `hibiki` 内の CLI Claude | mini | ssh の表示が切れるだけ。Claude は mini の tmux で動き続ける。戻って `ssh mini -t tmux new -A -s hibiki` で同じ画面 | されない |
| **mosh** で mini → tmux | mini | 表示すら切れない。回線が戻れば mosh が勝手につなぎ直す | されない |
| iPhone / Air の Claude アプリ → remote-control | mini | **Air 側の断は無関係。** アーカイブされるのは **mini 側の回線**が claude.ai と切れた時 | mini 側が切れた時のみ |

つまり **Air のテザリングが切れてアーカイブされる経路は、この構成には無い。** 9/3 のアーカイブは mini 側の remote-control が claude.ai と切れたことが原因。

### 守ること

1. **HIBIKI の Claude は必ず mini の tmux の中で動かす。** Air 上で HIBIKI の Claude を動かさない（Air の断がそのまま作業の断になる）
2. **mini は自宅回線に有線 LAN で置き、テザリングに乗せない。** remote-control のアーカイブは mini 側の断で起きるので、ここが安定していれば起きない
   - 自宅回線はドコモ home 5G（ホームルーター）。**mini とルーターは LAN ケーブルで直結し、mini の Wi-Fi は切る**（有線・無線の両立ちは経路迷いで断が出る）。macOS の Wi-Fi 省電力・干渉による短い断を消せる
   - LAN で安定するのは部屋の中の1区間だけ。home 5G 自体がモバイル回線で外に出ているため、上流の揺れは残る。LAN 化後1週間 `doctor.sh` で remote-control ログの `Reconnecting` 回数を見て、まだ切れるなら原因は home 5G 側と切り分ける
   - home 5G はキャリア NAT で外からの直接接続不可。Tailscale は中継で越えるので現構成のままでよい。ルーターの自動再起動時は必ず切れるが、Tailscale・remote-control とも自動復帰し、会話は RUNBOOK 手順Aで再開できる
   - 省電力: 「スリープさせない」＋「ネットワークアクセスによるスリープ解除」をオン
3. **Air からは mosh を既定にする**（`brew install mosh` を両機に。`mosh mini -- tmux new -A -s hibiki`）。回線切替・トンネル・電波の途切れで表示が死なない
4. mosh が使えない時の ssh は keepalive 付きで（Air の `~/.ssh/config`）:
   ```
   Host mini
     HostName blackice           # Tailscale の MagicDNS 名。IP 直書きより切替に強い
     User <mini のユーザー名>
     ServerAliveInterval 30
     ServerAliveCountMax 3
   ```
   Tailscale は回線が替わっても同じ 100.x アドレスで届くので、短い断なら ssh もそのまま生き残ることが多い
5. **抜ける時は必ずデタッチ（`Ctrl-b → d`）。** `exit` は机ごと消える
6. remote-control 側の保険: `--debug-file` への切替後、`doctor.sh` で `Connected` を毎回確認してから iPhone で話しかける

### 切れた後の戻り方（迷わないための1行）

| どこで作業していたか | 戻るコマンド |
|---|---|
| mini の tmux | `mosh mini -- tmux new -A -s hibiki`（または ssh 版） |
| Air ローカル | `cd <プロジェクト> && claude -c` |
| iPhone アプリの会話が消えた | `RUNBOOK_セッション切断時の対処.md` 手順A（`recent-sessions.sh` → `claude -r <id>`） |

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

### tmux だけ、もう少しくわしく（机と窓）

ふつうに `ssh mini` で Claude を動かすと、Claude は ssh の接続にぶら下がる。接続が切れた瞬間に Claude も終わる。
tmux は mini の中に「机」を作って Claude をその上で動かす。ssh は「机を覗く窓」になる。窓が閉じても机は残る。

```
tmux なし:  Air ──ssh──▶ Claude              ← 線が切れると Claude も死ぬ
tmux あり:  Air ──ssh──▶ [机 hibiki: Claude]  ← 線が切れても机は mini に残る
```

| やりたいこと | 操作 | 意味 |
|---|---|---|
| 机に座る（無ければ作る） | `ssh mini -t '/opt/homebrew/bin/tmux new -A -s hibiki'` | `-A` = あれば座り直す、無ければ新設。**常にこれだけ使う**（机が増えない） |
| 机から離れる | **Ctrl-b を押して離し、すぐ d** | デタッチ。机は残る。正しい抜け方 |
| 机の一覧 | `tmux ls` | `hibiki: 1 windows (attached)` など |
| 机を片づける（普段不要） | `tmux kill-session -t hibiki` | Claude も終わる |

- Ctrl-b は「tmux に話しかける合図」。直後の1キーだけが tmux への命令で、他は全部机の上の Claude に届く
- **`exit` / Ctrl-d は机を片づける操作**。Claude も終わる。抜ける時は必ず Ctrl-b → d
- 画面下の緑の帯が「tmux の中にいる」目印。帯が無ければ外
- マウスホイールでスクロール可（`mouse on` 設定済み）。スクロール中は帯に `[0/1234]` が出る。`q` で戻る
- Ctrl-b → d で抜けない時は間が空きすぎ。Ctrl-b を離して即 d
- 同じリポジトリでデスクトップ版 Claude を同時に開かない（編集がぶつかる）
- 通信が切れたら窓が閉じるだけ。戻ったら「机に座る」コマンドを打てば切れる前と同じ画面

### launchd だけ、もう少しくわしく（常駐係の管理人と指示書）

launchd は mac 標準の「常駐係の管理人」。「起動時にこれを立ち上げて、落ちたら立ち上げ直して」と頼む仕組み。頼み事は1件ずつ **plist**（指示書）に書いて `~/Library/LaunchAgents/` に置く。ログインすると自動で読まれる。

| 指示書 | 頼んでいる内容 |
|---|---|
| `com.kawapon.claude-remote-control` | `claude remote-control` を常に動かす（iPhone とつなぐ糸の係） |
| `com.kawapon.claude-rc-logrotate` | 1時間ごとにログの大きさを見て、太っていたら片づける係 |

- 10分ルールでサーバーが終了すると launchd が立ち上げ直す。**今の指示書は「新しく始めろ」なので前のセッションが置き去りになる。** 「前のを引き継げ」（`--continue`）に書き換えるのが対策
- ログイン項目との違い: ログイン項目は起動時に立ち上げるだけで、落ちても戻さない。launchd は落ちたら戻す。画面のある**デスクトップアプリはログイン項目**、画面のない**常駐サーバーは launchd**

| やりたいこと | 命令 |
|---|---|
| 係が動いているか | `launchctl print gui/$(id -u)/com.kawapon.claude-remote-control \| grep -E 'state\|pid'` |
| 止めて立ち上げ直す（iPhone の糸が一度切れる） | `launchctl kickstart -k gui/$(id -u)/com.kawapon.claude-remote-control` |
| 指示書を書き換えた後に読み直させる | `launchctl bootout gui/$(id -u) <plist>` → `launchctl bootstrap gui/$(id -u) <plist>` |

### いま特に押さえておけばいい3つ

1. **会話は mini に残る。切れるのは接続だけ。** 慌てて作り直さない
2. **作業机は tmux。離れる時は `Ctrl-b → d`、`exit` は使わない**
3. **1タスク1機械。** 機械をまたぐ前に HANDOVER に一行書く
