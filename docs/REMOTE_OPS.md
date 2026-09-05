# リモート運用の正本（mini / Air / iPhone）

作成: 2026-09-05。困ったら**まずこの1枚**。詳しい話は末尾のリンク先へ。
用語（tmux / launchd / 糸電話 など）の言い換えは `docs/superpowers/plans/2026-09-05-remote-ops-setup.md` の「用語のやさしい説明」。

---

## 🚑 会話が消えた／つながらない時の1行

```sh
# Air から: ssh mini → 机 hibiki に座る → その中で
cd ~/dev/unsou-system && claude --remote-control --resume <セッションID>
```

- セッション ID は `sh ~/.claude/scripts/recent-sessions.sh ~/dev/unsou-system`（新しい順に一覧）
- これで iPhone / Air の Claude アプリに再び出る。**作業はアプリで続ける。ターミナルでは会話しない。**
- 机に座るコマンド: `ssh mini -t '/opt/homebrew/bin/tmux new -A -s hibiki'`。離れる時は **Ctrl-b → d**（`exit` は使わない）

---

## 1. 構成図

```
        自宅（有線 LAN → home 5G）                   外出先
 ┌──────────────────────────────┐
 │ mini (BLACKICE)  24h 稼働      │
 │  ├ Claude デスクトップアプリ ──┼── claude.ai ──▶ iPhone アプリ / Air アプリ   ← 主戦場
 │  │   (対話モード・切れても再接続し続ける)
 │  ├ launchd 常駐 remote-control ┼── claude.ai ──▶ iPhone アプリ（予備・複数本）
 │  │   (10分断で終了→launchd が --continue で戻す)
 │  └ tmux 机 hibiki ◀──── Tailscale 内線 ──── ssh / mosh ──── Air (ICEBREAKER)   ← 復旧経路
 └──────────────────────────────┘
```

- 会話は **mini の中**にある。iPhone / Air は覗いているだけ。端末側の回線が切れても mini の会話は消えない
- 消えたように見えるのは **mini 側**が claude.ai と切れた時だけ（9/3 の件）

## 2. 入口の決定表

| 場面 | 入口 | やらないこと |
|---|---|---|
| 外出先・iPhone・短い指示や確認 | iPhone の Claude アプリ → mini のセッション | 画面共有 |
| Air で腰を据えて HIBIKI | Air の Claude アプリ → mini のセッション（remote-control） | Air 単体で HIBIKI を clone しない |
| アプリに出てこない・切れた | `ssh mini` → tmux `hibiki` → 上の 🚑 の1行 | tmux の中で会話し続けない |
| コード読み・仕様相談で mini が要らない | クラウドセッション | ビルド検証（`npm ci` 不可） |
| GUI が必要（Simulator・Browser ペイン） | 画面共有の高パフォーマンスモード | 常用 |

ルール: **1タスク1機械。機械をまたぐ前に HANDOVER に一行書く。**

## 3. プロジェクトの置き場所

| 置く先 | 条件 |
|---|---|
| **mini** | mini にしか無いものが要る時だけ: 実データ・`.env.local`・本番デプロイ権限・常駐 |
| **Air（既定）** | それ以外すべて。試作・スクリプト・単体で終わるもの |

- 1プロジェクトは1台にだけ置く。同じリポジトリを両方に置かない
- mini に置いた分だけリモート経路（Tailscale / ssh / remote-control）のトラブルに当たる。面積は最小に
- 迷ったら Air

## 4. 日常の手順

### つなぐ
- **iPhone / Air アプリ**: セッション一覧から mini のセッションを開く。出てこなければ §6「アプリに出てこない」
- **ssh（復旧・dev サーバー起動など）**: `ssh mini -t '/opt/homebrew/bin/tmux new -A -s hibiki'`
- mosh を入れた後は `mosh mini -- tmux new -A -s hibiki`（回線切替に強い・段階③）

### 抜ける
- アプリ: そのまま閉じてよい（mini 側は動き続ける）
- tmux: **Ctrl-b を押して離し、すぐ d**。`exit` / Ctrl-d は机ごと消える

### 戻る
| どこで作業していたか | 戻るコマンド |
|---|---|
| iPhone / Air アプリ | アプリのセッション一覧を開くだけ |
| mini の tmux | `ssh mini -t '/opt/homebrew/bin/tmux new -A -s hibiki'` |
| Air ローカルの軽いプロジェクト | `cd <プロジェクト> && claude -c` |

### 状態を見る（健康診断）
```sh
ssh mini ~/dev/unsou-system/ops/mini/doctor.sh
```
OK/NG の表が出る。NG 行の右端が §6 の見出し。

## 5. mini 側で守っている設定

