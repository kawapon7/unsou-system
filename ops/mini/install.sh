#!/bin/sh
# ops/mini の中身を mini に配る（冪等: 何度流しても同じ状態になる）。
# やること: スクリプトを ~/.claude/scripts/ へ、plist テンプレを __HOME__ 置換して ~/Library/LaunchAgents/ へ。
# やらないこと: launchd の読み直し（bootout/bootstrap）。iPhone の糸が切れる操作なので手で1コマンドずつ行う。
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$HOME/.claude/scripts" "$HOME/.claude/logs" "$HOME/Library/LaunchAgents"
for s in rc-start.sh rc-update-check.sh recent-sessions.sh rotate-remote-control-log.sh; do
  install -m 755 "$HERE/scripts/$s" "$HOME/.claude/scripts/$s"
  echo "script  : ~/.claude/scripts/$s"
done
for t in "$HERE"/launchd/*.plist.template; do
  name=$(basename "$t" .template)
  sed "s#__HOME__#$HOME#g" "$t" > "$HOME/Library/LaunchAgents/$name"
  plutil -lint "$HOME/Library/LaunchAgents/$name" >/dev/null
  echo "plist   : ~/Library/LaunchAgents/$name"
done
[ -f "$HOME/.tmux.conf" ] || { cp "$HERE/tmux.conf" "$HOME/.tmux.conf"; echo "tmux    : ~/.tmux.conf (new)"; }
echo "done. launchd に読み直させるには docs/REMOTE_OPS.md の「常駐を入れ替える」を見る"
