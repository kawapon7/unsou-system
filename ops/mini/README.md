# ops/mini — Mac mini（BLACKICE）の常駐まわり一式

mini にしか無かった `~/.claude/scripts/*.sh` と `~/Library/LaunchAgents/*.plist` をここで管理する。
使い方の正本は `docs/REMOTE_OPS.md`。

| ファイル | 役目 |
|---|---|
| `doctor.sh` | 健康診断。`ssh mini ~/dev/unsou-system/ops/mini/doctor.sh` |
| `install.sh` | スクリプトと plist を mini に配る（冪等）。launchd の読み直しはしない |
| `scripts/rc-start.sh` | 常駐 remote-control の起動ラッパー。`--continue` で前のセッションに戻り、無ければ新規。記録は `--debug-file` |
| `scripts/rotate-remote-control-log.sh` | 1時間ごと。20MB 超のログを切り詰め |
| `scripts/rc-update-check.sh` | 毎晩 2:00。claude が更新されていて idle なら常駐だけ入れ替え |
| `scripts/recent-sessions.sh` | セッション ID の一覧（復旧用） |
| `launchd/*.plist.template` | 指示書のひな形。`__HOME__` を置換して使う |
| `ssh_config.example` | Air 側 `~/.ssh/config` の見本（keepalive 付き） |
| `tmux.conf` | `~/.tmux.conf` |
| `backup/` | 変更前の現物（2026-09-05） |

## 常駐を入れ替える（⚠️ iPhone / Air とつながっている常駐側セッションが一度切れる）

```sh
sh ~/dev/unsou-system/ops/mini/install.sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.kawapon.claude-remote-control.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kawapon.claude-remote-control.plist
sleep 20; tail -5 ~/.claude/logs/rc-start.log
```

## 検証記録（2026-09-05 mini で実測）
- `doctor.sh`: 表が出ることを確認（NG は「回線が Wi-Fi」のみ）
- `install.sh`: 配布後、plist がテンプレと一致することを diff で確認
- `rc-start.sh`:
  - 引き継ぐ記録が無いディレクトリでは `--continue` が **1秒で exit 1** → 新規起動へ切り替わる（無限再起動にならない）
  - bootout → bootstrap で入れ替え: 同じ環境ID `env_01CA67…` に登録し直し、前サーバーの事前作成セッション `0a494143…` を `SessionStart:resume` で復帰
  - `kill` で「10分落ち」を疑似再現: 約60秒後に launchd が再実行し、**同じセッションに再度復帰**（`rc-start.log` に「continued session ended after 65s」→「trying --continue」）
  - ⚠️ `--continue` で立ち上がったサーバーは **single-session（最大1本）**。`--spawn=same-dir`（最大32本）と違い、iPhone から新しいセッションを増やせない。戻るのは「最後に記録された1本」だけで、前サーバーにぶら下がっていた他の4本は置き去り（`docs/REMOTE_OPS.md` 🚑 の1行で個別に戻す）
  - 未検証: 本物の10分通信断（Wi-Fi 断）で同じ結果になるか。仕組み上は同じ経路（プロセス終了→launchd→`--continue`）