| 項目 | 設定 | 理由 |
|---|---|---|
| デスクトップアプリ常時起動 | ログイン項目 ＋ 設定→Claude Code→「リモート制御を既定で有効」ON | セッションはアプリのプロセスに乗っている |
| スリープ禁止 | `pmset`: sleep 0 / womp 1 | 寝ると外から届かない |
| 回線 | 有線 LAN（Wi-Fi は切る） | 無線の短い断を消す。**2026-09-05 時点はまだ Wi-Fi（要対応）** |
| 常駐 remote-control | launchd `com.kawapon.claude-remote-control` → `rc-start.sh`（`--continue` → 無ければ新規、`--debug-file` へ記録） | 10分断で終了しても同じセッションに戻す（2026-09-05 `kill` で実測済み）。⚠️ `--continue` 中は**1本だけ**配信。iPhone で新しい会話を増やしたい時はデスクトップアプリ側で作る |
| ログ | stdout は `/dev/null`。記録は `~/.claude/logs/remote-control-debug.log`。1時間ごとに 20MB 超で切り詰め | 9/3 の 81MB 再発防止 |
| Tailscale | **入切しない** | 403 が3分続くと切断される公式仕様 |
| claude | 2.1.228 以上 | `--continue` がアーカイブ済みも戻す |

現物と手順は `ops/mini/README.md`。

## 6. 症状別対処

### アプリに出てこない（会話が消えた）
1. 消えていない。mini に残っている
2. 🚑 の1行で戻す。ID は `recent-sessions.sh`
3. 詳しくは `RUNBOOK_セッション切断時の対処.md` 手順A

### つながらない(Reconnecting)
- `doctor.sh` が NG。mini の回線か claude.ai 側。10分以内なら勝手に戻る
- 10分超えて戻らない → 常駐が終了→launchd が `--continue` で立て直しているはず。`tail -20 ~/.claude/logs/rc-start.log` で「trying --continue」→ その後の行を見る
- それでも NG → `RUNBOOK` 手順B-3（`launchctl kickstart -k`）。**iPhone の糸が一度切れる**

### 常駐(remote-control)が止まった
```sh
launchctl print gui/$(id -u)/com.kawapon.claude-remote-control | grep -E 'state|pid|last exit'
```
- `not loaded` → `ops/mini/README.md` の「常駐を入れ替える」で bootstrap
- `last exit code` が 0 以外を繰り返す → `~/.claude/logs/rc-start.log` を読む

### デスクトップアプリが落ちた
- 画面共有で mini に入り Claude.app を起動。ログイン項目に入っているか確認
- アプリ経由のセッションはアプリと運命共同体。落ちていた間の会話は `claude -r <id>` で戻る

### 内線(Tailscale)が落ちた
- Air 側: メニューバーの Tailscale が接続中か。`tailscale status` で blackice が見えるか
- mini 側は**触らない**。ルーター再起動なら数分で自動復帰
- 復帰しない → 画面共有（同一 LAN）か、帰宅してから

### 机(tmux)に座る
- `ssh mini -t '/opt/homebrew/bin/tmux new -A -s hibiki'`。無ければ作られる
- 机が増えている（`tmux ls` で 2 本以上）→ 不要なものは `tmux kill-session -t <名前>`

### mini が寝る
```sh
sudo pmset -a sleep 0 womp 1
```

### 有線 LAN にする
- mini とルーターを LAN ケーブルで直結し、システム設定→ネットワークで Wi-Fi をオフ
- 1週間 `doctor.sh` の「切断回数」を見て、まだ切れるなら home 5G 側と切り分け

### ログが太った
- `sh ~/.claude/scripts/rotate-remote-control-log.sh` を手で1回。1時間ごとの自動実行が止まっていないか `launchctl print gui/$(id -u)/com.kawapon.claude-rc-logrotate | grep state`

### claude を更新する
```sh
claude update && claude --version
```
常駐は翌 2:00 に `rc-update-check.sh` が idle なら入れ替える（`~/.claude/logs/rc-update-check.log`）

### ディスクが足りない
- `du -sh ~/.claude/logs ~/.claude/projects web/.next web/.open-next` で太っている所を探す。`web/.next` は消してよい

## 7. 詳細版（消さない）
- `docs/RUNBOOK_セッション切断時の対処.md` — 症状で分岐する手順書（A/B/C）
- `docs/REMOTE_DEV_CHECK.md` — 外出先から dev サーバーで実データ確認する手順
- `docs/2026-09-03_セッション消失とログ肥大_やさしい解説.md` — 9/3 に何が起きたか
- `docs/superpowers/plans/2026-09-05-remote-ops-setup.md` — この仕組みの計画書と用語集
- 公式: https://code.claude.com/docs/en/remote-control.md
